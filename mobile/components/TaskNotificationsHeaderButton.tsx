import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { AppTheme } from '@/constants/Theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useTaskNotifications } from '@/contexts/TaskNotificationsContext';

/** ปุ่มระฆังใน header — งาน + การกล่าวถึงในแชท (ทุกบทบาทที่ล็อกอิน) */
export function TaskNotificationsHeaderButton() {
  const { enabled, unreadCount, openNotifModal } = useTaskNotifications();
  const { theme } = useAppTheme();
  const c = theme.colors;
  const isLightTheme = c.canvas === '#F8FAF1';
  const styles = useMemo(() => createHeaderButtonStyles(theme), [theme]);
  if (!enabled) return null;
  return (
    <Pressable
      accessibilityLabel="การแจ้งเตือน"
      onPress={openNotifModal}
      style={styles.wrap}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 4 }}>
      <View style={styles.bellBtn}>
        <FontAwesome name="bell" size={18} color={isLightTheme ? c.primaryDark : c.text} />
        {unreadCount > 0 ? (
          <View style={styles.bellBadge}>
            <Text style={styles.bellBadgeText}>{Math.min(99, unreadCount)}</Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

function createHeaderButtonStyles(theme: AppTheme) {
  const c = theme.colors;
  const isLightTheme = c.canvas === '#F8FAF1';

  return StyleSheet.create({
  wrap: { marginRight: 4 },
  bellBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: isLightTheme ? c.primaryLight : c.surface,
    borderWidth: 1,
    borderColor: isLightTheme ? c.primaryMuted : c.borderSoft,
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
}
