import * as ImagePicker from 'expo-image-picker';

import { supabase } from '@/lib/supabase';

/** อัปโหลดรูปไป bucket task_files โฟลเดอร์แรก = userId (ตาม RLS) */
export async function pickAndUploadTaskImage(userId: string): Promise<string> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    throw new Error('ไม่ได้รับอนุญาตให้เข้าถึงคลังรูป');
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsEditing: false,
    quality: 0.88,
  });

  if (result.canceled || !result.assets?.[0]?.uri) {
    throw new Error('ยกเลิกการเลือกรูป');
  }

  const uri = result.assets[0].uri;
  const lower = uri.toLowerCase();
  const ext = lower.includes('.png') ? 'png' : 'jpg';
  const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 9)}.${ext}`;
  const contentType = ext === 'png' ? 'image/png' : 'image/jpeg';

  const response = await fetch(uri);
  const blob = await response.blob();

  const { error: upErr } = await supabase.storage
    .from('task_files')
    .upload(path, blob, { upsert: false, contentType });

  if (upErr) {
    throw new Error(upErr.message);
  }

  const { data } = supabase.storage.from('task_files').getPublicUrl(path);
  return data.publicUrl;
}
