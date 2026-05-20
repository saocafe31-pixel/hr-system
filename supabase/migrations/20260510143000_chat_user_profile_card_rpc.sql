-- โปรไฟล์ผู้ใช้สำหรับหน้าแชทเข้า-ออก (ทุก role ใช้ดูได้)
-- แสดงข้อมูลหลัก + งานที่กำลังทำ (pending / in_progress)

create or replace function public.chat_user_profile_card(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile record;
  v_emp record;
  v_real_name text;
  v_app_name text;
  v_tasks jsonb;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;

  select
    p.id,
    p.full_name,
    p.email,
    p.phone,
    p.avatar_url,
    p.employee_id
  into v_profile
  from public.profiles p
  where p.id = p_user_id;

  if v_profile.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_profile.employee_id is not null then
    select
      e.id,
      e.name,
      e.surname,
      e.nickname,
      e.phone
    into v_emp
    from public.employee_directory e
    where e.id = v_profile.employee_id;
  end if;

  v_real_name := trim(
    concat(
      coalesce(v_emp.name, ''),
      case when v_emp.name is not null and v_emp.surname is not null then ' ' else '' end,
      coalesce(v_emp.surname, '')
    )
  );

  v_app_name := coalesce(
    nullif(trim(v_profile.full_name), ''),
    nullif(trim(v_emp.nickname), ''),
    nullif(trim(v_profile.email), ''),
    left(v_profile.id::text, 8)
  );

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', t.id,
        'title', t.title,
        'status', t.status,
        'priority', t.priority,
        'due_at', t.due_at
      )
      order by
        case when t.status = 'in_progress' then 0 else 1 end,
        t.created_at desc
    ),
    '[]'::jsonb
  )
  into v_tasks
  from (
    select
      id, title, status, priority, due_at, created_at
    from public.tasks
    where assigned_to = p_user_id
      and status in ('pending', 'in_progress')
    order by
      case when status = 'in_progress' then 0 else 1 end,
      created_at desc
    limit 8
  ) t;

  return jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'user_id', v_profile.id,
      'app_name', v_app_name,
      'phone', coalesce(nullif(trim(v_profile.phone), ''), nullif(trim(v_emp.phone), '')),
      'avatar_url', v_profile.avatar_url,
      'real_name', case when v_real_name = '' then null else v_real_name end,
      'nickname', nullif(trim(v_emp.nickname), ''),
      'active_tasks', v_tasks
    )
  );
end;
$$;

revoke all on function public.chat_user_profile_card(uuid) from public;
grant execute on function public.chat_user_profile_card(uuid) to authenticated;
