import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { AppState, Platform } from 'react-native';

const PROMPT_KEY = '@foliage/notification_prompt_done_v1';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function ensureAndroidNotificationChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('default', {
    name: 'FOLIAGE',
    importance: Notifications.AndroidImportance.DEFAULT,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#2E7D32',
  });
}

export async function getNotificationPermissionStatus(): Promise<Notifications.PermissionStatus> {
  const { status } = await Notifications.getPermissionsAsync();
  return status;
}

/** ขอสิทธิ์แจ้งเตือน (มือถือจริงเท่านั้นที่ได้ push token แบบสมบูรณ์) */
export async function requestNotificationPermissions(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  await ensureAndroidNotificationChannel();
  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;
  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync({
      ios: {
        allowAlert: true,
        allowBadge: true,
        allowSound: true,
      },
    });
    finalStatus = status;
  }
  return finalStatus === 'granted';
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
  return Device.isDevice === true;
}

/** ลงทะเบียน Expo push token แล้วบันทึกใน profiles (สำหรับแจ้งเตือนระยะไกลภายหลัง) */
export async function registerAndSavePushToken(
  updateProfile: (token: string | null) => Promise<void>
): Promise<string | null> {
  if (Platform.OS === 'web' || !Device.isDevice) {
    await updateProfile(null);
    return null;
  }
  const ok = await getNotificationPermissionStatus();
  if (ok !== 'granted') {
    await updateProfile(null);
    return null;
  }
  try {
    const projectId =
      (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)
        ?.eas?.projectId ??
      (Constants as { easConfig?: { projectId?: string } }).easConfig?.projectId;
    const tokenRes = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );
    const token = tokenRes.data;
    await updateProfile(token);
    return token;
  } catch {
    await updateProfile(null);
    return null;
  }
}

export async function setHomeIconBadgeCount(count: number): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const n = Math.max(0, Math.min(99999, Math.floor(count)));
    await Notifications.setBadgeCountAsync(n);
  } catch {
    /* ignore */
  }
}

export function isBadgeApiSupported(): boolean {
  return Platform.OS === 'ios' || Platform.OS === 'android';
}

export async function registerWebPushSubscription(_userId: string): Promise<boolean> {
  return false;
}

export function appIsInBackground(): boolean {
  return AppState.currentState !== 'active';
}

/** แจ้งเตือนในเครื่องเมื่อแอปไม่อยู่ foreground (ลดการซ้ำกับ toast ในแอป) */
export async function presentBackgroundAwareNotification(
  title: string,
  body: string,
  data?: Record<string, unknown>
): Promise<void> {
  if (Platform.OS === 'web') return;
  const perm = await getNotificationPermissionStatus();
  if (perm !== 'granted') return;
  await ensureAndroidNotificationChannel();
  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      data: data ?? {},
      sound: true,
    },
    trigger: null,
  });
}
