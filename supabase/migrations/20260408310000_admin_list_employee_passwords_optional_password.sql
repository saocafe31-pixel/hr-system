-- RPC admin_list_employee_passwords: รองรับตาราง employee ที่ไม่มีคอลัมน์ Password (ใช้ null แทน)
do $$
declare
  has_branch boolean;
  has_branch_code boolean;
  branch_expr text;
  password_expr text;
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

  execute format(
    $create$
create or replace function public.admin_list_employee_passwords()
returns table (
  id uuid,
  legacy_user_id text,
  legacy_password text,
  employee_no integer,
  display_name text,
  branch text
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
    %s as branch
  from public.employee e
  order by e."Employee ID" nulls last, e.id;
end;
$fn$;
$create$,
    password_expr,
    branch_expr
  );

  grant execute on function public.admin_list_employee_passwords() to authenticated;
end $$;
