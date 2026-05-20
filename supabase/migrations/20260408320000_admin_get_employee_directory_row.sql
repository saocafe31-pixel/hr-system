-- แอดมินโหลดแถว employee หนึ่งแถวแบบเดียวกับ view employee_directory โดยข้าม RLS
-- (view employee_directory ใช้ security_invoker → แอดมินมักอ่านแถวคนอื่นไม่ได้ ฟอร์มแก้ไข HR เลยว่าง)
do $$
declare
  has_branch boolean;
  has_branch_code boolean;
  has_branch_id_col boolean;
  branch_expr text;
  branch_id_expr text;
begin
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'employee'
      and column_name = 'branch_id'
  )
  into has_branch_id_col;

  if has_branch_id_col then
    branch_id_expr := 'e.branch_id';
  else
    branch_id_expr := 'null::bigint';
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

  execute format(
    $create$
create or replace function public.admin_get_employee_directory_row(p_id uuid)
returns table (
  id uuid,
  legacy_user_id text,
  employee_no integer,
  prefix text,
  name text,
  surname text,
  nickname text,
  "position" text,
  branch text,
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
    case
      when e."Employee ID" is null then null::integer
      else (e."Employee ID")::integer
    end as employee_no,
    nullif(trim(e."Prefix"::text), '') as prefix,
    nullif(trim(e."Name"::text), '') as name,
    nullif(trim(e."Surname"::text), '') as surname,
    nullif(trim(e.nickname::text), '') as nickname,
    nullif(trim(e."position"::text), '') as "position",
    %s as branch,
    %s as branch_id,
    nullif(trim(e."phone number"::text), '') as phone,
    case
      when e."Start date" is null then null::text
      else trim(e."Start date"::text)
    end as start_date,
    nullif(trim(e."National ID number"::text), '') as national_id,
    nullif(trim(e."Address as per ID card"::text), '') as address_id_card,
    nullif(trim(e."Current address"::text), '') as current_address,
    nullif(trim(e.bank::text), '') as bank,
    nullif(trim(e."Account number"::text), '') as account_number,
    nullif(trim(e.status::text), '') as status
  from public.employee e
  where e.id = p_id
  limit 1;
end;
$fn$;
$create$,
    branch_expr,
    branch_id_expr
  );

  grant execute on function public.admin_get_employee_directory_row(uuid) to authenticated;
end $$;
