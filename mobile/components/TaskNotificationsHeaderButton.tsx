import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { NatureTheme } from '@/constants/Theme';
import { useTaskNotifications } from '@/contexts/TaskNotificationsContext';

const c = NatureTheme.colors;

/** ปุ่มระฆังใน header — งาน + การกล่าวถึงในแชท (ทุกบทบาทที่ล็อกอิน) */
export function TaskNotificationsHeaderButton() {
  const { enabled, unreadCount, openNotifModal } = useTaskNotifications();
  if (!enabled) return null;
  return (
    <Pressable
      accessibilityLabel="การแจ้งเตือน"
      onPress={openNotifModal}
      style={styles.wrap}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 4 }}>
      <View style={styles.bellBtn}>
        <FontAwesome name="bell" size={18} color={c.text} />
        {unreadCount > 0 ? (
          <View style={styles.bellBadge}>
            <Text style={styles.bellBadgeText}>{Math.min(99, unreadCount)}</Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { marginRight: 4 },
  bellBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.borderSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bellBadge: {
    position: 'absolute',
    right: -4,
    top: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: c.error,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  bellBadgeText: { color: '#FFFFFF', fontSize: 10, fontWeight: '700' },
});
