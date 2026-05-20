import { useEffect } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { NatureTheme } from '@/constants/Theme';

const c = NatureTheme.colors;
const r = NatureTheme.radius;
/** สูงกว่าโมดัลฟอร์มในแอป (~1e6); บนเว็บ CuteToast ใช้ portal ที่ z-index สูงกว่าเลเยอร์ Modal ของ RN Web (9999) */
const WEB_MODAL_BACKDROP = Platform.select({
  web: {
    position: 'fixed' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 35_000_000,
  },
  default: {},
});

export type FriendlyNoticeVariant =
  | 'success'
  | 'error'
  | 'info'
  | 'link'
  | 'status';

const VARIANT_META: Record<
  FriendlyNoticeVariant,
  { emoji: string; bubble: string }
> = {
  success: { emoji: '🌱', bubble: c.primaryLight },
  error: { emoji: '🍂', bubble: c.errorBg },
  info: { emoji: '📋', bubble: c.accentWarmLight },
  link: { emoji: '🔗', bubble: c.riverLight },
  status: { emoji: '✨', bubble: c.primaryLight },
};

type NoticeProps = {
  visible: boolean;
  variant: FriendlyNoticeVariant;
  title: string;
  message?: string;
  onClose: () => void;
  /** ปิดอัตโนมัติ (มิลลิวินาที) — ใช้กับ success/link เล็กๆ */
  autoDismissMs?: number;
  primaryLabel?: string;
};

/** ป๊อปอัพแจ้งผลแบบนุ่มนวล (อัปเดต / สถานะ / เปิดลิงก์) */
export function FriendlyNoticeModal({
  visible,
  variant,
  title,
  message,
  onClose,
  autoDismissMs,
  primaryLabel = 'ตกลง',
}: NoticeProps) {
  const meta = VARIANT_META[variant];

  useEffect(() => {
    if (!visible || !autoDismissMs) return;
    const t = setTimeout(onClose, autoDismissMs);
    return () => clearTimeout(t);
  }, [visible, autoDismissMs, onClose]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      presentationStyle="overFullScreen"
      statusBarTranslucent
      onRequestClose={onClose}>
      <Pressable style={[styles.backdrop, WEB_MODAL_BACKDROP]} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => {}}>
          <View style={[styles.emojiBubble, { backgroundColor: meta.bubble }]}>
            <Text style={styles.emoji}>{meta.emoji}</Text>
          </View>
          <Text style={styles.title}>{title}</Text>
          {message ? <Text style={styles.message}>{message}</Text> : null}
          {!autoDismissMs ? (
            <Pressable style={styles.btn} onPress={onClose}>
              <Text style={styles.btnText}>{primaryLabel}</Text>
            </Pressable>
          ) : (
            <Text style={styles.hint}>แตะพื้นหลังเพื่อปิด</Text>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

type ConfirmProps = {
  visible: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  danger?: boolean;
};

/** ยืนยันก่อนลบ — สไตล์เดียวกัน */
export function FriendlyConfirmModal({
  visible,
  title,
  message,
  confirmLabel = 'ลบเลย',
  cancelLabel = 'ยกเลิก',
  onConfirm,
  onCancel,
  danger,
}: ConfirmProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      presentationStyle="overFullScreen"
      statusBarTranslucent
      onRequestClose={onCancel}>
      <Pressable style={[styles.backdrop, WEB_MODAL_BACKDROP]} onPress={onCancel}>
        <Pressable style={styles.card} onPress={() => {}}>
          <View
            style={[
              styles.emojiBubble,
              { backgroundColor: danger ? c.errorBg : c.warningBg },
            ]}>
            <Text style={styles.emoji}>{danger ? '🗑️' : '🌿'}</Text>
          </View>
          <Text style={styles.title}>{title}</Text>
          {message ? <Text style={styles.message}>{message}</Text> : null}
          <View style={styles.row}>
            <Pressable style={styles.btnGhost} onPress={onCancel}>
              <Text style={styles.btnGhostText}>{cancelLabel}</Text>
            </Pressable>
            <Pressable
              style={[styles.btn, danger && styles.btnDanger]}
              onPress={onConfirm}>
              <Text style={styles.btnText}>{confirmLabel}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: c.overlay,
    justifyContent: 'center',
    padding: 28,
  },
  card: {
    backgroundColor: c.surfaceElevated,
    borderRadius: r.lg,
    padding: 22,
    borderWidth: 1,
    borderColor: c.borderSoft,
    ...(Platform.OS === 'web'
      ? { boxShadow: '0 8px 16px rgba(44, 50, 41, 0.12)' }
      : {
          shadowColor: c.shadow,
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: 0.12,
          shadowRadius: 16,
          elevation: 6,
        }),
    alignItems: 'center',
  },
  emojiBubble: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  emoji: { fontSize: 32 },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: c.text,
    textAlign: 'center',
  },
  message: {
    marginTop: 10,
    fontSize: 15,
    color: c.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  hint: {
    marginTop: 12,
    fontSize: 12,
    color: c.textMuted,
  },
  btn: {
    marginTop: 20,
    backgroundColor: c.primary,
    paddingVertical: 13,
    paddingHorizontal: 28,
    borderRadius: r.md,
    minWidth: 140,
    alignItems: 'center',
  },
  btnDanger: { backgroundColor: c.error },
  btnText: { color: c.onAccent, fontWeight: '700', fontSize: 16 },
  row: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
    justifyContent: 'center',
    flexWrap: 'wrap',
  },
  btnGhost: {
    paddingVertical: 13,
    paddingHorizontal: 20,
    borderRadius: r.md,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.surface,
  },
  btnGhostText: { color: c.textSecondary, fontWeight: '700' },
});
