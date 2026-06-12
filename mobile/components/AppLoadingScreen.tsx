import { useEffect, useRef } from 'react';
import { Animated, Easing, Image, StyleSheet, Text, View } from 'react-native';

import { NatureTheme } from '@/constants/Theme';

const c = NatureTheme.colors;
const r = NatureTheme.radius;
const LOADING_LOGO_URL =
  'https://qidohlmeyhsofuntbmbw.supabase.co/storage/v1/object/public/logo/MENU.png';

type AppLoadingScreenProps = {
  title?: string;
  subtitle?: string;
};

export function AppLoadingScreen({
  title = 'กำลังเตรียมข้อมูล',
}: AppLoadingScreenProps) {
  const pulse = useRef(new Animated.Value(0)).current;
  const scan = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1050,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: false,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 1050,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: false,
        }),
      ])
    );
    const scanLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(scan, {
          toValue: 1,
          duration: 1500,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: false,
        }),
        Animated.timing(scan, {
          toValue: 0,
          duration: 520,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: false,
        }),
      ])
    );

    pulseLoop.start();
    scanLoop.start();
    return () => {
      pulseLoop.stop();
      scanLoop.stop();
    };
  }, [pulse, scan]);

  const logoScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.98, 1.02],
  });
  const glowOpacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.18, 0.42],
  });
  const scanX = scan.interpolate({
    inputRange: [0, 1],
    outputRange: [-72, 72],
  });

  return (
    <View style={styles.screen}>
      <View style={styles.card}>
        <View style={styles.logoStage}>
          <Animated.View style={[styles.glow, { opacity: glowOpacity, transform: [{ scale: logoScale }] }]} />
          <Animated.View style={[styles.logoShell, { transform: [{ scale: logoScale }] }]}>
            <Image
              source={{ uri: LOADING_LOGO_URL }}
              style={styles.logo}
              resizeMode="contain"
            />
            <Animated.View
              style={[
                styles.logoShine,
                { transform: [{ translateX: scanX }, { rotate: '16deg' }] },
              ]}
            />
          </Animated.View>
        </View>

        <Text style={styles.title}>{title}</Text>

        <View style={styles.progressTrack}>
          <View style={styles.progressFill} />
          <Animated.View style={[styles.progressScan, { transform: [{ translateX: scanX }] }]} />
        </View>
        <View style={styles.statusRow}>
          <View style={styles.statusDot} />
          <Text style={styles.statusText}>HR System กำลังทำงาน</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: c.canvas,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
  },
  card: {
    width: '100%',
    maxWidth: 156,
    alignItems: 'center',
    paddingVertical: 0,
    paddingHorizontal: 0,
  },
  logoStage: {
    width: 58,
    height: 58,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  glow: {
    position: 'absolute',
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: c.primaryLight,
  },
  logoShell: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  logo: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  logoShine: {
    position: 'absolute',
    width: 10,
    height: 62,
    backgroundColor: 'rgba(255,255,255,0.28)',
  },
  title: {
    fontSize: 11,
    fontWeight: '900',
    color: c.textSecondary,
    textAlign: 'center',
    marginBottom: 7,
  },
  progressTrack: {
    width: 112,
    height: 5,
    borderRadius: 999,
    backgroundColor: c.surfaceMuted,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: c.borderSoft,
  },
  progressFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: '52%',
    borderRadius: 999,
    backgroundColor: c.primaryMuted,
    opacity: 0.72,
  },
  progressScan: {
    position: 'absolute',
    top: -2,
    bottom: -2,
    width: 34,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.42)',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: 7,
  },
  statusDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: c.checkIn,
  },
  statusText: {
    color: c.textSecondary,
    fontSize: 9,
    fontWeight: '700',
  },
});
