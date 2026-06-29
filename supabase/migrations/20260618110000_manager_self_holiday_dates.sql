-- ผู้จัดการตั้งวันหยุด/โน้ตปฏิทินให้ตัวเองได้ (เดิม RLS อนุญาตเฉพาะลูกทีมใน manager_direct_reports)

create or replace function public.manager_may_manage_subordinate(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_manager()
    and (
      p_user = auth.uid()
      or public.is_direct_report_of_me(p_user)
    );
$$;

revoke all on function public.manager_may_manage_subordinate(uuid) from public;
grant execute on function public.manager_may_manage_subordinate(uuid) to authenticated;

-- employee_holiday_dates: ผู้จัดการ insert/update/delete แถวของตัวเอง
drop policy if exists "ehd_insert_scoped" on public.employee_holiday_dates;
create policy "ehd_insert_scoped" on public.employee_holiday_dates
  for insert to authenticated
  with check (
    user_id = auth.uid()
    or public.is_admin()
    or public.manager_may_manage_subordinate(user_id)
  );

drop policy if exists "ehd_update_scoped" on public.employee_holiday_dates;
create policy "ehd_update_scoped" on public.employee_holiday_dates
  for update to authenticated
  using (
    user_id = auth.uid()
    or public.is_admin()
    or public.manager_may_manage_subordinate(user_id)
  )
  with check (
    user_id = auth.uid()
    or public.is_admin()
    or public.manager_may_manage_subordinate(user_id)
  );

drop policy if exists "ehd_delete_scoped" on public.employee_holiday_dates;
create policy "ehd_delete_scoped" on public.employee_holiday_dates
  for delete to authenticated
  using (
    user_id = auth.uid()
    or public.is_admin()
    or public.manager_may_manage_subordinate(user_id)
  );
