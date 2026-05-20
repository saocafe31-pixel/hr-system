drop policy if exists "attendance_select" on public.attendance_logs;
create policy "attendance_select" on public.attendance_logs
  for select to authenticated using (
    user_id = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = attendance_logs.user_id and p.role = 'employee'
    )
    or public.is_admin()
    or (
      public.is_manager()
      and public.same_branch_as(user_id)
    )
  );

