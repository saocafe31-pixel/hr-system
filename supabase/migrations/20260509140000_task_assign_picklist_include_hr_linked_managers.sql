-- task_assign_picklist: เดิมกรองเฉพาะ role = employee ทำให้ลูกทีมที่เป็น manager ไม่ขึ้นในโมดัลมอบหมาย
-- (หน้าทีมแสดงจาก employee + direct reports ได้ครบ) — ขยายให้รวมโปรไฟล์ที่เชื่อม employee แล้วทุกบทบาท

do $$
begin
  if not exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'employee'
  ) then
    return;
  end if;

  execute $fn$
  create or replace function public.task_assign_picklist()
  returns table (
    profile_id uuid,
    account_email text,
    hr_user_id text,
    full_name text,
    employee_id uuid,
    hr_name text,
    hr_surname text,
    hr_nickname text
  )
  language plpgsql
  stable
  security definer
  set search_path = public
  as $body$
  begin
    if not (public.is_admin() or public.is_manager()) then
      raise exception 'not allowed' using errcode = '42501';
    end if;

    return query
    select
      p.id,
      p.email::text,
      case
        when e."UserID" is not null and btrim(e."UserID"::text) <> ''
        then btrim(e."UserID"::text)
      end::text,
      p.full_name::text,
      p.employee_id,
      case
        when e."Name" is not null and btrim(e."Name"::text) <> ''
        then btrim(e."Name"::text)
      end::text,
      case
        when e."Surname" is not null and btrim(e."Surname"::text) <> ''
        then btrim(e."Surname"::text)
      end::text,
      case
        when e.nickname is not null and btrim(e.nickname::text) <> ''
        then btrim(e.nickname::text)
      end::text
    from public.profiles p
    left join public.employee e on e.id = p.employee_id
    where (
      p.employee_id is not null
      or p.role = 'employee'::public.user_role
    )
    order by
      lower(
        coalesce(
          nullif(btrim(e."Name"::text), ''),
          p.full_name,
          p.email,
          ''
        )
      ),
      lower(coalesce(p.email, ''));
  end;
  $body$;
  $fn$;

  revoke all on function public.task_assign_picklist() from public;
  grant execute on function public.task_assign_picklist() to authenticated;
end $$;
