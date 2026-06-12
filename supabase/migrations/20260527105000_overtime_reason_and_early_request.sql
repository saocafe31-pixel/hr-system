-- Require explicit OT reasons and support early check-in OT requests.

alter table public.attendance_overtime_requests
  add column if not exists overtime_kind text not null default 'after_work',
  add column if not exists reason text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'attendance_overtime_requests_kind_check'
      and conrelid = 'public.attendance_overtime_requests'::regclass
  ) then
    alter table public.attendance_overtime_requests
      add constraint attendance_overtime_requests_kind_check
      check (overtime_kind in ('after_work', 'before_work'));
  end if;
end $$;

alter table public.attendance_overtime_requests
  drop constraint if exists attendance_overtime_requests_user_id_work_date_key;

create unique index if not exists attendance_overtime_requests_user_date_kind_key
  on public.attendance_overtime_requests (user_id, work_date, overtime_kind);

create index if not exists attendance_overtime_requests_kind_approval_idx
  on public.attendance_overtime_requests (overtime_kind, status, approval_status, work_date desc);

create or replace function public.process_attendance_overtime()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  today_bkk date := (now() at time zone 'Asia/Bangkok')::date;
  timeout_minutes integer := 5;
  affected integer := 0;
begin
  begin
    select greatest(1, coalesce((value->>'minutes')::int, 5))
    into timeout_minutes
    from public.app_settings
    where key = 'attendance_overtime_response_timeout'
    limit 1;
  exception
    when others then
      timeout_minutes := 5;
  end;

  timeout_minutes := coalesce(timeout_minutes, 5);

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
      (o.plan_end_at + interval '60 minute') as prompt_at,
      (o.plan_end_at + interval '60 minute' + make_interval(mins => timeout_minutes)) as response_deadline_at
    from open_workers o
    where now() >= o.plan_end_at + interval '60 minute'
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
    'เลยเวลาออกงาน 1 ชั่วโมงแล้ว ระบบถาม OT อัตโนมัติ — หากไม่ตอบรับจะถูกออกงานอัตโนมัติ'
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
      'ระบบออกงานอัตโนมัติ: ไม่ตอบรับคำขอ OT ภายในเวลาที่กำหนด'
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
    'ระบบบันทึกออกงานอัตโนมัติ: ไม่ตอบรับคำขอ OT ภายในเวลาที่กำหนด'
  from updated u;

  get diagnostics affected = row_count;
  return affected;
end;
$$;

drop function if exists public.respond_overtime_request(uuid, boolean);

create or replace function public.respond_overtime_request(
  p_request_id uuid,
  p_accept boolean,
  p_reason text default null
)
returns public.attendance_overtime_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  req public.attendance_overtime_requests%rowtype;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  select *
  into req
  from public.attendance_overtime_requests
  where id = p_request_id
    and user_id = auth.uid()
  limit 1;

  if req.id is null then
    raise exception 'request_not_found';
  end if;

  if req.status <> 'pending' then
    return req;
  end if;

  if p_accept then
    if v_reason is null then
      raise exception 'overtime_reason_required';
    end if;

    update public.attendance_overtime_requests
    set status = 'accepted', responded_at = now(), reason = v_reason
    where id = req.id
    returning * into req;
    return req;
  end if;

  insert into public.attendance_logs (user_id, branch_id, kind, within_branch, note)
  select
    req.user_id,
    null,
    'check_out',
    false,
    'พนักงานเลือกไม่ทำ OT — ระบบบันทึกออกงานให้'
  where not exists (
    select 1
    from public.attendance_logs l
    where l.user_id = req.user_id
      and (l.created_at at time zone 'Asia/Bangkok')::date = req.work_date
      and l.kind = 'check_out'
  );

  insert into public.attendance_chat_messages (user_id, body)
  values (req.user_id, 'พนักงานเลือกไม่ทำ OT — ระบบบันทึกออกงานให้แล้ว');

  update public.attendance_overtime_requests
  set status = 'declined', responded_at = now()
  where id = req.id
  returning * into req;

  return req;
end;
$$;

revoke all on function public.respond_overtime_request(uuid, boolean, text) from public;
grant execute on function public.respond_overtime_request(uuid, boolean, text) to authenticated;
grant execute on function public.respond_overtime_request(uuid, boolean, text) to service_role;

create or replace function public.request_early_overtime(p_reason text)
returns public.attendance_overtime_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  today_bkk date := (now() at time zone 'Asia/Bangkok')::date;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_plan record;
  v_check_in timestamptz;
  req public.attendance_overtime_requests%rowtype;
begin
  if v_user is null then
    raise exception 'unauthorized';
  end if;

  if v_reason is null then
    raise exception 'overtime_reason_required';
  end if;

  select l.created_at
  into v_check_in
  from public.attendance_logs l
  where l.user_id = v_user
    and l.kind = 'check_in'
    and (l.created_at at time zone 'Asia/Bangkok')::date = today_bkk
  order by l.created_at asc
  limit 1;

  if v_check_in is null then
    raise exception 'check_in_not_found';
  end if;

  select *
  into v_plan
  from (
    select
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
    where wsa.user_id = v_user
      and wsa.work_date = today_bkk

    union all

    select
      'legacy'::text as source,
      coalesce(w.title, 'กะงาน') as plan_title,
      w.start_at as plan_start_at,
      w.end_at as plan_end_at
    from public.work_schedules w
    where w.user_id = v_user
      and w.start_at <= ((today_bkk::text || ' 23:59:59+07')::timestamptz)
      and w.end_at >= ((today_bkk::text || ' 00:00:00+07')::timestamptz)
  ) plans
  order by case when source = 'shift' then 0 else 1 end, plan_start_at
  limit 1;

  if not found then
    raise exception 'work_plan_not_found';
  end if;

  if v_plan.plan_start_at is null then
    raise exception 'work_plan_not_found';
  end if;

  if v_check_in > (v_plan.plan_start_at - interval '60 minute') then
    raise exception 'early_overtime_less_than_60_minutes';
  end if;

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
    status,
    responded_at,
    reason
  )
  values (
    v_user,
    today_bkk,
    v_plan.source,
    'before_work',
    v_plan.plan_title,
    v_plan.plan_start_at,
    v_plan.plan_end_at,
    now(),
    now(),
    'accepted',
    now(),
    v_reason
  )
  on conflict (user_id, work_date, overtime_kind)
  do update set
    status = 'accepted',
    approval_status = 'pending',
    approved_by = null,
    approved_at = null,
    approval_note = null,
    responded_at = now(),
    reason = excluded.reason,
    plan_title = excluded.plan_title,
    plan_start_at = excluded.plan_start_at,
    plan_end_at = excluded.plan_end_at,
    prompt_at = excluded.prompt_at,
    response_deadline_at = excluded.response_deadline_at
  returning * into req;

  return req;
end;
$$;

revoke all on function public.request_early_overtime(text) from public;
grant execute on function public.request_early_overtime(text) to authenticated;

create or replace function public.enqueue_push_on_overtime_prompt()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'pending' and new.overtime_kind = 'after_work' then
    perform public.enqueue_push_notification_job(
      new.user_id,
      'checkout_reminder',
      'แจ้งออกงาน',
      'เลยเวลาออกงาน 1 ชั่วโมงแล้ว กรุณายืนยันว่าจะทำ OT หรือออกงาน',
      jsonb_build_object('overtime_request_id', new.id, 'work_date', new.work_date),
      'attendance_overtime_requests',
      new.id
    );
  end if;
  return new;
end;
$$;

create or replace function public.enqueue_web_push_on_overtime_prompt()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'pending' and new.overtime_kind = 'after_work' then
    perform public.enqueue_web_push_notification_job(
      new.user_id,
      'checkout_reminder',
      'แจ้งออกงาน',
      'เลยเวลาออกงาน 1 ชั่วโมงแล้ว กรุณายืนยันว่าจะทำ OT หรือออกงาน',
      jsonb_build_object('overtime_request_id', new.id, 'work_date', new.work_date),
      'attendance_overtime_requests',
      new.id
    );
  end if;
  return new;
end;
$$;

create or replace function public.respond_overtime_approval(
  p_request_id uuid,
  p_approve boolean,
  p_note text default null
)
returns public.attendance_overtime_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  req public.attendance_overtime_requests%rowtype;
  v_actor uuid := auth.uid();
  v_status text := case when p_approve then 'approved' else 'rejected' end;
  v_body text;
begin
  if v_actor is null then
    raise exception 'unauthorized';
  end if;

  select *
  into req
  from public.attendance_overtime_requests
  where id = p_request_id
  limit 1;

  if req.id is null then
    raise exception 'request_not_found';
  end if;

  if not (
    public.is_admin()
    or (public.is_manager() and public.is_direct_report_of_me(req.user_id))
  ) then
    raise exception 'forbidden';
  end if;

  if req.status <> 'accepted' then
    raise exception 'overtime_not_accepted';
  end if;

  if nullif(trim(coalesce(req.reason, '')), '') is null then
    raise exception 'overtime_reason_required';
  end if;

  update public.attendance_overtime_requests
  set
    approval_status = v_status,
    approved_by = v_actor,
    approved_at = now(),
    approval_note = nullif(trim(coalesce(p_note, '')), '')
  where id = req.id
  returning * into req;

  v_body := 'คำขอ OT วันที่ ' || req.work_date::text || ' ถูก'
    || case when p_approve then 'อนุมัติแล้ว' else 'ปฏิเสธแล้ว' end;

  perform public.notify_status_update(
    req.user_id,
    v_actor,
    'overtime_status',
    'overtime',
    req.id,
    v_status,
    v_body
  );

  return req;
end;
$$;

revoke all on function public.respond_overtime_approval(uuid, boolean, text) from public;
grant execute on function public.respond_overtime_approval(uuid, boolean, text) to authenticated;
