-- Allow admins to add Admin/HR accounts to a manager team so managers can assign work to them.
-- Approval/schedule mutation rules still use existing manager scope checks.

create or replace function public.admin_set_manager_direct_reports(
  p_manager_id uuid,
  p_subordinate_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  sid uuid;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if not exists (
    select 1 from public.profiles p where p.id = p_manager_id and p.role = 'manager'
  ) then
    return jsonb_build_object('ok', false, 'error', 'not_manager');
  end if;

  delete from public.manager_direct_reports where manager_id = p_manager_id;

  foreach sid in array coalesce(p_subordinate_ids, array[]::uuid[]) loop
    continue when sid is null or sid = p_manager_id;
    if not exists (select 1 from public.profiles p where p.id = sid) then
      continue;
    end if;

    insert into public.manager_direct_reports (manager_id, subordinate_id)
    values (p_manager_id, sid)
    on conflict (manager_id, subordinate_id) do nothing;
  end loop;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.admin_set_manager_direct_reports(uuid, uuid[]) from public;
grant execute on function public.admin_set_manager_direct_reports(uuid, uuid[]) to authenticated;

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
as $$
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
    (
      public.is_admin()
      and (
        p.employee_id is not null
        or p.role in ('employee'::public.user_role, 'admin'::public.user_role)
      )
    )
    or (
      public.is_manager()
      and (
        p.id = auth.uid()
        or exists (
          select 1
          from public.manager_direct_reports r
          where r.manager_id = auth.uid()
            and r.subordinate_id = p.id
        )
      )
    )
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
$$;

revoke all on function public.task_assign_picklist() from public;
grant execute on function public.task_assign_picklist() to authenticated;
