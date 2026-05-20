-- เชื่อม profiles.employee_id อัตโนมัติเมื่ออีเมลใน profiles ตรงกับ employee."UserID"
-- (รันครั้งเดียวหลัง import พนักงาน / เมื่อ UserID ตรงอีเมลล็อกอิน)
update public.profiles p
set employee_id = s.emp_id
from (
  select
    p2.id as profile_id,
    (
      select e.id
      from public.employee e
      where trim(lower(e."UserID"::text)) = trim(lower(p2.email::text))
      order by e.id
      limit 1
    ) as emp_id
  from public.profiles p2
  where p2.employee_id is null
    and p2.email is not null
    and trim(p2.email::text) <> ''
) s
where p.id = s.profile_id
  and s.emp_id is not null;
