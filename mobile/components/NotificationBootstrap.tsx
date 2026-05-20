import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';

import { FriendlyConfirmModal } from '@/components/FriendlyNoticeModal';
import { useAuth } from '@/contexts/AuthContext';
import {
  getNotificationPermissionStatus,
  isBadgeApiSupported,
  registerWebPushSubscription,
  registerAndSavePushToken,
  requestNotificationPermissions,
} from '@/lib/appNotifications';
import { supabase } from '@/lib/supabase';

/**
 * ขอสิทธิ์แจ้งเตือนครั้งแรกหลังล็อกอิน + บันทึก Expo push token ลง profiles
 * (รองรับแจ้งเตือนระยะไกลเมื่อมี Edge Function / backend ภายหลัง)
 */
export function NotificationBootstrap() {
  const { session } = useAuth();
  const [visible, setVisible] = useState(false);

  const syncTokenIfGranted = useCallback(async () => {
    const uid = session?.user?.id;
    if (!uid) return;
    if (Platform.OS === 'web') {
      await registerWebPushSubscription(uid);
      return;
    }
    await registerAndSavePushToken(async (token) => {
      const { error } = await supabase
        .from('profiles')
        .update({ expo_push_token: token })
        .eq('id', uid);
      if (error && __DEV__) {
        console.warn('expo_push_token update:', error.message);
      }
    });
  }, [session?.user?.id]);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!session?.user?.id) return;

      const status = await getNotificationPermissionStatus();
      if (status === 'granted') {
        if (alive) await syncTokenIfGranted();
        return;
      }
      if (Platform.OS === 'web' && !isBadgeApiSupported()) {
        // Browser still can show Notification API even if badging unsupported.
      }
      if (alive) setVisible(true);
    })();
    return () => {
      alive = false;
    };
  }, [session?.user?.id, syncTokenIfGranted]);

  const onConfirm = useCallback(async () => {
    setVisible(false);
    const ok = await requestNotificationPermissions();
    if (ok) await syncTokenIfGranted();
  }, [syncTokenIfGranted]);

  const onCancel = useCallback(() => {
    setVisible(false);
  }, []);

  return (
    <FriendlyConfirmModal
      visible={visible}
      title="เปิดการแจ้งเตือน"
      message={
        'รับการแจ้งเตือนเมื่อมีข้อความแชท งานที่ต้องติดตาม การกล่าวถึง (@) โพสต์และโน้ตในคอมมูนิตี้\n\n' +
        'ตัวเลขบนไอคอนแอป (โฮมสกรีน) จะแสดงจำนวนรายการที่ยังไม่อ่าน แบบเดียวกับ Facebook'
      }
      confirmLabel="อนุญาต"
      cancelLabel="ไว้ทีหลัง"
      onConfirm={() => void onConfirm()}
      onCancel={() => void onCancel()}
    />
  );
}
