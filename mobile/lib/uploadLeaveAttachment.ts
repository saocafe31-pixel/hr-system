import * as DocumentPicker from 'expo-document-picker';

import { supabase } from '@/lib/supabase';

function guessContentType(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.heic')) return 'image/heic';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'application/octet-stream';
}

/** อัปโหลดไป bucket leave_attachments โฟลเดอร์แรก = userId (ตาม RLS) */
export async function pickAndUploadLeaveAttachment(userId: string): Promise<{
  url: string;
  fileName: string;
}> {
  const picked = await DocumentPicker.getDocumentAsync({
    multiple: false,
    copyToCacheDirectory: true,
    type: ['image/*', 'application/pdf'],
  });
  if (picked.canceled || !picked.assets?.[0]) {
    throw new Error('ยกเลิกการเลือกไฟล์');
  }

  const file = picked.assets[0];
  const fileName = file.name || `leave-${Date.now()}`;
  const ext = fileName.includes('.') ? fileName.split('.').pop() : 'bin';
  const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 9)}.${ext}`;
  const contentType = file.mimeType || guessContentType(fileName);

  const response = await fetch(file.uri);
  const blob = await response.blob();

  const { error: upErr } = await supabase.storage
    .from('leave_attachments')
    .upload(path, blob, { upsert: false, contentType });

  if (upErr) {
    throw new Error(upErr.message);
  }

  const { data } = supabase.storage.from('leave_attachments').getPublicUrl(path);
  return {
    url: data.publicUrl,
    fileName,
  };
}
