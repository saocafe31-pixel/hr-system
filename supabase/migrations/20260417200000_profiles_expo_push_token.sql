-- เก็บ Expo push token สำหรับแจ้งเตือนระยะไกล (รุ่นถัดไป / Edge Function)
alter table public.profiles add column if not exists expo_push_token text;

comment on column public.profiles.expo_push_token is 'Expo push token — อัปเดตจากแอปเมื่อผู้ใช้อนุญาตการแจ้งเตือน';
