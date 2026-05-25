-- Let managers view leave/late/KPI inputs for direct reports in the Team employee modal.

drop policy if exists "leave_select_visible" on public.leave_requests;
create policy "leave_select_visible" on public.leave_requests
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_admin()
    or (
      public.is_manager()
      and public.is_direct_report_of_me(user_id)
    )
  );

drop policy if exists "vacation_grants_select" on public.vacation_grants;
create policy "vacation_grants_select" on public.vacation_grants
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_admin()
    or (
      public.is_manager()
      and public.is_direct_report_of_me(user_id)
    )
  );

drop policy if exists "late_select_own_or_admin" on public.late_requests;
drop policy if exists "late_select_visible" on public.late_requests;
create policy "late_select_visible" on public.late_requests
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_admin()
    or (
      public.is_manager()
      and public.is_direct_report_of_me(user_id)
    )
  );
