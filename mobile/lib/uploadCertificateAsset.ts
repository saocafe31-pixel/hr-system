import * as ImagePicker from 'expo-image-picker';

import { supabase } from '@/lib/supabase';

function extFromUri(localUri: string, mimeType?: string | null): string {
  const lower = localUri.toLowerCase();
  if (mimeType?.includes('png')) return 'png';
  if (mimeType?.includes('webp')) return 'webp';
  if (lower.includes('.png')) return 'png';
  if (lower.includes('.webp')) return 'webp';
  return 'jpg';
}

export async function pickAndUploadCertificateAsset(
  kind: 'signature' | 'logo'
): Promise<string> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    throw new Error('ไม่ได้รับอนุญาตให้เข้าถึงคลังรูป');
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsEditing: false,
    quality: 0.92,
  });
  if (result.canceled || !result.assets?.[0]?.uri) {
    throw new Error('ยกเลิกการเลือกไฟล์');
  }
  const asset = result.assets[0];
  const ext = extFromUri(asset.uri, asset.mimeType);
  const path = `${kind}/${Date.now()}-${Math.random().toString(36).slice(2, 9)}.${ext}`;
  const contentType =
    ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';

  const response = await fetch(asset.uri);
  const blob = await response.blob();
  const { error } = await supabase.storage
    .from('employment_certificate_assets')
    .upload(path, blob, { upsert: false, contentType });
  if (error) throw new Error(error.message);

  const { data } = supabase.storage
    .from('employment_certificate_assets')
    .getPublicUrl(path);
  return data.publicUrl;
}
