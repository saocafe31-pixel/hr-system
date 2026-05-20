-- ประวัติการลาออก + RPC บันทึกลาออก + เพิ่ม employment_status ใน admin_list_employee_passwords

create table if not exists public.employee_resignations (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references public.employee (id) on delete set null,
  employee_no_snapshot integer,
  display_name_snapshot text,
  resigned_at timestamptz not null default now(),
  note text,
  recorded_by uuid references public.profiles (id) on delete set null
);

comment on table public.employee_resignations is
  'ประวัติการลาออกที่แอดมินบันทึก — employee_id อาจเป็น null หลังลบแถว employee';

create index if not exists employee_resignations_employee_id_idx
  on public.employee_resignations (employee_id);

create index if not exists employee_resignations_resigned_at_idx
  on public.employee_resignations (resigned_at desc);

alter table public.employee_resignations enable row level security;

drop policy if exists "employee_resignations_admin_select" on public.employee_resignations;
create policy "employee_resignations_admin_select" on public.employee_resignations
  for select to authenticated using (public.is_admin());

drop policy if exists "employee_resignations_admin_insert" on public.employee_resignations;
create policy "employee_resignations_admin_insert" on public.employee_resignations
  for insert to authenticated with check (public.is_admin());

-- ---------- RPC: บันทึกลาออก + ตั้งสถานะใน employee ----------
create or replace function public.admin_record_employee_resignation(
  p_employee_id uuid,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_eno integer;
  v_name text;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select
    case
      when e."Employee ID" is null then null::integer
      else (e."Employee ID")::integer
    end,
    trim(
      both ' '
      from
        coalesce(nullif(trim(e."Prefix"::text), ''), '') || ' ' ||
        coalesce(nullif(trim(e."Name"::text), ''), '') || ' ' ||
        coalesce(nullif(trim(e."Surname"::text), ''), '')
    )
  into v_eno, v_name
  from public.employee e
  where e.id = p_employee_id;

  if not found then
    raise exception 'employee_not_found' using errcode = 'P0002';
  end if;

  insert into public.employee_resignations (
    employee_id,
    employee_no_snapshot,
    display_name_snapshot,
    note,
    recorded_by
  ) values (
    p_employee_id,
    v_eno,
    nullif(trim(v_name), ''),
    nullif(trim(p_note), ''),
    auth.uid()
  );

  update public.employee e
  set status = 'ลาออก'
  where e.id = p_employee_id;
end;
$$;

revoke all on function public.admin_record_employee_resignation(uuid, text) from public;
grant execute on function public.admin_record_employee_resignation(uuid, text) to authenticated;

comment on function public.admin_record_employee_resignation(uuid, text) is
  'แอดมิน: แทรก employee_resignations และตั้ง employee.status เป็น ลาออก';

-- ---------- admin_list_employee_passwords: เพิ่ม employment_status ----------
-- ต้อง DROP ก่อน: PG ไม่ให้ CREATE OR REPLACE เมื่อเปลี่ยน shape ของ OUT/returns table (42P13)
do $$
declare
  has_branch boolean;
  has_branch_code boolean;
  has_status boolean;
  branch_expr text;
  password_expr text;
  status_expr text;
  pw_att name;
begin
  select a.attname
  into pw_att
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'employee'
    and a.attnum > 0
    and not a.attisdropped
    and lower(a.attname) = 'password'
  order by a.attname
  limit 1;

  if pw_att is not null then
    password_expr := format('(e.%I)::text', pw_att);
  else
    password_expr := 'null::text';
  end if;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'employee'
      and column_name = 'branch'
  )
  into has_branch;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'employee'
      and column_name = 'branch_code'
  )
  into has_branch_code;

  if has_branch and has_branch_code then
    branch_expr :=
      'nullif(trim(coalesce(nullif(trim(e.branch::text), ''''), nullif(trim(e.branch_code::text), ''''))), '''')';
  elsif has_branch then
    branch_expr := 'nullif(trim(e.branch::text), '''')';
  elsif has_branch_code then
    branch_expr := 'nullif(trim(e.branch_code::text), '''')';
  else
    branch_expr := 'null::text';
  end if;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'employee'
      and column_name = 'status'
  )
  into has_status;

  if has_status then
    status_expr := 'nullif(trim(e.status::text), '''')';
  else
    status_expr := 'null::text';
  end if;

  execute 'drop function if exists public.admin_list_employee_passwords()';

  execute format(
    $create$
create or replace function public.admin_list_employee_passwords()
returns table (
  id uuid,
  legacy_user_id text,
  legacy_password text,
  employee_no integer,
  display_name text,
  branch text,
  employment_status text
)
language plpgsql
security definer
set search_path = public
stable
as $fn$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
  select
    e.id,
    nullif(trim(e."UserID"::text), '') as legacy_user_id,
    %s as legacy_password,
    case
      when e."Employee ID" is null then null::integer
      else (e."Employee ID")::integer
    end as employee_no,
    trim(
      both ' '
      from
        coalesce(nullif(trim(e."Prefix"::text), ''), '') || ' ' ||
        coalesce(nullif(trim(e."Name"::text), ''), '') || ' ' ||
        coalesce(nullif(trim(e."Surname"::text), ''), '')
    ) as display_name,
    %s as branch,
    %s as employment_status
  from public.employee e
  order by e."Employee ID" nulls last, e.id;
end;
$fn$;
$create$,
    password_expr,
    branch_expr,
    status_expr
  );

  grant execute on function public.admin_list_employee_passwords() to authenticated;
end $$;
