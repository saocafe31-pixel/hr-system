-- ให้ผู้ใช้ที่ล็อกอินแล้วอ่าน URL สไลด์ประกาศได้ (แอดมินยังเป็นคนแก้ผ่าน policy เดิม)
drop policy if exists "settings_select_announcement_slides" on public.app_settings;
create policy "settings_select_announcement_slides" on public.app_settings
  for select to authenticated
  using (key = 'announcement_slides');
