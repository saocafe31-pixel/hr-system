import * as ImagePicker from 'expo-image-picker';

import { supabase } from '@/lib/supabase';

/**
 * เลือกรูปจากเครื่อง เพื่อครอป/อัปโหลดต่อในหน้าโปรไฟล์
 */
export async function pickAvatarFromLibrary(): Promise<ImagePicker.ImagePickerAsset> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    throw new Error('ไม่ได้รับอนุญาตให้เข้าถึงคลังรูป');
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsEditing: false,
    quality: 1,
  });

  if (result.canceled || !result.assets?.[0]?.uri) {
    throw new Error('ยกเลิกการเลือกรูป');
  }

  return result.assets[0];
}

/**
 * อัปโหลดรูปไป bucket avatars ที่ path {userId}/avatar.{ext}
 * คืนค่า public URL พร้อม cache-busting query string เพื่อให้รูปอัปเดตทันที
 */
export async function uploadAvatarUri(userId: string, uri: string): Promise<string> {
  const lower = uri.toLowerCase();
  const ext = lower.includes('.png') ? 'png' : 'jpg';
  const path = `${userId}/avatar.${ext}`;
  const contentType = ext === 'png' ? 'image/png' : 'image/jpeg';

  const response = await fetch(uri);
  const blob = await response.blob();

  const { error: upErr } = await supabase.storage
    .from('avatars')
    .upload(path, blob, { upsert: true, contentType });

  if (upErr) {
    throw new Error(upErr.message);
  }

  const { data } = supabase.storage.from('avatars').getPublicUrl(path);
  return `${data.publicUrl}?v=${Date.now()}`;
}
