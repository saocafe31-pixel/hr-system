-- Allow admins/HR (admin role) to adjust employee attendance logs from the Team page.

drop policy if exists "attendance_insert_admin" on public.attendance_logs;
create policy "attendance_insert_admin" on public.attendance_logs
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists "attendance_update_admin" on public.attendance_logs;
create policy "attendance_update_admin" on public.attendance_logs
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "attendance_delete_admin" on public.attendance_logs;
create policy "attendance_delete_admin" on public.attendance_logs
  for delete to authenticated
  using (public.is_admin());
