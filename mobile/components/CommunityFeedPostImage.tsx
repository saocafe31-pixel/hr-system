import { useCallback, useEffect, useState } from 'react';
import {
  Animated,
  Image,
  NativeSyntheticEvent,
  ImageLoadEventData,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Video, ResizeMode } from 'expo-av';

import { ZoomableImage } from '@/components/ZoomableImage';
import { NatureTheme } from '@/constants/Theme';
import type { FeedImageLayout } from '@/lib/uploadCommunityFeedImage';
import {
  clampFeedAspectRatio,
  fallbackFeedMediaAspectRatio,
} from '@/lib/uploadCommunityFeedImage';

const remoteAspectCache = new Map<string, number>();

type Props = {
  uri: string;
  mediaType: 'image' | 'video';
  imageLayout: FeedImageLayout | null;
  postId: string;
  heartFlashPostId: string | null;
  heartOpacity: Animated.Value;
  onPressImage: (postId: string) => void;
};

export function CommunityFeedPostImage({
  uri,
  mediaType,
  imageLayout,
  postId,
  heartFlashPostId,
  heartOpacity,
  onPressImage,
}: Props) {
  const c = NatureTheme.colors;
  const fallback = fallbackFeedMediaAspectRatio(mediaType, imageLayout);
  const [aspect, setAspect] = useState(() =>
    mediaType === 'video'
      ? 16 / 9
      : remoteAspectCache.get(uri) ?? fallback
  );
  const [webVideoActive, setWebVideoActive] = useState(false);

  useEffect(() => {
    setWebVideoActive(false);
  }, [uri, mediaType]);

  useEffect(() => {
    if (mediaType === 'video') {
      setAspect(16 / 9);
      return;
    }
    const cached = remoteAspectCache.get(uri);
    if (cached) {
      setAspect(cached);
      return;
    }
    setAspect(fallback);
    let cancelled = false;
    Image.getSize(
      uri,
      (w, h) => {
        if (cancelled || !w || !h) return;
        const r = clampFeedAspectRatio(w / h);
        remoteAspectCache.set(uri, r);
        if (!cancelled) setAspect(r);
      },
      () => {}
    );
    return () => {
      cancelled = true;
    };
  }, [uri, mediaType, fallback]);

  const onImageLoad = useCallback(
    (e: NativeSyntheticEvent<ImageLoadEventData>) => {
      if (mediaType !== 'image') return;
      const s = e.nativeEvent.source;
      if (s?.width && s?.height) {
        const r = clampFeedAspectRatio(s.width / s.height);
        remoteAspectCache.set(uri, r);
        setAspect(r);
      }
    },
    [uri, mediaType]
  );

  return (
    <View style={[styles.wrap, { aspectRatio: aspect, backgroundColor: c.chip }]}>
      {mediaType === 'image' ? (
        <Pressable
          style={StyleSheet.absoluteFillObject}
          onPress={() => onPressImage(postId)}>
          {Platform.OS === 'web' ? (
            <Image
              source={{ uri }}
              style={styles.fill}
              resizeMode="contain"
              onLoad={onImageLoad}
            />
          ) : (
            <ZoomableImage
              source={{ uri }}
              style={styles.fill}
              resizeMode="contain"
              onLoad={onImageLoad}
            />
          )}
          {heartFlashPostId === postId ? (
            <Animated.View
              pointerEvents="none"
              style={[styles.burst, { opacity: heartOpacity }]}>
              <Text style={styles.burstText}>♥</Text>
            </Animated.View>
          ) : null}
        </Pressable>
      ) : Platform.OS === 'web' && !webVideoActive ? (
        <Pressable
          style={[styles.fill, styles.videoPlaceholder]}
          onPress={() => setWebVideoActive(true)}
          accessibilityRole="button"
          accessibilityLabel="โหลดวิดีโอ">
          <Text style={styles.videoPlayIcon}>▶</Text>
          <Text style={styles.videoPlaceholderText}>แตะเพื่อโหลดวิดีโอ</Text>
        </Pressable>
      ) : (
        <Video
          style={styles.fill}
          source={{ uri }}
          useNativeControls
          resizeMode={ResizeMode.CONTAIN}
          isLooping={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    borderRadius: 14,
    overflow: 'hidden',
    position: 'relative',
  },
  fill: { width: '100%', height: '100%' },
  videoPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#111827',
    gap: 8,
  },
  videoPlayIcon: {
    color: '#FFFFFF',
    fontSize: 42,
    fontWeight: '900',
  },
  videoPlaceholderText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  burst: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  burstText: { fontSize: 88, color: '#E11D48' },
});
