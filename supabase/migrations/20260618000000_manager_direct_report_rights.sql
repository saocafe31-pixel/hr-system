-- ผู้จัดการที่แอดมินมอบหมายลูกทีมแล้ว จัดการวันหยุด/ตาราง/อนุมัติลาได้โดยไม่ต้องเปิดสวิตช์ manager_scopes แยก
-- (ยังเก็บ manager_scopes ไว้สำหรับ UI/แอดมินปรับละเอียด — backfill เปิดสิทธิ์ให้ manager ที่มีลูกทีมอยู่แล้ว)

create or replace function public.manager_may_manage_subordinate(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_manager()
    and public.is_direct_report_of_me(p_user);
$$;

revoke all on function public.manager_may_manage_subordinate(uuid) from public;
grant execute on function public.manager_may_manage_subordinate(uuid) to authenticated;

-- ---------- employee_holiday_dates ----------
create table if not exists public.employee_holiday_dates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  holiday_date date not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (user_id, holiday_date)
);

alter table public.employee_holiday_dates enable row level security;

drop policy if exists "ehd_select_scoped" on public.employee_holiday_dates;
create policy "ehd_select_scoped" on public.employee_holiday_dates
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_admin()
    or public.manager_may_manage_subordinate(user_id)
  );

drop policy if exists "ehd_write_scoped" on public.employee_holiday_dates;
drop policy if exists "ehd_insert_scoped" on public.employee_holiday_dates;
drop policy if exists "ehd_update_scoped" on public.employee_holiday_dates;
drop policy if exists "ehd_delete_scoped" on public.employee_holiday_dates;

create policy "ehd_insert_scoped" on public.employee_holiday_dates
  for insert to authenticated
  with check (
    public.is_admin()
    or public.manager_may_manage_subordinate(user_id)
  );

create policy "ehd_update_scoped" on public.employee_holiday_dates
  for update to authenticated
  using (
    public.is_admin()
    or public.manager_may_manage_subordinate(user_id)
  )
  with check (
    public.is_admin()
    or public.manager_may_manage_subordinate(user_id)
  );

create policy "ehd_delete_scoped" on public.employee_holiday_dates
  for delete to authenticated
  using (
    public.is_admin()
    or public.manager_may_manage_subordinate(user_id)
  );

-- ---------- work_schedule_assignments (write) ----------
drop policy if exists "wsa_write_scoped" on public.work_schedule_assignments;
create policy "wsa_write_scoped" on public.work_schedule_assignments
  for all to authenticated
  using (
    public.is_admin()
    or (
      public.is_manager()
      and (
        user_id = auth.uid()
        or public.is_direct_report_of_me(user_id)
      )
    )
  )
  with check (
    public.is_admin()
    or (
      public.is_manager()
      and (
        user_id = auth.uid()
        or public.is_direct_report_of_me(user_id)
      )
    )
  );

-- ---------- leave_requests (read pending for team) ----------
drop policy if exists "leave_select_visible" on public.leave_requests;
create policy "leave_select_visible" on public.leave_requests
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_admin()
    or public.manager_may_manage_subordinate(user_id)
  );

-- ---------- respond_leave_request ----------
create or replace function public.respond_leave_request(
  p_leave_id uuid,
  p_approve boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
  v_sub uuid;
  v_actor uuid := auth.uid();
  v_status text := case when p_approve then 'approved' else 'rejected' end;
begin
  if public.is_admin() then
    null;
  elsif public.is_manager() then
    select lr.user_id into v_sub
    from public.leave_requests lr
    where lr.id = p_leave_id;
    if v_sub is null then
      return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    if not public.is_direct_report_of_me(v_sub) then
      return jsonb_build_object('ok', false, 'error', 'forbidden');
    end if;
  else
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  update public.leave_requests
  set status = v_status
  where id = p_leave_id
    and status = 'pending'
  returning user_id into v_sub;

  get diagnostics n = row_count;
  if n < 1 then
    return jsonb_build_object('ok', false, 'error', 'not_pending_or_missing');
  end if;

  perform public.notify_status_update(
    v_sub,
    v_actor,
    'leave_status',
    'leave',
    p_leave_id,
    v_status,
    'คำขอลาของคุณถูก' || case when p_approve then 'อนุมัติแล้ว' else 'ปฏิเสธแล้ว' end
  );

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.respond_leave_request(uuid, boolean) from public;
grant execute on function public.respond_leave_request(uuid, boolean) to authenticated;

-- ---------- attendance_calendar_notes ----------
drop policy if exists "attendance_calendar_notes_insert_scoped" on public.attendance_calendar_notes;
create policy "attendance_calendar_notes_insert_scoped" on public.attendance_calendar_notes
  for insert to authenticated
  with check (
    auth.uid() = user_id
    or public.is_admin()
    or public.manager_may_manage_subordinate(user_id)
  );

drop policy if exists "attendance_calendar_notes_update_scoped" on public.attendance_calendar_notes;
create policy "attendance_calendar_notes_update_scoped" on public.attendance_calendar_notes
  for update to authenticated
  using (
    auth.uid() = user_id
    or public.is_admin()
    or public.manager_may_manage_subordinate(user_id)
  )
  with check (
    auth.uid() = user_id
    or public.is_admin()
    or public.manager_may_manage_subordinate(user_id)
  );

drop policy if exists "attendance_calendar_notes_delete_scoped" on public.attendance_calendar_notes;
create policy "attendance_calendar_notes_delete_scoped" on public.attendance_calendar_notes
  for delete to authenticated
  using (
    auth.uid() = user_id
    or public.is_admin()
    or public.manager_may_manage_subordinate(user_id)
  );

-- ---------- admin_set_manager_direct_reports: เปิดสิทธิ์อัตโนมัติเมื่อมีลูกทีม ----------
create or replace function public.admin_set_manager_direct_reports(
  p_manager_id uuid,
  p_subordinate_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  sid uuid;
  v_count int := 0;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if not exists (
    select 1 from public.profiles p where p.id = p_manager_id and p.role = 'manager'
  ) then
    return jsonb_build_object('ok', false, 'error', 'not_manager');
  end if;

  delete from public.manager_direct_reports where manager_id = p_manager_id;

  foreach sid in array coalesce(p_subordinate_ids, array[]::uuid[]) loop
    continue when sid is null or sid = p_manager_id;
    if exists (select 1 from public.profiles p where p.id = sid and p.role = 'admin') then
      continue;
    end if;
    if not exists (select 1 from public.profiles p where p.id = sid) then
      continue;
    end if;
    insert into public.manager_direct_reports (manager_id, subordinate_id)
    values (p_manager_id, sid)
    on conflict (manager_id, subordinate_id) do nothing;
    v_count := v_count + 1;
  end loop;

  if v_count > 0 then
    insert into public.manager_scopes (manager_id, can_approve_leave, can_manage_schedule, updated_by)
    values (p_manager_id, true, true, auth.uid())
    on conflict (manager_id) do update set
      can_approve_leave = true,
      can_manage_schedule = true,
      updated_at = now(),
      updated_by = auth.uid();
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.admin_set_manager_direct_reports(uuid, uuid[]) from public;
grant execute on function public.admin_set_manager_direct_reports(uuid, uuid[]) to authenticated;

-- backfill สิทธิ์ manager ที่มีลูกทีมอยู่แล้ว
insert into public.manager_scopes (manager_id, can_approve_leave, can_manage_schedule)
select distinct r.manager_id, true, true
from public.manager_direct_reports r
join public.profiles p on p.id = r.manager_id and p.role = 'manager'
on conflict (manager_id) do update set
  can_approve_leave = true,
  can_manage_schedule = true,
  updated_at = now();
