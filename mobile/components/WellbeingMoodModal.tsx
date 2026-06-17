import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useMemo } from 'react';

import { NatureTheme, type AppTheme } from '@/constants/Theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import type { WellbeingMoodOption } from '@/lib/wellbeing';

type Props = {
  visible: boolean;
  saving: boolean;
  title?: string;
  options: WellbeingMoodOption[];
  onPick: (opt: WellbeingMoodOption) => void;
  onCancel: () => void;
};

const c = NatureTheme.colors;
const r = NatureTheme.radius;
const WEB_MODAL_BACKDROP = Platform.select({
  web: {
    position: 'fixed' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1_000_000,
  },
  default: {},
});

export function WellbeingMoodModal({
  visible,
  saving,
  title = 'วันนี้คุณเป็นยังไงบ้าง',
  options,
  onPick,
  onCancel,
}: Props) {
  const { theme } = useAppTheme();
  const tc = theme.colors;
  const themed = useMemo(() => createWellbeingModalThemeStyles(tc), [tc]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      presentationStyle="overFullScreen"
      statusBarTranslucent
      onRequestClose={() => {
        if (!saving) onCancel();
      }}>
      <View style={[styles.backdrop, themed.backdrop, WEB_MODAL_BACKDROP]}>
        <View style={[styles.card, themed.card]}>
          <Text style={[styles.title, themed.title]}>{title}</Text>
          <Text style={[styles.sub, themed.sub]}>
            เลือกข้อความที่ใกล้เคียงที่สุด — ใช้แสดงอิโมจิท้ายชื่อวันนี้ และสรุปภาพรวมในกราฟ
          </Text>
          <ScrollView
            style={styles.list}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}>
            {options.map((opt) => (
              <Pressable
                key={opt.key}
                style={[styles.choice, themed.choice, saving && styles.choiceDisabled]}
                onPress={() => !saving && onPick(opt)}
                disabled={saving}>
                <Text style={styles.emoji}>{opt.emoji}</Text>
                <Text style={[styles.label, themed.label]}>{opt.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
          {saving ? (
            <View style={styles.savingRow}>
              <ActivityIndicator color={tc.primary} />
              <Text style={[styles.savingText, themed.savingText]}>กำลังบันทึก…</Text>
            </View>
          ) : null}
          <Pressable
            style={styles.cancelBtn}
            onPress={onCancel}
            disabled={saving}>
            <Text style={[styles.cancelText, themed.cancelText]}>ยกเลิก</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function createWellbeingModalThemeStyles(colors: AppTheme['colors']) {
  return StyleSheet.create({
    backdrop: { backgroundColor: colors.overlay },
    card: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderWidth: 1.5,
    },
    title: { color: colors.text },
    sub: { color: colors.textMuted },
    choice: {
      backgroundColor: colors.surfaceMuted,
      borderColor: colors.border,
      borderWidth: 1.2,
    },
    label: { color: colors.text },
    savingText: { color: colors.textSecondary },
    cancelText: { color: colors.textMuted },
  });
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: c.overlay,
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    backgroundColor: c.surfaceElevated,
    borderRadius: r.lg,
    padding: 18,
    maxHeight: '88%',
    borderWidth: 1,
    borderColor: c.borderSoft,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: c.text,
    textAlign: 'center',
  },
  sub: {
    fontSize: 12,
    color: c.textMuted,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 18,
  },
  list: { marginTop: 14, maxHeight: 360 },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: r.md,
    backgroundColor: c.surfaceMuted,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: c.borderSoft,
  },
  choiceDisabled: { opacity: 0.55 },
  emoji: { fontSize: 26 },
  label: {
    flex: 1,
    fontSize: 14,
    color: c.text,
    lineHeight: 20,
  },
  savingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginTop: 10,
  },
  savingText: { fontSize: 14, color: c.textSecondary },
  cancelBtn: {
    marginTop: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  cancelText: { fontSize: 15, color: c.textMuted, fontWeight: '600' },
});
