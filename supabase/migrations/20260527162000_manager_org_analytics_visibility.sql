-- Allow managers to read organization-wide source rows used by the Team work analytics panel.
-- Mutations remain governed by existing scoped/admin policies and RPC checks.

drop policy if exists "attendance_select" on public.attendance_logs;
create policy "attendance_select" on public.attendance_logs
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_admin()
    or public.is_manager()
    or exists (
      select 1
      from public.profiles p
      where p.id = attendance_logs.user_id
        and p.role = 'employee'
    )
  );

drop policy if exists "leave_select_visible" on public.leave_requests;
create policy "leave_select_visible" on public.leave_requests
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_admin()
    or public.is_manager()
  );

drop policy if exists "late_select_visible" on public.late_requests;
create policy "late_select_visible" on public.late_requests
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_admin()
    or public.is_manager()
  );

drop policy if exists "wsa_select_scoped" on public.work_schedule_assignments;
create policy "wsa_select_scoped" on public.work_schedule_assignments
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_admin()
    or public.is_manager()
    or (
      not public.is_admin()
      and public.same_branch_as(user_id)
    )
  );

drop policy if exists "schedules_select" on public.work_schedules;
create policy "schedules_select" on public.work_schedules
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_admin()
    or public.is_manager()
    or (
      not public.is_admin()
      and public.same_branch_as(user_id)
    )
  );
