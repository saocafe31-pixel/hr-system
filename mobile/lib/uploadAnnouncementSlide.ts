import { supabase } from '@/lib/supabase';

function extFromUriAndMime(localUri: string, mimeType?: string | null): string {
  const lower = localUri.toLowerCase();
  if (mimeType?.includes('png')) return 'png';
  if (mimeType?.includes('webp')) return 'webp';
  if (mimeType?.includes('gif')) return 'gif';
  if (lower.includes('.png')) return 'png';
  if (lower.includes('.webp')) return 'webp';
  if (lower.includes('.gif')) return 'gif';
  return 'jpg';
}

/** อัปโหลดรูปประกาศไป bucket announcement_slides (path: slides/...) */
export async function uploadAnnouncementSlideFromUri(
  localUri: string,
  mimeType?: string | null
): Promise<string> {
  const ext = extFromUriAndMime(localUri, mimeType);
  const path = `slides/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
  const contentType =
    ext === 'png'
      ? 'image/png'
      : ext === 'webp'
        ? 'image/webp'
        : ext === 'gif'
          ? 'image/gif'
          : 'image/jpeg';

  const response = await fetch(localUri);
  const blob = await response.blob();

  const { error: upErr } = await supabase.storage
    .from('announcement_slides')
    .upload(path, blob, { upsert: false, contentType });

  if (upErr) {
    throw new Error(upErr.message);
  }

  const { data } = supabase.storage
    .from('announcement_slides')
    .getPublicUrl(path);
  return data.publicUrl;
}
