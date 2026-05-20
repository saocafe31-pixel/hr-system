-- แอดมิน: หา profiles.id จาก employee.id (เชื่อม vacation_grants / วันลาในโมดัล)
-- รองรับกรณี client .eq('employee_id', ...) ไม่คืนแถว (schema cache / ชนิดข้อมูล / RLS ขอบเคส)

create or replace function public.admin_profile_id_for_employee(p_employee_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select p.id into v_id
  from public.profiles p
  where p.employee_id = p_employee_id
  limit 1;

  if v_id is not null then
    return v_id;
  end if;

  select p.id into v_id
  from public.profiles p
  inner join public.employee e on e.id = p_employee_id
  where p.email is not null
    and e."UserID" is not null
    and lower(btrim(p.email::text)) = lower(btrim(e."UserID"::text))
  limit 1;

  if v_id is not null then
    return v_id;
  end if;

  select p.id into v_id
  from public.profiles p
  inner join public.employee e on e.id = p_employee_id
  where p.employee_code is not null
    and e."Employee ID" is not null
    and btrim(p.employee_code::text) = btrim((e."Employee ID")::text)
  limit 1;

  return v_id;
end;
$$;

grant execute on function public.admin_profile_id_for_employee(uuid) to authenticated;
