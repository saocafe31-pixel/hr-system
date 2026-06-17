-- Configure after-work OT prompt timing through app_settings.
-- Default: ask 15 minutes after shift end, auto checkout 30 minutes after shift end.

insert into public.app_settings (key, value)
values (
  'attendance_overtime_prompt_settings',
  '{"prompt_after_minutes": 15, "auto_checkout_after_minutes": 30}'::jsonb
)
on conflict (key) do nothing;

create or replace function public.process_attendance_overtime()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  today_bkk date := (now() at time zone 'Asia/Bangkok')::date;
  affected integer := 0;
  prompt_after_minutes integer := 15;
  auto_checkout_after_minutes integer := 30;
begin
  begin
    select
      greatest(1, least(240, coalesce((value->>'prompt_after_minutes')::int, 15))),
      greatest(
        greatest(1, least(240, coalesce((value->>'prompt_after_minutes')::int, 15))),
        least(240, coalesce((value->>'auto_checkout_after_minutes')::int, 30))
      )
    into prompt_after_minutes, auto_checkout_after_minutes
    from public.app_settings
    where key = 'attendance_overtime_prompt_settings'
    limit 1;
  exception
    when others then
      prompt_after_minutes := 15;
      auto_checkout_after_minutes := 30;
  end;

  with plans as (
    select distinct on (x.user_id)
      x.user_id,
      x.source,
      x.plan_title,
      x.plan_start_at,
      x.plan_end_at
    from (
      select
        wsa.user_id,
        'shift'::text as source,
        ws.name as plan_title,
        ((wsa.work_date::text || ' ' || ws.start_time::text || '+07')::timestamptz) as plan_start_at,
        case
          when ws.end_time > ws.start_time
            then ((wsa.work_date::text || ' ' || ws.end_time::text || '+07')::timestamptz)
          else ((wsa.work_date::text || ' ' || ws.end_time::text || '+07')::timestamptz + interval '1 day')
        end as plan_end_at
      from public.work_schedule_assignments wsa
      join public.work_shifts ws on ws.id = wsa.shift_id
      where wsa.work_date = today_bkk

      union all

      select
        w.user_id,
        'legacy'::text as source,
        coalesce(w.title, 'กะงาน') as plan_title,
        w.start_at as plan_start_at,
        w.end_at as plan_end_at
      from public.work_schedules w
      where w.start_at <= ((today_bkk::text || ' 23:59:59+07')::timestamptz)
        and w.end_at >= ((today_bkk::text || ' 00:00:00+07')::timestamptz)
    ) x
    order by x.user_id, case when x.source = 'shift' then 0 else 1 end, x.plan_start_at
  ),
  open_workers as (
    select p.*
    from plans p
    where exists (
      select 1
      from public.attendance_logs l
      where l.user_id = p.user_id
        and (l.created_at at time zone 'Asia/Bangkok')::date = today_bkk
        and l.kind = 'check_in'
    )
    and not exists (
      select 1
      from public.attendance_logs l
      where l.user_id = p.user_id
        and (l.created_at at time zone 'Asia/Bangkok')::date = today_bkk
        and l.kind = 'check_out'
    )
  ),
  due_prompts as (
    select
      o.user_id,
      o.source,
      o.plan_title,
      o.plan_start_at,
      o.plan_end_at,
      (o.plan_end_at + make_interval(mins => prompt_after_minutes)) as prompt_at,
      (o.plan_end_at + make_interval(mins => auto_checkout_after_minutes)) as response_deadline_at
    from open_workers o
    where now() >= o.plan_end_at + make_interval(mins => prompt_after_minutes)
  ),
  inserted as (
    insert into public.attendance_overtime_requests (
      user_id,
      work_date,
      source,
      overtime_kind,
      plan_title,
      plan_start_at,
      plan_end_at,
      prompt_at,
      response_deadline_at,
      status
    )
    select
      d.user_id,
      today_bkk,
      d.source,
      'after_work',
      d.plan_title,
      d.plan_start_at,
      d.plan_end_at,
      d.prompt_at,
      d.response_deadline_at,
      'pending'
    from due_prompts d
    on conflict (user_id, work_date, overtime_kind) do nothing
    returning user_id
  )
  insert into public.attendance_chat_messages (user_id, body)
  select
    i.user_id,
    format(
      'ถึงเวลาออกงานแล้ว ระบบถาม OT อัตโนมัติหลังเลิกงาน %s นาที — หากไม่ตอบรับภายใน %s นาทีหลังเวลาเลิกงาน ระบบจะออกงานให้อัตโนมัติ',
      prompt_after_minutes,
      auto_checkout_after_minutes
    )
  from inserted i;

  with auto_due as (
    select r.*
    from public.attendance_overtime_requests r
    where r.status = 'pending'
      and r.overtime_kind = 'after_work'
      and r.response_deadline_at <= now()
  ),
  insert_logs as (
    insert into public.attendance_logs (user_id, branch_id, kind, within_branch, note)
    select
      d.user_id,
      null,
      'check_out',
      false,
      format(
        'ระบบออกงานอัตโนมัติ: ไม่ตอบรับคำขอ OT ภายใน %s นาทีหลังเวลาเลิกงาน',
        auto_checkout_after_minutes
      )
    from auto_due d
    where not exists (
      select 1
      from public.attendance_logs l
      where l.user_id = d.user_id
        and (l.created_at at time zone 'Asia/Bangkok')::date = d.work_date
        and l.kind = 'check_out'
    )
    returning user_id
  ),
  updated as (
    update public.attendance_overtime_requests r
    set
      status = 'auto_checked_out',
      responded_at = now(),
      auto_checked_out_at = now()
    where r.id in (select id from auto_due)
    returning r.user_id
  )
  insert into public.attendance_chat_messages (user_id, body)
  select
    u.user_id,
    format(
      'ระบบบันทึกออกงานอัตโนมัติ: ไม่ตอบรับคำขอ OT ภายใน %s นาทีหลังเวลาเลิกงาน',
      auto_checkout_after_minutes
    )
  from updated u;

  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.process_attendance_overtime() from public;
grant execute on function public.process_attendance_overtime() to service_role;

update public.attendance_overtime_requests
set
  prompt_at = plan_end_at + interval '15 minute',
  response_deadline_at = plan_end_at + interval '30 minute',
  updated_at = now()
where status = 'pending'
  and overtime_kind = 'after_work'
  and plan_end_at is not null
  and (
    prompt_at is distinct from plan_end_at + interval '15 minute'
    or response_deadline_at is distinct from plan_end_at + interval '30 minute'
  );
