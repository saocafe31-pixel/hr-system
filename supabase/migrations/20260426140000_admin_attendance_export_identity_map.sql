-- แมป profile_id → รหัสพนักงาน + ชื่อเล่น สำหรับ export เวลาเข้า-ออก
-- แก้กรณี RLS ทำให้ client อ่าน profiles / employee ของคนอื่นไม่ครบ

create or replace function public.admin_attendance_export_identity_map()
returns table (
  profile_id uuid,
  employee_code text,
  employee_no bigint,
  nickname text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin', 'manager')
  ) then
    return;
  end if;

  return query
  select
    p.id as profile_id,
    p.employee_code,
    coalesce(
      elink."Employee ID"::bigint,
      email."Employee ID"::bigint
    ) as employee_no,
    coalesce(
      elink.nickname::text,
      email.nickname::text
    ) as nickname
  from public.profiles p
  left join public.employee elink on elink.id = p.employee_id
  left join public.employee email
    on p.employee_id is null
    and lower(btrim(coalesce(email."UserID"::text, ''))) = lower(btrim(coalesce(p.email, '')));
end;
$$;

grant execute on function public.admin_attendance_export_identity_map() to authenticated;
