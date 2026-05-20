alter table public.attendance_logs
  drop constraint if exists attendance_logs_kind_check;

alter table public.attendance_logs
  add constraint attendance_logs_kind_check
  check (kind in ('check_in', 'check_out', 'break_start', 'break_end'));

drop policy if exists "settings_select_announcement_slides" on public.app_settings;
create policy "settings_select_announcement_slides" on public.app_settings
  for select to authenticated
  using (
    key in (
      'announcement_slides',
      'attendance_break_start_messages',
      'attendance_break_end_messages'
    )
  );
