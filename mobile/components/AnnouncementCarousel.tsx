import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import {
  ANNOUNCEMENT_DEFAULT_DURATION_MS,
  type AnnouncementSlide,
} from '@/lib/announcementSlides';

const c = NatureTheme.colors;
const r = NatureTheme.radius;
const s = NatureTheme.spacing;

type Props = {
  urls: string[];
  slides?: AnnouncementSlide[];
  /** ความสูงรูปแต่ละสไลด์ (px) — ตั้งจากแอดมิน */
  slideHeightPx?: number;
};

export function AnnouncementCarousel({ urls, slides, slideHeightPx = 160 }: Props) {
  const { width: winW } = useWindowDimensions();
  const slideW = Math.min(winW - s.screen * 2, 640);
  const displaySlides = useMemo(
    () =>
      slides && slides.length > 0
        ? slides
        : urls.map((url) => ({ url, durationMs: ANNOUNCEMENT_DEFAULT_DURATION_MS })),
    [slides, urls]
  );
  const [index, setIndex] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const indexRef = useRef(0);
  indexRef.current = index;

  useEffect(() => {
    if (displaySlides.length <= 1) return;
    const current = displaySlides[indexRef.current];
    const waitMs = current?.durationMs ?? ANNOUNCEMENT_DEFAULT_DURATION_MS;
    const id = setTimeout(() => {
      setIndex((prev) => {
        const next = (prev + 1) % displaySlides.length;
        scrollRef.current?.scrollTo({
          x: next * slideW,
          animated: true,
        });
        return next;
      });
    }, waitMs);
    return () => clearTimeout(id);
  }, [displaySlides, index, slideW]);

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
      setIndex(Math.min(displaySlides.length - 1, Math.max(0, Math.round(x / slideW))));
    },
    [slideW, displaySlides.length]
  );

  if (displaySlides.length === 0) return null;

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
        {displaySlides.map((slide, slideIndex) => (
          <View key={`${slide.url}-${slideIndex}`} style={{ width: slideW }}>
            <ZoomableImage
              source={{ uri: slide.url }}
              style={[styles.image, { width: slideW, height: slideHeightPx }]}
              resizeMode="cover"
              accessibilityLabel="ภาพประกาศ"
            />
          </View>
        ))}
      </ScrollView>
      {displaySlides.length > 1 ? (
        <View style={styles.dots}>
          {displaySlides.map((_, i) => (
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
