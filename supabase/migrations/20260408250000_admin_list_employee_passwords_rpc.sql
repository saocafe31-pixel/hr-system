-- RPC สำหรับแอดมิน: รายการพนักงาน + รหัส legacy (อ่านตาราง employee โดยข้าม RLS ของผู้ใช้ทั่วไป)
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
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
  select
    e.id,
    nullif(trim(e."UserID"::text), '') as legacy_user_id,
    (e."Password")::text as legacy_password,
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
    nullif(trim(e.branch::text), '') as branch
  from public.employee e
  order by e."Employee ID" nulls last, e.id;
end;
$$;

grant execute on function public.admin_list_employee_passwords() to authenticated;
