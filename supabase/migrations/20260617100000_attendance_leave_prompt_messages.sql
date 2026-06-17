-- Popup messages shown before opening leave request form on attendance page.

insert into public.app_settings (key, value)
values (
  'attendance_leave_prompt_messages',
  '{
    "messages": [
      "กรุณาตรวจสอบยอดวันลาคงเหลือก่อนส่งคำขอ",
      "หากลาหลายวัน โปรดระบุวันที่ให้ครบถ้วนและแนบหลักฐานถ้าจำเป็น",
      "คำขอลาจะส่งถึงผู้จัดการเพื่อพิจารณา — รอการอนุมัติก่อนลาจริงนะ"
    ]
  }'::jsonb
)
on conflict (key) do nothing;

drop policy if exists "settings_select_announcement_slides" on public.app_settings;
create policy "settings_select_announcement_slides" on public.app_settings
  for select to authenticated
  using (
    key in (
      'announcement_slides',
      'attendance_break_start_messages',
      'attendance_break_end_messages',
      'attendance_kpi_settings',
      'payroll_company_info',
      'attendance_leave_prompt_messages'
    )
  );
