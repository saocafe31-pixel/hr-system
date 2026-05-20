import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Animated,
  Easing,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { NatureTheme } from '@/constants/Theme';

export type CuteToastKind = 'success' | 'error' | 'info';

type ToastPayload = {
  kind: CuteToastKind;
  title: string;
  message?: string;
};

const c = NatureTheme.colors;
const r = NatureTheme.radius;

const EMOJI: Record<CuteToastKind, string> = {
  success: '🌱',
  error: '🌧️',
  info: '🍃',
};

const SPARKLE: Record<CuteToastKind, string> = {
  success: '✨',
  error: '💭',
  info: '💚',
};

/**
 * react-native-web ห่อ Modal ด้วย z-index 9999 — modal ที่เปิดทีหลังจะเป็น sibling ใหม่ท้าย body
 * และทับ toast แม้จะใส่ z-index สูงภายใน Modal เดิม จึงใช้ portal ไปยัง host ที่ z-index สูงกว่า 9999
 */
/** โฮสต์ portal ระดับ body — สูงกว่า Modal RN Web (9999) และโมดัลที่ใส่ z-index สูงภายใน (เช่น FriendlyNotice ~3.5e7) */
const WEB_TOAST_HOST_Z = 50_000_000;

let webToastHostEl: HTMLDivElement | null = null;

function getWebToastHost(): HTMLDivElement | null {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return null;
  if (!webToastHostEl) {
    const el = document.createElement('div');
    el.setAttribute('data-cute-toast-host', 'true');
    el.style.position = 'fixed';
    el.style.top = '0';
    el.style.left = '0';
    el.style.right = '0';
    el.style.bottom = '0';
    el.style.zIndex = String(WEB_TOAST_HOST_Z);
    el.style.pointerEvents = 'none';
    document.body.appendChild(el);
    webToastHostEl = el;
  }
  return webToastHostEl;
}

function destroyWebToastHost() {
  if (Platform.OS !== 'web' || !webToastHostEl) return;
  webToastHostEl.parentNode?.removeChild(webToastHostEl);
  webToastHostEl = null;
}

function webToastPortal(node: ReactNode, host: HTMLDivElement): ReactNode {
  const { createPortal } = require('react-dom') as typeof import('react-dom');
  return createPortal(node, host);
}

const BORDER: Record<CuteToastKind, string> = {
  success: c.primaryMuted,
  error: c.error,
  info: c.river,
};

const BG: Record<CuteToastKind, string> = {
  success: c.primaryLight,
  error: c.errorBg,
  info: c.riverLight,
};

function clipMessage(s: string, max = 220): string {
  const t = s.trim();
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

type CuteToastApi = {
  show: (payload: ToastPayload) => void;
  success: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
  info: (title: string, message?: string) => void;
};

const CuteToastContext = createContext<CuteToastApi | null>(null);

const AUTO_HIDE_MS = 3200;

const SparkleText = Animated.createAnimatedComponent(Text);

export function CuteToastProvider({ children }: { children: ReactNode }) {
  useEffect(() => () => destroyWebToastHost(), []);

  const [visible, setVisible] = useState(false);
  const [payload, setPayload] = useState<ToastPayload | null>(null);
  const scale = useRef(new Animated.Value(0.82)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const cardSpinIn = useRef(new Animated.Value(0)).current;
  const cardBob = useRef(new Animated.Value(0)).current;
  const emojiWobble = useRef(new Animated.Value(0)).current;
  const sparklePulse = useRef(new Animated.Value(1)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toastMotionKey = payload
    ? `${payload.kind}:${payload.title}:${payload.message ?? ''}`
    : '';

  useEffect(() => {
    if (!visible || !payload) {
      cardBob.stopAnimation();
      emojiWobble.stopAnimation();
      sparklePulse.stopAnimation();
      cardBob.setValue(0);
      emojiWobble.setValue(0);
      sparklePulse.setValue(1);
      return;
    }
    const bob = Animated.loop(
      Animated.sequence([
        Animated.timing(cardBob, {
          toValue: 1,
          duration: 1500,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(cardBob, {
          toValue: 0,
          duration: 1500,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );
    bob.start();
    const wobble = Animated.loop(
      Animated.sequence([
        Animated.timing(emojiWobble, {
          toValue: 1,
          duration: 420,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(emojiWobble, {
          toValue: -1,
          duration: 420,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    );
    wobble.start();
    const twinkle = Animated.loop(
      Animated.sequence([
        Animated.timing(sparklePulse, {
          toValue: 1.25,
          duration: 550,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(sparklePulse, {
          toValue: 1,
          duration: 550,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );
    twinkle.start();
    return () => {
      bob.stop();
      wobble.stop();
      twinkle.stop();
    };
  }, [visible, toastMotionKey, cardBob, emojiWobble, sparklePulse]);

  const animateIn = useCallback(() => {
    scale.setValue(0.82);
    opacity.setValue(0);
    cardSpinIn.setValue(0);
    Animated.parallel([
      Animated.spring(scale, {
        toValue: 1,
        friction: 6,
        tension: 118,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: 240,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.spring(cardSpinIn, {
        toValue: 1,
        friction: 7,
        tension: 76,
        useNativeDriver: true,
      }),
    ]).start();
  }, [cardSpinIn, opacity, scale]);

  const animateOut = useCallback(
    (then?: () => void) => {
      Animated.parallel([
        Animated.timing(scale, {
          toValue: 0.9,
          duration: 170,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0,
          duration: 170,
          useNativeDriver: true,
        }),
        Animated.timing(cardSpinIn, {
          toValue: 0,
          duration: 170,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (finished) then?.();
      });
    },
    [cardSpinIn, opacity, scale]
  );

  const hide = useCallback(() => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
    animateOut(() => {
      setVisible(false);
      setPayload(null);
    });
  }, [animateOut]);

  const show = useCallback(
    (p: ToastPayload) => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      setPayload(p);
      setVisible(true);
      requestAnimationFrame(() => animateIn());
      hideTimer.current = setTimeout(() => {
        hide();
      }, AUTO_HIDE_MS);
    },
    [animateIn, hide]
  );

  const api = useMemo<CuteToastApi>(
    () => ({
      show,
      success: (title, message) =>
        show({ kind: 'success', title, message: message ? clipMessage(message) : undefined }),
      error: (title, message) =>
        show({ kind: 'error', title, message: message ? clipMessage(message) : undefined }),
      info: (title, message) =>
        show({ kind: 'info', title, message: message ? clipMessage(message) : undefined }),
    }),
    [show]
  );

  const kind = payload?.kind ?? 'info';

  const cardBobY = cardBob.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -7],
  });
  const cardRotate = cardSpinIn.interpolate({
    inputRange: [0, 1],
    outputRange: ['-11deg', '0deg'],
  });
  const emojiRotate = emojiWobble.interpolate({
    inputRange: [-1, 1],
    outputRange: ['-13deg', '13deg'],
  });
  const emojiScale = emojiWobble.interpolate({
    inputRange: [-1, 0, 1],
    outputRange: [1.06, 1, 1.06],
  });

  const toastShell = (
    <View style={styles.modalFill}>
      <Pressable
        style={styles.backdropTap}
        onPress={hide}
        accessibilityLabel="ปิดการแจ้งเตือน"
      />
      <View style={[styles.toastWrap, { pointerEvents: 'box-none' }]}>
        <Animated.View
          style={[
            styles.card,
            {
              borderColor: BORDER[kind],
              backgroundColor: BG[kind],
              opacity,
              transform: [
                { translateY: cardBobY },
                { rotate: cardRotate },
                { scale },
              ],
            },
          ]}>
          <Animated.View
            style={{
              marginBottom: 6,
              transform: [{ rotate: emojiRotate }, { scale: emojiScale }],
            }}>
            <Text style={styles.emoji} accessibilityLabel="สถานะ">
              {EMOJI[kind]}
            </Text>
          </Animated.View>
          <Text style={styles.title}>
            {payload?.title}{' '}
            <SparkleText style={[styles.sparkle, { transform: [{ scale: sparklePulse }] }]}>
              {SPARKLE[kind]}
            </SparkleText>
          </Text>
          {payload?.message ? <Text style={styles.message}>{payload.message}</Text> : null}
          <Text style={styles.hint}>แตะพื้นหลังหรือรอสักครู่ — จะปิดเอง 🌿</Text>
        </Animated.View>
      </View>
    </View>
  );

  const webHost =
    Platform.OS === 'web' && visible && payload ? getWebToastHost() : null;

  return (
    <CuteToastContext.Provider value={api}>
      {children}
      {Platform.OS === 'web' ? (
        webHost ? webToastPortal(toastShell, webHost) : null
      ) : (
        <Modal
          visible={visible && !!payload}
          transparent
          animationType="fade"
          statusBarTranslucent
          presentationStyle="overFullScreen"
          onRequestClose={hide}>
          {toastShell}
        </Modal>
      )}
    </CuteToastContext.Provider>
  );
}

const styles = StyleSheet.create({
  modalFill: {
    flex: 1,
    backgroundColor: c.overlay,
  },
  backdropTap: {
    ...StyleSheet.absoluteFillObject,
  },
  toastWrap: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingBottom: 96,
    paddingHorizontal: 20,
  },
  card: {
    borderRadius: r.lg,
    borderWidth: 2,
    paddingVertical: 20,
    paddingHorizontal: 18,
    alignItems: 'center',
    maxWidth: 360,
    alignSelf: 'center',
    width: '100%',
    ...(Platform.OS === 'web'
      ? { boxShadow: '0 6px 12px rgba(44, 50, 41, 0.12)' }
      : {
          shadowColor: c.shadow,
          shadowOffset: { width: 0, height: 6 },
          shadowOpacity: 0.12,
          shadowRadius: 12,
          elevation: 6,
        }),
  },
  emoji: {
    fontSize: 44,
    lineHeight: 52,
  },
  title: {
    fontSize: 17,
    fontWeight: '800',
    color: c.text,
    textAlign: 'center',
  },
  sparkle: {
    fontSize: 16,
  },
  message: {
    marginTop: 8,
    fontSize: 14,
    lineHeight: 20,
    color: c.textSecondary,
    textAlign: 'center',
  },
  hint: {
    marginTop: 12,
    fontSize: 11,
    color: c.textMuted,
  },
});

export function useCuteToast(): CuteToastApi {
  const ctx = useContext(CuteToastContext);
  if (!ctx) {
    throw new Error('useCuteToast must be used within CuteToastProvider');
  }
  return ctx;
}
