/**
 * เว็บ: ไม่ใช้ expo-notifications — หลีกเลี่ยงการ resolve โมดูลที่ Metro เว็บหาไม่เจอ
 * API ต้องตรงกับ appNotifications.ts (native)
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

import { supabase } from '@/lib/supabase';

const PROMPT_KEY = '@foliage/notification_prompt_done_v1';

export async function ensureAndroidNotificationChannel(): Promise<void> {}

export async function getNotificationPermissionStatus(): Promise<string> {
  if (typeof Notification === 'undefined') return 'denied';
  return Notification.permission;
}

export async function requestNotificationPermissions(): Promise<boolean> {
  if (typeof Notification === 'undefined') return false;
  const p = await Notification.requestPermission();
  return p === 'granted';
}

export async function shouldShowPermissionPrompt(): Promise<boolean> {
  try {
    const v = await AsyncStorage.getItem(PROMPT_KEY);
    return v !== '1';
  } catch {
    return true;
  }
}

export async function markPermissionPromptDone(): Promise<void> {
  try {
    await AsyncStorage.setItem(PROMPT_KEY, '1');
  } catch {
    /* ignore */
  }
}

export function isPhysicalDevice(): boolean {
  return false;
}

export async function registerAndSavePushToken(
  updateProfile: (token: string | null) => Promise<void>
): Promise<string | null> {
  await updateProfile(null);
  return null;
}

export async function setHomeIconBadgeCount(count: number): Promise<void> {
  const n = Math.max(0, Math.floor(count));
  const nav = navigator as Navigator & {
    setAppBadge?: (value?: number) => Promise<void>;
    clearAppBadge?: () => Promise<void>;
  };
  if (typeof nav.setAppBadge !== 'function') return;
  try {
    if (n > 0) await nav.setAppBadge(n);
    else if (typeof nav.clearAppBadge === 'function') await nav.clearAppBadge();
    else await nav.setAppBadge(0);
  } catch {
    /* ignore */
  }
}

export function isBadgeApiSupported(): boolean {
  const nav = navigator as Navigator & {
    setAppBadge?: (value?: number) => Promise<void>;
  };
  return typeof nav.setAppBadge === 'function';
}

export function appIsInBackground(): boolean {
  if (typeof document === 'undefined') return true;
  return document.visibilityState !== 'visible';
}

export async function presentBackgroundAwareNotification(
  title: string,
  body: string,
  _data?: Record<string, unknown>
): Promise<void> {
  if (typeof Notification === 'undefined') return;
  if (!appIsInBackground()) return;
  if (Notification.permission !== 'granted') return;
  try {
    new Notification(title, { body });
  } catch {
    /* ignore */
  }
}

function base64UrlToUint8Array(base64Url: string): Uint8Array {
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const pad = '='.repeat((4 - (base64.length % 4 || 4)) % 4);
  const raw = atob(base64 + pad);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) arr[i] = raw.charCodeAt(i);
  return arr;
}

export async function registerWebPushSubscription(userId: string): Promise<boolean> {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
  if (Notification.permission !== 'granted') return false;
  const key =
    (Constants.expoConfig?.extra as { webPushVapidPublicKey?: string } | undefined)
      ?.webPushVapidPublicKey ??
    (process.env.EXPO_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY || '');
  if (!key) return false;

  const reg = await navigator.serviceWorker.register('/sw-webpush.js');
  const serverKey = base64UrlToUint8Array(key);
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: serverKey as unknown as BufferSource,
    }));

  const json = sub.toJSON() as {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  };
  const endpoint = json.endpoint ?? '';
  const p256dh = json.keys?.p256dh ?? '';
  const auth = json.keys?.auth ?? '';
  if (!endpoint || !p256dh || !auth) return false;

  const { error } = await supabase.from('web_push_subscriptions').upsert(
    {
      user_id: userId,
      endpoint,
      p256dh,
      auth,
      user_agent: navigator.userAgent,
    },
    { onConflict: 'endpoint' }
  );
  return !error;
}
