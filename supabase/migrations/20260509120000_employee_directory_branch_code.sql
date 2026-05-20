-- ส่ง branch_code จากตาราง employee ไปยัง RPC / view (จัดกลุ่มทีมตาม employee.branch + branch_code)

-- ---------- RPC admin_list_employee_directory_rows ----------
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
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin', 'manager')
  ) then
    return;
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'employee'
      and column_name = 'branch_id'
  ) then
    branch_expr := 'null::bigint';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'employee'
      and column_name = 'branch_code'
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

-- ---------- View employee_directory (+ branch_code) ----------
do $$
declare
  branch_expr text := 'null::bigint';
  code_expr text := 'null::text';
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'employee'
      and column_name = 'branch_id'
  ) then
    branch_expr := 'e.branch_id';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'employee'
      and column_name = 'branch_code'
  ) then
    code_expr := 'e.branch_code';
  end if;

  execute
    'create or replace view public.employee_directory
    with (security_invoker = true) as
    select
      e.id,
      e."UserID" as legacy_user_id,
      e."Employee ID" as employee_no,
      e."Prefix" as prefix,
      e."Name" as name,
      e."Surname" as surname,
      e.nickname,
      e.position,
      e.branch,
      ' || branch_expr || ' as branch_id,
      e."phone number" as phone,
      e."Start date" as start_date,
      e."National ID number" as national_id,
      e."Address as per ID card" as address_id_card,
      e."Current address" as current_address,
      e.bank,
      e."Account number" as account_number,
      e.status,
      ' || code_expr || ' as branch_code
    from public.employee e';
end $$;
