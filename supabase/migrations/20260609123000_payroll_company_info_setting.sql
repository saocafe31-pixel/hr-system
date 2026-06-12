-- Company information shown in payslip PDF headers.
-- Admins can edit app_settings through the existing admin settings panel.

insert into public.app_settings (key, value)
values (
  'payroll_company_info',
  '{
    "name": "",
    "address_lines": [],
    "juristic_id": ""
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
      'payroll_company_info'
    )
  );
