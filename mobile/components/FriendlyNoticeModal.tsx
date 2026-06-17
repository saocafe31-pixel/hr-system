import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import {
  Animated,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type { AppTheme } from '@/constants/Theme';
import { useAppTheme } from '@/contexts/AppThemeContext';

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

export type FriendlyConfirmTone = 'default' | 'leave' | 'danger';

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

type ConfirmProps = {
  visible: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  danger?: boolean;
  /** โทนสี accent ของ popup — `leave` ใช้กับแจ้งเตือนก่อนลา */
  tone?: FriendlyConfirmTone;
};

function isFoliageLight(theme: AppTheme): boolean {
  return theme.colors.canvas === '#F8FAF1';
}

function variantMeta(theme: AppTheme): Record<
  FriendlyNoticeVariant,
  { emoji: string; bubble: string; ring: string }
> {
  const c = theme.colors;
  return {
    success: { emoji: '🌱', bubble: c.primaryLight, ring: c.primaryMuted },
    error: { emoji: '🍂', bubble: c.errorBg, ring: c.error },
    info: { emoji: '📋', bubble: c.accentWarmLight, ring: c.accentWarm },
    link: { emoji: '🔗', bubble: c.riverLight, ring: c.river },
    status: { emoji: '✨', bubble: c.primaryLight, ring: c.primaryMuted },
  };
}

function confirmToneMeta(
  theme: AppTheme,
  tone: FriendlyConfirmTone,
  danger?: boolean
): { emoji: string; bubble: string; ring: string; accent: string } {
  const c = theme.colors;
  if (danger || tone === 'danger') {
    return { emoji: '🗑️', bubble: c.errorBg, ring: c.error, accent: c.error };
  }
  if (tone === 'leave') {
    return { emoji: '🍃', bubble: c.linkLight, ring: c.link, accent: c.link };
  }
  return { emoji: '🌿', bubble: c.primaryLight, ring: c.primaryMuted, accent: c.primary };
}

function useModalEntrance(visible: boolean) {
  const scale = useRef(new Animated.Value(0.94)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) {
      scale.setValue(0.94);
      opacity.setValue(0);
      return;
    }
    Animated.parallel([
      Animated.spring(scale, {
        toValue: 1,
        useNativeDriver: true,
        friction: 7,
        tension: 90,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: 180,
        useNativeDriver: true,
      }),
    ]).start();
  }, [opacity, scale, visible]);

  return { scale, opacity };
}

function ModalShell({
  visible,
  onBackdropPress,
  children,
  styles,
  entrance,
}: {
  visible: boolean;
  onBackdropPress: () => void;
  children: ReactNode;
  styles: ReturnType<typeof createFriendlyModalStyles>;
  entrance: { scale: Animated.Value; opacity: Animated.Value };
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      presentationStyle="overFullScreen"
      statusBarTranslucent
      onRequestClose={onBackdropPress}>
      <Pressable
        style={[styles.backdrop, WEB_MODAL_BACKDROP]}
        onPress={onBackdropPress}>
        <Animated.View
          style={[
            styles.cardWrap,
            { opacity: entrance.opacity, transform: [{ scale: entrance.scale }] },
          ]}>
          <Pressable style={styles.card} onPress={() => {}}>
            {children}
          </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

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
  const { theme } = useAppTheme();
  const light = isFoliageLight(theme);
  const styles = useMemo(() => createFriendlyModalStyles(theme, light), [theme, light]);
  const meta = variantMeta(theme)[variant];
  const entrance = useModalEntrance(visible);

  useEffect(() => {
    if (!visible || !autoDismissMs) return;
    const t = setTimeout(onClose, autoDismissMs);
    return () => clearTimeout(t);
  }, [visible, autoDismissMs, onClose]);

  return (
    <ModalShell visible={visible} onBackdropPress={onClose} styles={styles} entrance={entrance}>
      <View style={styles.decorCircleA} />
      <View style={styles.decorCircleB} />
      <View style={[styles.accentBar, { backgroundColor: meta.ring }]} />
      <View style={[styles.iconRing, { borderColor: meta.ring }]}>
        <View style={[styles.emojiBubble, { backgroundColor: meta.bubble }]}>
          <Text style={styles.emoji}>{meta.emoji}</Text>
        </View>
      </View>
      <Text style={styles.title}>{title}</Text>
      {message ? (
        <View style={[styles.messageBox, { borderLeftColor: meta.ring }]}>
          <Text style={styles.message}>{message}</Text>
        </View>
      ) : null}
      {!autoDismissMs ? (
        <Pressable
          style={[styles.btnPrimary, { backgroundColor: meta.ring }]}
          onPress={onClose}>
          <Text style={styles.btnPrimaryText}>{primaryLabel}</Text>
        </Pressable>
      ) : (
        <Text style={styles.hint}>แตะพื้นหลังเพื่อปิด</Text>
      )}
    </ModalShell>
  );
}

/** ยืนยันก่อนดำเนินการ — สไตล์เดียวกับ notice แต่มีปุ่มคู่ */
export function FriendlyConfirmModal({
  visible,
  title,
  message,
  confirmLabel = 'ลบเลย',
  cancelLabel = 'ยกเลิก',
  onConfirm,
  onCancel,
  danger,
  tone = 'default',
}: ConfirmProps) {
  const { theme } = useAppTheme();
  const light = isFoliageLight(theme);
  const styles = useMemo(() => createFriendlyModalStyles(theme, light), [theme, light]);
  const resolvedTone: FriendlyConfirmTone = danger ? 'danger' : tone;
  const meta = confirmToneMeta(theme, resolvedTone, danger);
  const entrance = useModalEntrance(visible);

  return (
    <ModalShell visible={visible} onBackdropPress={onCancel} styles={styles} entrance={entrance}>
      <View style={styles.decorCircleA} />
      <View style={styles.decorCircleB} />
      <View style={[styles.accentBar, { backgroundColor: meta.accent }]} />
      <View style={[styles.iconRing, { borderColor: meta.ring }]}>
        <View style={[styles.emojiBubble, { backgroundColor: meta.bubble }]}>
          <Text style={styles.emoji}>{meta.emoji}</Text>
        </View>
      </View>
      <Text style={styles.title}>{title}</Text>
      {message ? (
        <View style={[styles.messageBox, { borderLeftColor: meta.accent }]}>
          <Text style={styles.message}>{message}</Text>
        </View>
      ) : null}
      <View style={styles.row}>
        <Pressable style={styles.btnGhost} onPress={onCancel}>
          <Text style={styles.btnGhostText}>{cancelLabel}</Text>
        </Pressable>
        <Pressable
          style={[
            styles.btnPrimary,
            styles.btnPrimaryFlex,
            { backgroundColor: meta.accent },
            danger && styles.btnDangerShadow,
          ]}
          onPress={onConfirm}>
          <Text style={styles.btnPrimaryText}>{confirmLabel}</Text>
        </Pressable>
      </View>
    </ModalShell>
  );
}

function createFriendlyModalStyles(theme: AppTheme, isLight: boolean) {
  const c = theme.colors;
  const r = theme.radius;

  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: isLight ? 'rgba(37, 49, 31, 0.38)' : c.overlay,
      justifyContent: 'center',
      padding: 24,
      ...(Platform.OS === 'web'
        ? { backdropFilter: isLight ? 'blur(6px)' : 'blur(4px)' }
        : {}),
    },
    cardWrap: {
      width: '100%',
      maxWidth: 400,
      alignSelf: 'center',
    },
    card: {
      backgroundColor: c.surface,
      borderRadius: r.xl,
      paddingTop: 8,
      paddingBottom: 22,
      paddingHorizontal: 22,
      borderWidth: isLight ? 1.5 : 1,
      borderColor: isLight ? c.border : c.borderSoft,
      overflow: 'hidden',
      ...(Platform.OS === 'web'
        ? {
            boxShadow: isLight
              ? '0 24px 48px rgba(111, 132, 46, 0.18), 0 8px 16px rgba(37, 49, 31, 0.08)'
              : '0 16px 32px rgba(0, 0, 0, 0.35)',
          }
        : {
            shadowColor: c.shadow,
            shadowOffset: { width: 0, height: isLight ? 14 : 10 },
            shadowOpacity: isLight ? 0.2 : 0.28,
            shadowRadius: isLight ? 28 : 18,
            elevation: isLight ? 10 : 8,
          }),
      alignItems: 'center',
    },
    decorCircleA: {
      position: 'absolute',
      top: -28,
      right: -18,
      width: 96,
      height: 96,
      borderRadius: 48,
      backgroundColor: isLight ? c.primaryLight : 'rgba(166, 184, 116, 0.08)',
      opacity: isLight ? 0.85 : 0.5,
    },
    decorCircleB: {
      position: 'absolute',
      top: 36,
      left: -32,
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor: isLight ? c.riverLight : 'rgba(110, 144, 138, 0.1)',
      opacity: isLight ? 0.7 : 0.4,
    },
    accentBar: {
      alignSelf: 'stretch',
      height: 4,
      borderRadius: 999,
      marginBottom: 18,
      marginTop: 4,
    },
    iconRing: {
      width: 76,
      height: 76,
      borderRadius: 38,
      borderWidth: 2,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 12,
      backgroundColor: isLight ? c.surfaceMuted : 'transparent',
    },
    emojiBubble: {
      width: 58,
      height: 58,
      borderRadius: 29,
      alignItems: 'center',
      justifyContent: 'center',
    },
    emoji: { fontSize: 30 },
    title: {
      fontSize: 19,
      fontWeight: '800',
      color: c.text,
      textAlign: 'center',
      letterSpacing: 0.2,
    },
    messageBox: {
      marginTop: 14,
      alignSelf: 'stretch',
      backgroundColor: isLight ? c.surfaceMuted : c.surfaceMuted,
      borderRadius: r.md,
      borderLeftWidth: 4,
      paddingVertical: 12,
      paddingHorizontal: 14,
    },
    message: {
      fontSize: 15,
      color: c.textSecondary,
      textAlign: 'left',
      lineHeight: 23,
    },
    hint: {
      marginTop: 14,
      fontSize: 12,
      color: c.textMuted,
    },
    btnPrimary: {
      marginTop: 20,
      paddingVertical: 14,
      paddingHorizontal: 24,
      borderRadius: r.md,
      minWidth: 132,
      alignItems: 'center',
      ...(Platform.OS === 'web'
        ? { boxShadow: '0 6px 14px rgba(111, 132, 46, 0.28)' }
        : {
            shadowColor: c.shadow,
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.22,
            shadowRadius: 8,
            elevation: 3,
          }),
    },
    btnPrimaryFlex: {
      flex: 1,
      minWidth: 0,
    },
    btnDangerShadow: {
      ...(Platform.OS === 'web'
        ? { boxShadow: '0 6px 14px rgba(201, 92, 92, 0.28)' }
        : {}),
    },
    btnPrimaryText: {
      color: c.onAccent,
      fontWeight: '800',
      fontSize: 15,
      letterSpacing: 0.2,
    },
    row: {
      flexDirection: 'row',
      gap: 10,
      marginTop: 20,
      alignSelf: 'stretch',
    },
    btnGhost: {
      flex: 1,
      paddingVertical: 14,
      paddingHorizontal: 16,
      borderRadius: r.md,
      borderWidth: isLight ? 1.5 : 1,
      borderColor: isLight ? c.borderSoft : c.border,
      backgroundColor: isLight ? c.surface : c.surfaceMuted,
      alignItems: 'center',
      justifyContent: 'center',
    },
    btnGhostText: {
      color: c.textSecondary,
      fontWeight: '700',
      fontSize: 15,
    },
  });
}
