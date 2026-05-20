-- ดึงรายชื่อ employee_directory ทั้งหมดสำหรับ admin/HR(manager)
-- แก้ปัญหา view employee_directory ถูกจำกัดด้วย RLS (security_invoker)

create or replace function public.admin_list_employee_directory_rows()
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
    branch_expr
  );
end;
$$;

grant execute on function public.admin_list_employee_directory_rows() to authenticated;
