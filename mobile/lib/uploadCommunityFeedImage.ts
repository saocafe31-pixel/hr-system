import { File } from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import { Image, Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

/** ตรงกับตัวเลือกอัตราส่วนในหน้า community */
export type FeedImageLayout = 'square' | 'portrait' | 'landscape';

/** ขนาดพิกเซลสูงสุดด้านยาว (รูปจะถูกย่อให้พอดีกับกรอบแสดงผล) */
const FEED_IMAGE_MAX = 1080;

/** ขนาดสูงสุดหลังบีบอัดที่ยอมให้อัปโหลด (ไม่รวมเฮดเดอร์ HTTP) */
export const COMMUNITY_FEED_VIDEO_MAX_BYTES = 42 * 1024 * 1024;

/** ถ้าไฟล์ใหญ่กว่านี้จะพยายามบีบด้วย react-native-compressor (เฉพาะ iOS/Android) */
const COMMUNITY_FEED_VIDEO_COMPRESS_IF_LARGER_BYTES = 5 * 1024 * 1024;

/** จำกัดอัตราส่วนแสดงผลฟีด (กันค่าแปลกจาก metadata) */
export function clampFeedAspectRatio(r: number): number {
  if (!Number.isFinite(r) || r <= 0) return 1;
  return Math.max(1 / 3, Math.min(3, r));
}

/** กรอบ fallback ตาม `image_layout` ก่อนรู้ขนาดจริงของไฟล์ */
export function fallbackFeedMediaAspectRatio(
  mediaType: 'image' | 'video',
  imageLayout: FeedImageLayout | null
): number {
  if (mediaType === 'video') return 16 / 9;
  switch (imageLayout) {
    case 'square':
      return 1;
    case 'portrait':
      return 3 / 4;
    default:
      return 4 / 3;
  }
}

export function feedLayoutPixelSize(layout: FeedImageLayout): {
  width: number;
  height: number;
} {
  if (layout === 'square') {
    return { width: FEED_IMAGE_MAX, height: FEED_IMAGE_MAX };
  }
  if (layout === 'portrait') {
    return {
      width: Math.round((FEED_IMAGE_MAX * 3) / 4),
      height: FEED_IMAGE_MAX,
    };
  }
  return {
    width: FEED_IMAGE_MAX,
    height: Math.round((FEED_IMAGE_MAX * 3) / 4),
  };
}

async function getImagePixelSize(
  uri: string
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    Image.getSize(uri, (width, height) => resolve({ width, height }), reject);
  });
}

/**
 * ย่อรูปให้พอดีกล่องสูงสุดของ layout โดยคงอัตราส่วนเดิม
 * (ห้ามส่งทั้ง width+height ไป manipulate พร้อมกัน — native จะยืดเต็มกรอบ)
 */
export async function prepareFeedImageForLayout(
  localUri: string,
  layout: FeedImageLayout
): Promise<string> {
  const box = feedLayoutPixelSize(layout);
  let iw: number;
  let ih: number;
  try {
    const dim = await getImagePixelSize(localUri);
    iw = dim.width;
    ih = dim.height;
  } catch {
    const maxEdge = Math.max(box.width, box.height);
    const manipulated = await ImageManipulator.manipulateAsync(
      localUri,
      [{ resize: { width: maxEdge } }],
      { compress: 0.82, format: ImageManipulator.SaveFormat.JPEG }
    );
    return manipulated.uri;
  }

  if (!Number.isFinite(iw) || !Number.isFinite(ih) || iw <= 0 || ih <= 0) {
    const maxEdge = Math.max(box.width, box.height);
    const manipulated = await ImageManipulator.manipulateAsync(
      localUri,
      [{ resize: { width: maxEdge } }],
      { compress: 0.82, format: ImageManipulator.SaveFormat.JPEG }
    );
    return manipulated.uri;
  }

  const scale = Math.min(box.width / iw, box.height / ih, 1);
  const tw = Math.max(1, Math.round(iw * scale));
  const th = Math.max(1, Math.round(ih * scale));

  const resizeAction =
    tw >= th
      ? ({ resize: { width: tw } } as const)
      : ({ resize: { height: th } } as const);

  const manipulated = await ImageManipulator.manipulateAsync(
    localUri,
    [resizeAction],
    { compress: 0.82, format: ImageManipulator.SaveFormat.JPEG }
  );
  return manipulated.uri;
}

/** ขนาดไฟล์จาก URI ในเครื่อง (blob / file / content — ใช้ fetch ก่อน แล้ว fallback เป็น expo File) */
export async function getUriFileSizeBytes(uri: string): Promise<number | null> {
  try {
    const res = await fetch(uri);
    const blob = await res.blob();
    if (blob.size > 0) return blob.size;
  } catch {
    /* ignore */
  }
  if (Platform.OS !== 'web') {
    try {
      const file = new File(uri);
      const info = file.info();
      if (info.exists && typeof info.size === 'number') return info.size;
    } catch {
      return null;
    }
  }
  return null;
}

async function blobFromUri(localUri: string): Promise<Blob> {
  const response = await fetch(localUri);
  return response.blob();
}

/** อัปโหลดรูปที่ย่อแล้วตามอัตราส่วนฟีด → public URL */
export async function uploadCommunityFeedImageFromUri(
  userId: string,
  localUri: string,
  layout: FeedImageLayout
): Promise<string> {
  const prepared = await prepareFeedImageForLayout(localUri, layout);
  const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 9)}.jpg`;
  const blob = await blobFromUri(prepared);

  const { error: upErr } = await supabase.storage
    .from('community_feed')
    .upload(path, blob, { upsert: false, contentType: 'image/jpeg' });

  if (upErr) {
    throw new Error(upErr.message);
  }

  const { data } = supabase.storage.from('community_feed').getPublicUrl(path);
  return data.publicUrl;
}

export type UploadCommunityFeedVideoOptions = {
  /** เรียกเมื่อเริ่ม/จบขั้นบีบวิดีโอ (native เท่านั้น) */
  onCompressing?: (active: boolean) => void;
};

/**
 * บีบวิดีโอ (ถ้าใหญ่เกินเกณฑ์ + ไม่ใช่เว็บ) แล้วอัปโหลด
 * เกิน COMMUNITY_FEED_VIDEO_MAX_BYTES หลังบีบแล้วจะ throw
 */
export async function uploadCommunityFeedVideoFromUri(
  userId: string,
  localUri: string,
  options?: UploadCommunityFeedVideoOptions
): Promise<string> {
  let uploadUri = localUri;

  if (Platform.OS !== 'web') {
    const before = await getUriFileSizeBytes(localUri);
    if (
      before != null &&
      before > COMMUNITY_FEED_VIDEO_COMPRESS_IF_LARGER_BYTES
    ) {
      options?.onCompressing?.(true);
      try {
        const { Video } = await import('react-native-compressor');
        uploadUri = await Video.compress(
          localUri,
          {
            compressionMethod: 'auto',
            minimumFileSizeForCompress: 0,
          },
          () => {}
        );
      } catch {
        uploadUri = localUri;
      } finally {
        options?.onCompressing?.(false);
      }
    }
  }

  const finalSize = await getUriFileSizeBytes(uploadUri);
  if (
    finalSize != null &&
    finalSize > COMMUNITY_FEED_VIDEO_MAX_BYTES
  ) {
    const mb = Math.round(COMMUNITY_FEED_VIDEO_MAX_BYTES / (1024 * 1024));
    throw new Error(
      `ไฟล์วิดีโอใหญ่เกิน ${mb} MB หลังบีบแล้ว — ลองเลือกคลิปสั้นลงหรือคุณภาพต่ำกว่า`
    );
  }

  const lower = uploadUri.toLowerCase();
  const ext = lower.endsWith('.mov') ? 'mov' : 'mp4';
  const contentType = ext === 'mov' ? 'video/quicktime' : 'video/mp4';
  const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 9)}.${ext}`;
  const blob = await blobFromUri(uploadUri);

  const { error: upErr } = await supabase.storage
    .from('community_feed')
    .upload(path, blob, { upsert: false, contentType });

  if (upErr) {
    throw new Error(upErr.message);
  }

  const { data } = supabase.storage.from('community_feed').getPublicUrl(path);
  return data.publicUrl;
}
