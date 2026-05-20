import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

const extra = Constants.expoConfig?.extra as
  | { supabaseUrl?: string; supabaseAnonKey?: string }
  | undefined;

const supabaseUrl =
  process.env.EXPO_PUBLIC_SUPABASE_URL ?? extra?.supabaseUrl ?? '';
const supabaseAnonKey =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? extra?.supabaseAnonKey ?? '';

export const supabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

/** เก็บ session ระหว่าง SSR (Node) — ไม่มี window / localStorage */
const ssrAuthMemory = new Map<string, string>();

/**
 * AsyncStorage ใช้ window บนเว็บ → crash ตอน Expo web SSR (ReferenceError: window is not defined)
 * ใช้ localStorage ในเบราว์เซอร์ และ memory ตอนรันบน Node
 */
const authStorage = {
  getItem: async (key: string) => {
    if (Platform.OS === 'web') {
      if (typeof localStorage !== 'undefined') {
        return localStorage.getItem(key);
      }
      return ssrAuthMemory.get(key) ?? null;
    }
    return AsyncStorage.getItem(key);
  },
  setItem: async (key: string, value: string) => {
    if (Platform.OS === 'web') {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(key, value);
        return;
      }
      ssrAuthMemory.set(key, value);
      return;
    }
    await AsyncStorage.setItem(key, value);
  },
  removeItem: async (key: string) => {
    if (Platform.OS === 'web') {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(key);
        return;
      }
      ssrAuthMemory.delete(key);
      return;
    }
    await AsyncStorage.removeItem(key);
  },
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: authStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: Platform.OS === 'web',
  },
});

/** ข้อความ error จาก PostgREST/RLS ให้ผู้ใช้เข้าใจใน toast / โมดัล */
export function humanizeSupabaseError(raw: string): string {
  const s = raw.trim();
  const low = s.toLowerCase();
  if (/row-level security/i.test(s)) {
    const hint =
      /task_assignees/i.test(low)
        ? 'task_assignees'
        : /tasks/i.test(low)
          ? 'tasks'
          : 'tasks / task_assignees';
    return `สิทธิ์ไม่พอในการบันทึก (${hint}, RLS) — แอปใช้ RPC create_manager_task_bundle แล้ว; ถ้ายังขึ้นแบบนี้ แจ้งแอดมินให้รัน migration 20260517120000_rpc_create_manager_task_bundle บน Supabase`;
  }
  if (/permission denied for assignee/i.test(s)) {
    return 'ไม่มีสิทธิ์มอบหมายให้พนักงานคนนี้ — ตรวจว่าเป็นผู้จัดการตาม role หรืออยู่ใน manager_direct_reports และ (ถ้าใช้สาขา) สาขาในโปรไฟล์ตรงกับผู้รับ';
  }
  if (/quota|exceeded|billing/i.test(low)) {
    return `${s}\n\nถ้าแดชบอร์ด Supabase แจ้งเกินโควตา การบันทึกอาจถูกบล็อก — ตรวจ Usage / Billing ขององค์กร`;
  }
  return s;
}
