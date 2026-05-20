import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useMemo, useState } from 'react';
import { LayoutChangeEvent, Platform, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { NatureTheme } from '@/constants/Theme';

const c = NatureTheme.colors;
const BAR_H = 12;
const SHIMMER_W = 48;

type Props = {
  percent: number;
  /** ไม่มีหัวข้อเช็คลิสต์ */
  empty: boolean;
};

export function TaskProgressBar({ percent, empty }: Props) {
  const [trackW, setTrackW] = useState(0);
  const fillW = useMemo(
    () => (empty ? 0 : (trackW * Math.min(100, Math.max(0, percent))) / 100),
    [trackW, percent, empty]
  );

  const shimmerX = useSharedValue(-SHIMMER_W);
  const trackScale = useSharedValue(1);

  const onTrackLayout = (e: LayoutChangeEvent) => {
    setTrackW(e.nativeEvent.layout.width);
  };

  /** แสงวิ่งบนแถบ (เฉพาะตอนกำลังทำ ไม่เต็ม) */
  useEffect(() => {
    if (fillW < 24 || empty || percent <= 0 || percent >= 100) {
      shimmerX.value = -SHIMMER_W;
      return;
    }
    shimmerX.value = -SHIMMER_W;
    shimmerX.value = withRepeat(
      withSequence(
        withTiming(fillW + SHIMMER_W, {
          duration: 2000,
          easing: Easing.linear,
        }),
        withTiming(-SHIMMER_W, { duration: 0 })
      ),
      -1,
      false
    );
  }, [fillW, empty, percent]);

  /** เต็ม 100% — ดีใจเล็กน้อย */
  useEffect(() => {
    if (!empty && percent >= 100) {
      trackScale.value = withSequence(
        withSpring(1.03, { damping: 12, stiffness: 220 }),
        withSpring(1, { damping: 14, stiffness: 180 })
      );
    } else {
      trackScale.value = 1;
    }
  }, [empty, percent, trackScale]);

  const shimmerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shimmerX.value }],
  }));

  const trackAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scaleY: trackScale.value }],
  }));

  const p = Math.min(100, Math.max(0, percent));
  const isComplete = !empty && p >= 100;
  const inProgress = !empty && p > 0 && p < 100;

  const fillColors = isComplete
    ? ([c.primaryLight, '#7AB589', c.checkIn, c.primaryDark] as const)
    : ([c.primaryMuted, c.checkIn, c.primary, c.primaryDark] as const);

  return (
    <Animated.View style={[styles.wrap, trackAnimStyle]}>
      <View style={styles.track} onLayout={onTrackLayout}>
        {!empty && p > 0 ? (
          <View style={[styles.fillClip, { width: `${p}%` }]}>
            <LinearGradient
              colors={[...fillColors]}
              locations={[0, 0.35, 0.72, 1]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={StyleSheet.absoluteFill}
            />
            {isComplete ? (
              <LinearGradient
                colors={[
                  'rgba(255,255,255,0.55)',
                  'rgba(255,255,255,0)',
                  'rgba(255,255,255,0.35)',
                ]}
                locations={[0, 0.5, 1]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={[styles.gloss, { pointerEvents: 'none' }]}
              />
            ) : null}
            {inProgress ? (
              <Animated.View
                style={[styles.shimmer, shimmerStyle, { pointerEvents: 'none' }]}>
                <LinearGradient
                  colors={[
                    'rgba(255,255,255,0)',
                    'rgba(255,255,255,0.5)',
                    'rgba(255,255,255,0)',
                  ]}
                  locations={[0, 0.5, 1]}
                  start={{ x: 0, y: 0.5 }}
                  end={{ x: 1, y: 0.5 }}
                  style={StyleSheet.absoluteFill}
                />
              </Animated.View>
            ) : null}
          </View>
        ) : null}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
  },
  track: {
    width: '100%',
    height: BAR_H,
    borderRadius: BAR_H / 2,
    backgroundColor: c.chip,
    borderWidth: 1,
    borderColor: c.borderSoft,
    overflow: 'hidden',
    elevation: 1,
    ...(Platform.OS === 'web'
      ? { boxShadow: '0 1px 2px rgba(44, 50, 41, 0.08)' }
      : {
          shadowColor: c.shadow,
          shadowOffset: { width: 0, height: 1 },
          shadowOpacity: 0.08,
          shadowRadius: 2,
        }),
  },
  fillClip: {
    height: '100%',
    overflow: 'hidden',
    borderRadius: BAR_H / 2,
  },
  gloss: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.85,
  },
  shimmer: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: SHIMMER_W,
  },
});
