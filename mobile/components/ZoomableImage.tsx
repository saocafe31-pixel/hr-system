import { useMemo } from 'react';
import { Image, ImageProps, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

const AnimatedImage = Animated.createAnimatedComponent(Image);

const MIN_SCALE = 1;
const MAX_SCALE = 4;

type Props = ImageProps & {
  /** ค่าเริ่มต้น 4 — ย่อขยายด้วยสองนิ้วภายในกรอบรูปเท่านั้น (ไม่ซูมทั้งหน้าเว็บ) */
  maxScale?: number;
};

/**
 * รูปที่รองรับ pinch-zoom ในกรอบตัวเอง — ใช้คู่กับ viewport ที่ล็อก maximum-scale
 * เพื่อกันซูมตอนพิมพ์ แต่ยังดูรูปขยายได้
 */
export function ZoomableImage({ style, maxScale = MAX_SCALE, ...imageProps }: Props) {
  const scale = useSharedValue(MIN_SCALE);
  const baseScale = useSharedValue(MIN_SCALE);
  const cap = useMemo(() => Math.max(MIN_SCALE, maxScale), [maxScale]);

  const pinch = useMemo(
    () =>
      Gesture.Pinch()
        .onStart(() => {
          baseScale.value = scale.value;
        })
        .onUpdate((e) => {
          const next = baseScale.value * e.scale;
          scale.value = Math.min(cap, Math.max(MIN_SCALE, next));
        })
        .onEnd(() => {
          baseScale.value = scale.value;
          if (scale.value < MIN_SCALE + 0.05) {
            scale.value = withTiming(MIN_SCALE);
            baseScale.value = MIN_SCALE;
          }
        }),
    [cap]
  );

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <GestureDetector gesture={pinch}>
      <View style={[styles.clip, style]}>
        <AnimatedImage
          {...imageProps}
          style={[StyleSheet.absoluteFillObject, animatedStyle]}
        />
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
});
