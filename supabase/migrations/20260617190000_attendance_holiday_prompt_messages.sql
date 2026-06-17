-- Popup messages when today is a company or personal holiday on attendance page.

insert into public.app_settings (key, value)
values (
  'attendance_holiday_prompt_messages',
  '{
    "messages": [
      "วันนี้เป็นวันหยุดตามตาราง — พักผ่อนให้เต็มที่นะ 🌿",
      "วันนี้ไม่ต้องเข้างานตามกะ — ขอให้มีความสุขกับวันหยุด",
      "ระบบบันทึกว่าวันนี้เป็นวันหยุดของคุณ — หากมีงานด่วนโปรดประสานหัวหน้าทีม"
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
      'attendance_leave_prompt_messages',
      'attendance_holiday_prompt_messages'
    )
  );
