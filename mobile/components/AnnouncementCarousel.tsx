import { useCallback, useEffect, useRef, useState } from 'react';
import {
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { ZoomableImage } from '@/components/ZoomableImage';
import { NatureTheme } from '@/constants/Theme';

const c = NatureTheme.colors;
const r = NatureTheme.radius;
const s = NatureTheme.spacing;

/** สลับสไลด์ประกาศอัตโนมัติ */
const AUTO_ADVANCE_MS = 4000;

type Props = {
  urls: string[];
  /** ความสูงรูปแต่ละสไลด์ (px) — ตั้งจากแอดมิน */
  slideHeightPx?: number;
};

export function AnnouncementCarousel({ urls, slideHeightPx = 160 }: Props) {
  const { width: winW } = useWindowDimensions();
  const slideW = Math.min(winW - s.screen * 2, 640);
  const [index, setIndex] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const indexRef = useRef(0);
  indexRef.current = index;

  useEffect(() => {
    if (urls.length <= 1) return;
    const id = setInterval(() => {
      setIndex((prev) => {
        const next = (prev + 1) % urls.length;
        scrollRef.current?.scrollTo({
          x: next * slideW,
          animated: true,
        });
        return next;
      });
    }, AUTO_ADVANCE_MS);
    return () => clearInterval(id);
  }, [urls.length, slideW]);

  /** หมุนจอ / เปลี่ยนความกว้าง — คงสไลด์เดิม ปรับ offset ให้ตรง */
  useEffect(() => {
    scrollRef.current?.scrollTo({
      x: indexRef.current * slideW,
      animated: false,
    });
  }, [slideW]);

  const onScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const x = e.nativeEvent.contentOffset.x;
      setIndex(Math.min(urls.length - 1, Math.max(0, Math.round(x / slideW))));
    },
    [slideW, urls.length]
  );

  if (urls.length === 0) return null;

  return (
    <View style={styles.outer}>
      <Text style={styles.label}>ประกาศจากบริษัท</Text>
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        decelerationRate="fast"
        onMomentumScrollEnd={onScrollEnd}
        style={{ width: slideW, alignSelf: 'center' }}
        contentContainerStyle={styles.scrollContent}>
        {urls.map((uri) => (
          <View key={uri} style={{ width: slideW }}>
            <ZoomableImage
              source={{ uri }}
              style={[styles.image, { width: slideW, height: slideHeightPx }]}
              resizeMode="cover"
              accessibilityLabel="ภาพประกาศ"
            />
          </View>
        ))}
      </ScrollView>
      {urls.length > 1 ? (
        <View style={styles.dots}>
          {urls.map((_, i) => (
            <View
              key={i}
              style={[styles.dot, i === index && styles.dotActive]}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  outer: { marginBottom: s.section },
  label: {
    fontSize: 14,
    fontWeight: '700',
    color: c.textSecondary,
    marginBottom: s.gap,
  },
  scrollContent: { alignItems: 'flex-start' },
  image: {
    borderRadius: r.sm,
    backgroundColor: c.surfaceMuted,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    marginTop: s.gap,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: c.border,
  },
  dotActive: { backgroundColor: c.primary, width: 16 },
});
