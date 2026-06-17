import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { ZoomableImage } from '@/components/ZoomableImage';
import type { AppTheme } from '@/constants/Theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import {
  ANNOUNCEMENT_DEFAULT_DURATION_MS,
  type AnnouncementTransitionMode,
  type AnnouncementSlide,
} from '@/lib/announcementSlides';

type Props = {
  urls: string[];
  slides?: AnnouncementSlide[];
  transitionMode?: AnnouncementTransitionMode;
  /** ความสูงรูปแต่ละสไลด์ (px) — ตั้งจากแอดมิน */
  slideHeightPx?: number;
};

export function AnnouncementCarousel({
  urls,
  slides,
  transitionMode = 'slide',
  slideHeightPx = 160,
}: Props) {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createAnnouncementStyles(theme), [theme]);
  const s = theme.spacing;
  const { width: winW } = useWindowDimensions();
  const slideW = Math.min(winW - s.screen * 2, 640);
  const displaySlides = useMemo(
    () =>
      slides && slides.length > 0
        ? slides
        : urls.map((url) => ({ url, durationMs: ANNOUNCEMENT_DEFAULT_DURATION_MS })),
    [slides, urls]
  );
  const loopingSlides = useMemo(
    () =>
      displaySlides.length > 1
        ? [...displaySlides, displaySlides[0]]
        : displaySlides,
    [displaySlides]
  );
  const [index, setIndex] = useState(0);
  const [fadeNextIndex, setFadeNextIndex] = useState<number | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const scrollX = useRef(new Animated.Value(0)).current;
  const fadeOpacity = useRef(new Animated.Value(1)).current;
  const fadeAnimatingRef = useRef(false);
  const indexRef = useRef(0);
  indexRef.current = index;

  const goToIndex = useCallback(
    (targetIndex: number, animated = true) => {
      if (displaySlides.length === 0) return;
      const normalized =
        ((targetIndex % displaySlides.length) + displaySlides.length) % displaySlides.length;
      if (transitionMode === 'fade') {
        if (normalized === indexRef.current && fadeNextIndex == null) return;
        fadeAnimatingRef.current = true;
        setFadeNextIndex(normalized);
        fadeOpacity.setValue(0);
        Animated.timing(fadeOpacity, {
          toValue: 1,
          duration: animated ? 320 : 0,
          useNativeDriver: true,
        }).start(() => {
          setIndex(normalized);
          setFadeNextIndex(null);
          fadeOpacity.setValue(1);
          fadeAnimatingRef.current = false;
        });
        return;
      }
      scrollRef.current?.scrollTo({
        x: normalized * slideW,
        animated,
      });
      setIndex(normalized);
    },
    [displaySlides.length, fadeNextIndex, fadeOpacity, slideW, transitionMode]
  );

  useEffect(() => {
    if (displaySlides.length <= 1) return;
    const current = displaySlides[indexRef.current];
    const waitMs = current?.durationMs ?? ANNOUNCEMENT_DEFAULT_DURATION_MS;
    const id = setTimeout(() => {
      const currentIndex = indexRef.current;
      if (transitionMode === 'fade') {
        if (!fadeAnimatingRef.current) goToIndex(currentIndex + 1);
        return;
      }
      const atLastSlide = currentIndex >= displaySlides.length - 1;
      const next = atLastSlide ? displaySlides.length : currentIndex + 1;
      scrollRef.current?.scrollTo({
        x: next * slideW,
        animated: true,
      });
      if (atLastSlide) {
        setTimeout(() => {
          scrollRef.current?.scrollTo({ x: 0, animated: false });
          setIndex(0);
        }, 360);
      } else {
        setIndex(next);
      }
    }, waitMs);
    return () => clearTimeout(id);
  }, [displaySlides, goToIndex, index, slideW, transitionMode]);

  /** หมุนจอ / เปลี่ยนความกว้าง — คงสไลด์เดิม ปรับ offset ให้ตรง */
  useEffect(() => {
    if (transitionMode === 'fade') return;
    scrollRef.current?.scrollTo({
      x: indexRef.current * slideW,
      animated: false,
    });
  }, [slideW, transitionMode]);

  const onScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const x = e.nativeEvent.contentOffset.x;
      const rawIndex = Math.max(0, Math.round(x / slideW));
      if (rawIndex >= displaySlides.length) {
        scrollRef.current?.scrollTo({ x: 0, animated: false });
        setIndex(0);
        return;
      }
      setIndex(Math.min(displaySlides.length - 1, rawIndex));
    },
    [slideW, displaySlides.length]
  );

  if (displaySlides.length === 0) return null;
  const activeSlide = displaySlides[index] ?? displaySlides[0];
  const fadeNextSlide = fadeNextIndex != null ? displaySlides[fadeNextIndex] : null;

  return (
    <View style={styles.outer}>
      <View style={styles.labelPill}>
        <View style={styles.labelDot} />
        <Text style={styles.label}>ประกาศจากบริษัท</Text>
      </View>
      {transitionMode === 'fade' ? (
        <View style={[styles.fadeFrame, { width: slideW, height: slideHeightPx }]}>
          <ZoomableImage
            source={{ uri: activeSlide.url }}
            style={[styles.image, { width: slideW, height: slideHeightPx }]}
            resizeMode="cover"
            accessibilityLabel="ภาพประกาศ"
          />
          {fadeNextSlide ? (
            <Animated.View
              pointerEvents="none"
              style={[styles.fadeLayer, { opacity: fadeOpacity }]}>
              <ZoomableImage
                source={{ uri: fadeNextSlide.url }}
                style={[styles.image, { width: slideW, height: slideHeightPx }]}
                resizeMode="cover"
                accessibilityLabel="ภาพประกาศ"
              />
            </Animated.View>
          ) : null}
          {displaySlides.length > 1 ? (
            <View style={styles.fadeNavRow}>
              <Pressable style={styles.fadeNavBtn} onPress={() => goToIndex(index - 1)}>
                <Text style={styles.fadeNavText}>‹</Text>
              </Pressable>
              <Pressable style={styles.fadeNavBtn} onPress={() => goToIndex(index + 1)}>
                <Text style={styles.fadeNavText}>›</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      ) : (
        <Animated.ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          decelerationRate="fast"
          scrollEventThrottle={16}
          onScroll={Animated.event(
            [{ nativeEvent: { contentOffset: { x: scrollX } } }],
            { useNativeDriver: false }
          )}
          onMomentumScrollEnd={onScrollEnd}
          style={{ width: slideW, alignSelf: 'center' }}
          contentContainerStyle={styles.scrollContent}>
          {loopingSlides.map((slide, slideIndex) => (
            <Animated.View key={`${slide.url}-${slideIndex}`} style={{ width: slideW }}>
            <ZoomableImage
              source={{ uri: slide.url }}
              style={[styles.image, { width: slideW, height: slideHeightPx }]}
              resizeMode="cover"
              accessibilityLabel="ภาพประกาศ"
            />
            </Animated.View>
          ))}
        </Animated.ScrollView>
      )}
      {displaySlides.length > 1 ? (
        <View style={styles.dots}>
          {displaySlides.map((_, i) => (
            <Pressable
              key={i}
              onPress={() => goToIndex(i)}
              style={[styles.dot, i === index && styles.dotActive]}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function createAnnouncementStyles(theme: AppTheme) {
  const c = theme.colors;
  const r = theme.radius;
  const s = theme.spacing;

  return StyleSheet.create({
  outer: { marginBottom: s.section },
  labelPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: s.gap,
    paddingVertical: 5,
    paddingHorizontal: 9,
    borderRadius: 999,
    backgroundColor: c.primaryLight,
    borderWidth: 1,
    borderColor: c.primaryMuted,
  },
  labelDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: c.primaryDark,
  },
  label: {
    fontSize: 12,
    fontWeight: '900',
    color: c.primaryDark,
  },
  scrollContent: { alignItems: 'flex-start' },
  image: {
    borderRadius: r.sm,
    backgroundColor: c.surfaceMuted,
  },
  fadeFrame: {
    alignSelf: 'center',
    borderRadius: r.sm,
    overflow: 'hidden',
    backgroundColor: c.surfaceMuted,
  },
  fadeLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  fadeNavRow: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
  },
  fadeNavBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.25)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  fadeNavText: { color: '#fff', fontSize: 26, fontWeight: '700', lineHeight: 28 },
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
}
