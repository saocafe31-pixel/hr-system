import { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, Image, StyleSheet, Text, View } from 'react-native';

import { FoliageLightTheme, type AppTheme } from '@/constants/Theme';
import { useOptionalAppTheme } from '@/contexts/AppThemeContext';

const LOADING_LOGO_URL =
  'https://qidohlmeyhsofuntbmbw.supabase.co/storage/v1/object/public/logo/MENU.png';

type AppLoadingScreenProps = {
  title?: string;
  subtitle?: string;
};

export function AppLoadingScreen({
  title = 'กำลังเตรียมข้อมูล',
}: AppLoadingScreenProps) {
  const appTheme = useOptionalAppTheme();
  const theme = appTheme?.theme ?? FoliageLightTheme;
  const isLightTheme = (appTheme?.themeId ?? 'foliageLight') === 'foliageLight';
  const c = theme.colors;
  const styles = useMemo(
    () => createLoadingStyles(c, theme.radius, isLightTheme),
    [c, isLightTheme, theme.radius]
  );
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

function createLoadingStyles(
  c: AppTheme['colors'],
  r: AppTheme['radius'],
  isLightTheme: boolean
) {
  const lightLoadingBg = '#DDE8B8';
  const logoStageSize = isLightTheme ? 66 : 58;
  const glowSize = isLightTheme ? 60 : 52;
  const logoShellSize = isLightTheme ? 54 : 46;
  const logoSize = isLightTheme ? 52 : 44;
  const logoShineHeight = isLightTheme ? 72 : 62;

  return StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: isLightTheme ? lightLoadingBg : c.canvas,
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
    width: logoStageSize,
    height: logoStageSize,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  glow: {
    position: 'absolute',
    width: glowSize,
    height: glowSize,
    borderRadius: glowSize / 2,
    backgroundColor: isLightTheme ? 'rgba(255,255,255,0.46)' : c.primaryLight,
  },
  logoShell: {
    width: logoShellSize,
    height: logoShellSize,
    borderRadius: logoShellSize / 2,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  logo: {
    width: logoSize,
    height: logoSize,
    borderRadius: logoSize / 2,
  },
  logoShine: {
    position: 'absolute',
    width: 10,
    height: logoShineHeight,
    backgroundColor: 'rgba(255,255,255,0.28)',
  },
  title: {
    fontSize: 11,
    fontWeight: '900',
    color: isLightTheme ? c.primaryDark : c.textSecondary,
    textAlign: 'center',
    marginBottom: 7,
  },
  progressTrack: {
    width: 112,
    height: 5,
    borderRadius: 999,
    backgroundColor: isLightTheme ? 'rgba(111, 132, 46, 0.18)' : c.surfaceMuted,
    overflow: 'hidden',
    borderWidth: isLightTheme ? 0.5 : 1,
    borderColor: isLightTheme ? 'rgba(111, 132, 46, 0.26)' : c.borderSoft,
  },
  progressFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: '52%',
    borderRadius: 999,
    backgroundColor: isLightTheme ? c.primaryDark : c.primaryMuted,
    opacity: isLightTheme ? 0.86 : 0.72,
  },
  progressScan: {
    position: 'absolute',
    top: -2,
    bottom: -2,
    width: 34,
    borderRadius: 999,
    backgroundColor: isLightTheme ? 'rgba(255,255,255,0.62)' : 'rgba(255,255,255,0.42)',
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
    backgroundColor: isLightTheme ? c.primaryDark : c.checkIn,
  },
  statusText: {
    color: isLightTheme ? c.textSecondary : c.textSecondary,
    fontSize: 9,
    fontWeight: '700',
  },
});
}
