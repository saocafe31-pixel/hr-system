-- สิทธิ์ผู้จัดการแบบจำกัดขอบเขต (แอดมินกำหนด) + พนักงานภายใต้การดูแล
-- ผลกับ: รายชื่อทีมผู้จัดการ, อนุมัติลา, มอบหมายกะ (work_schedule_assignments), อ่าน/แก้ employee ของลูกทีม

-- ---------- ตาราง (สร้างก่อนฟังก์ชันที่อ้างถึงตาราง) ----------
create table if not exists public.manager_scopes (
  manager_id uuid primary key references public.profiles (id) on delete cascade,
  can_approve_leave boolean not null default false,
  can_manage_schedule boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

create table if not exists public.manager_direct_reports (
  id uuid primary key default gen_random_uuid(),
  manager_id uuid not null references public.profiles (id) on delete cascade,
  subordinate_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (manager_id, subordinate_id),
  constraint manager_direct_reports_no_self check (manager_id <> subordinate_id)
);

create index if not exists manager_direct_reports_subordinate_idx
  on public.manager_direct_reports (subordinate_id);

alter table public.manager_scopes enable row level security;
alter table public.manager_direct_reports enable row level security;

drop policy if exists "manager_scopes_select" on public.manager_scopes;
create policy "manager_scopes_select" on public.manager_scopes
  for select to authenticated
  using (public.is_admin() or manager_id = auth.uid());

drop policy if exists "manager_scopes_write_admin" on public.manager_scopes;
create policy "manager_scopes_write_admin" on public.manager_scopes
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "manager_reports_select" on public.manager_direct_reports;
create policy "manager_reports_select" on public.manager_direct_reports
  for select to authenticated
  using (public.is_admin() or manager_id = auth.uid());

drop policy if exists "manager_reports_write_admin" on public.manager_direct_reports;
create policy "manager_reports_write_admin" on public.manager_direct_reports
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------- helper: ลูกทีมโดยตรงของผู้ใช้ปัจจุบัน ----------
create or replace function public.is_direct_report_of_me(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.manager_direct_reports r
    where r.manager_id = auth.uid()
      and r.subordinate_id = p_user
  );
$$;

revoke all on function public.is_direct_report_of_me(uuid) from public;
grant execute on function public.is_direct_report_of_me(uuid) to authenticated;

-- ---------- RPC: แอดมินตั้งค่า ----------
create or replace function public.admin_set_manager_scope(
  p_manager_id uuid,
  p_can_approve_leave boolean,
  p_can_manage_schedule boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if not exists (
    select 1 from public.profiles p where p.id = p_manager_id and p.role = 'manager'
  ) then
    return jsonb_build_object('ok', false, 'error', 'not_manager');
  end if;

  insert into public.manager_scopes (manager_id, can_approve_leave, can_manage_schedule, updated_by)
  values (p_manager_id, p_can_approve_leave, p_can_manage_schedule, auth.uid())
  on conflict (manager_id) do update set
    can_approve_leave = excluded.can_approve_leave,
    can_manage_schedule = excluded.can_manage_schedule,
    updated_at = now(),
    updated_by = auth.uid();

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.admin_set_manager_scope(uuid, boolean, boolean) from public;
grant execute on function public.admin_set_manager_scope(uuid, boolean, boolean) to authenticated;

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
  end loop;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.admin_set_manager_direct_reports(uuid, uuid[]) from public;
grant execute on function public.admin_set_manager_direct_reports(uuid, uuid[]) to authenticated;

-- ---------- admin_list_employee_directory_rows: เฉพาะ admin ----------
drop function if exists public.admin_list_employee_directory_rows();

create function public.admin_list_employee_directory_rows()
returns table (
  id uuid,
  legacy_user_id text,
  employee_no bigint,
  prefix text,
  name text,
  surname text,
  nickname text,
  "position" text,
  branch text,
  branch_code text,
  branch_id bigint,
  phone text,
  start_date text,
  national_id text,
  address_id_card text,
  current_address text,
  bank text,
  account_number text,
  status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  branch_expr text := 'e.branch_id';
  code_expr text := 'e.branch_code::text';
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  ) then
    return;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'employee' and column_name = 'branch_id'
  ) then
    branch_expr := 'null::bigint';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'employee' and column_name = 'branch_code'
  ) then
    code_expr := 'null::text';
  end if;

  return query execute format(
    'select
      e.id,
      e."UserID"::text as legacy_user_id,
      e."Employee ID"::bigint as employee_no,
      e."Prefix"::text as prefix,
      e."Name"::text as name,
      e."Surname"::text as surname,
      e.nickname::text as nickname,
      e.position::text as position,
      e.branch::text as branch,
      %s as branch_code,
      %s as branch_id,
      e."phone number"::text as phone,
      e."Start date"::text as start_date,
      e."National ID number"::text as national_id,
      e."Address as per ID card"::text as address_id_card,
      e."Current address"::text as current_address,
      e.bank::text as bank,
      e."Account number"::text as account_number,
      e.status::text as status
    from public.employee e
    order by
      coalesce(e."Employee ID"::bigint, 9223372036854775807),
      coalesce(e."Name", ''''),
      coalesce(e."Surname", '''')',
    code_expr,
    branch_expr
  );
end;
$$;

grant execute on function public.admin_list_employee_directory_rows() to authenticated;

-- ---------- manager_list_team_directory_rows: เฉพาะลูกทีมที่แอดมินกำหนด ----------
create or replace function public.manager_list_team_directory_rows()
returns table (
  id uuid,
  legacy_user_id text,
  employee_no bigint,
  prefix text,
  name text,
  surname text,
  nickname text,
  "position" text,
  branch text,
  branch_code text,
  branch_id bigint,
  phone text,
  start_date text,
  national_id text,
  address_id_card text,
  current_address text,
  bank text,
  account_number text,
  status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  branch_expr text := 'e.branch_id';
  code_expr text := 'e.branch_code::text';
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'manager'
  ) then
    return;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'employee' and column_name = 'branch_id'
  ) then
    branch_expr := 'null::bigint';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'employee' and column_name = 'branch_code'
  ) then
    code_expr := 'null::text';
  end if;

  return query execute format(
    'select
      e.id,
      e."UserID"::text as legacy_user_id,
      e."Employee ID"::bigint as employee_no,
      e."Prefix"::text as prefix,
      e."Name"::text as name,
      e."Surname"::text as surname,
      e.nickname::text as nickname,
      e.position::text as position,
      e.branch::text as branch,
      %s as branch_code,
      %s as branch_id,
      e."phone number"::text as phone,
      e."Start date"::text as start_date,
      e."National ID number"::text as national_id,
      e."Address as per ID card"::text as address_id_card,
      e."Current address"::text as current_address,
      e.bank::text as bank,
      e."Account number"::text as account_number,
      e.status::text as status
    from public.employee e
    where e.id in (
      select p.employee_id
      from public.profiles p
      join public.manager_direct_reports r on r.subordinate_id = p.id
      where r.manager_id = auth.uid()
        and p.employee_id is not null
    )
    order by
      coalesce(e."Employee ID"::bigint, 9223372036854775807),
      coalesce(e."Name", ''''),
      coalesce(e."Surname", '''')',
    code_expr,
    branch_expr
  );
end;
$$;

grant execute on function public.manager_list_team_directory_rows() to authenticated;

-- ---------- อนุมัติลา: RPC + RLS ----------
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
begin
  if public.is_admin() then
    null;
  elsif public.is_manager() then
    if not exists (
      select 1 from public.manager_scopes s
      where s.manager_id = auth.uid() and s.can_approve_leave
    ) then
      return jsonb_build_object('ok', false, 'error', 'forbidden');
    end if;
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
  set status = case when p_approve then 'approved'::text else 'rejected'::text end
  where id = p_leave_id
    and status = 'pending';

  get diagnostics n = row_count;
  if n < 1 then
    return jsonb_build_object('ok', false, 'error', 'not_pending_or_missing');
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.respond_leave_request(uuid, boolean) from public;
grant execute on function public.respond_leave_request(uuid, boolean) to authenticated;

drop policy if exists "leave_select_own_or_admin" on public.leave_requests;
drop policy if exists "leave_select_visible" on public.leave_requests;
create policy "leave_select_visible" on public.leave_requests
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_admin()
    or (
      public.is_manager()
      and exists (
        select 1 from public.manager_scopes s
        where s.manager_id = auth.uid() and s.can_approve_leave
      )
      and public.is_direct_report_of_me(user_id)
    )
  );

-- ---------- มอบหมายกะ: จำกัดผู้จัดการตามสิทธิ์ + ลูกทีม ----------
drop policy if exists "wsa_select_own_or_mgr" on public.work_schedule_assignments;
drop policy if exists "wsa_select_scoped" on public.work_schedule_assignments;
create policy "wsa_select_scoped" on public.work_schedule_assignments
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_admin()
    or (
      public.is_manager()
      and public.is_direct_report_of_me(user_id)
    )
  );

drop policy if exists "wsa_write_mgr_admin" on public.work_schedule_assignments;
drop policy if exists "wsa_write_scoped" on public.work_schedule_assignments;
create policy "wsa_write_scoped" on public.work_schedule_assignments
  for all to authenticated
  using (
    public.is_admin()
    or (
      public.is_manager()
      and (
        user_id = auth.uid()
        or (
          exists (
            select 1 from public.manager_scopes s
            where s.manager_id = auth.uid() and s.can_manage_schedule
          )
          and public.is_direct_report_of_me(user_id)
        )
      )
    )
  )
  with check (
    public.is_admin()
    or (
      public.is_manager()
      and (
        user_id = auth.uid()
        or (
          exists (
            select 1 from public.manager_scopes s
            where s.manager_id = auth.uid() and s.can_manage_schedule
          )
          and public.is_direct_report_of_me(user_id)
        )
      )
    )
  );

-- ---------- employee: ผู้จัดการอ่าน/แก้เฉพาะแถวของลูกทีมที่กำหนด ----------
drop policy if exists "employee_select_manager_branch" on public.employee;
create policy "employee_select_manager_branch" on public.employee
  for select to authenticated
  using (
    public.is_manager()
    and exists (
      select 1
      from public.profiles p
      join public.manager_direct_reports r on r.subordinate_id = p.id
      where r.manager_id = auth.uid()
        and p.employee_id is not null
        and p.employee_id = employee.id
    )
  );

drop policy if exists "employee_update_manager" on public.employee;
create policy "employee_update_manager" on public.employee
  for update to authenticated
  using (
    public.is_manager()
    and exists (
      select 1
      from public.profiles p
      join public.manager_direct_reports r on r.subordinate_id = p.id
      where r.manager_id = auth.uid()
        and p.employee_id is not null
        and p.employee_id = employee.id
    )
  )
  with check (
    public.is_manager()
    and exists (
      select 1
      from public.profiles p
      join public.manager_direct_reports r on r.subordinate_id = p.id
      where r.manager_id = auth.uid()
        and p.employee_id is not null
        and p.employee_id = employee.id
    )
  );
