create extension if not exists pg_cron with schema extensions;

create table if not exists public.attendance_overtime_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  work_date date not null,
  source text not null check (source in ('shift', 'legacy')),
  plan_title text,
  plan_start_at timestamptz not null,
  plan_end_at timestamptz not null,
  prompt_at timestamptz not null,
  response_deadline_at timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'auto_checked_out')),
  responded_at timestamptz,
  auto_checked_out_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, work_date)
);

create index if not exists attendance_overtime_requests_status_deadline_idx
  on public.attendance_overtime_requests (status, response_deadline_at);

alter table public.attendance_overtime_requests enable row level security;

drop policy if exists "attendance_overtime_select" on public.attendance_overtime_requests;
create policy "attendance_overtime_select" on public.attendance_overtime_requests
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_admin()
    or (
      public.is_manager()
      and public.same_branch_as(user_id)
    )
  );

create or replace function public.attendance_overtime_requests_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists attendance_overtime_requests_updated_at on public.attendance_overtime_requests;
create trigger attendance_overtime_requests_updated_at
  before update on public.attendance_overtime_requests
  for each row execute function public.attendance_overtime_requests_set_updated_at();

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
      (o.plan_end_at + interval '30 minute') as prompt_at,
      (o.plan_end_at + interval '30 minute' + make_interval(mins => timeout_minutes)) as response_deadline_at
    from open_workers o
    where now() >= o.plan_end_at + interval '30 minute'
  ),
  inserted as (
    insert into public.attendance_overtime_requests (
      user_id, work_date, source, plan_title, plan_start_at, plan_end_at, prompt_at, response_deadline_at, status
    )
    select
      d.user_id,
      today_bkk,
      d.source,
      d.plan_title,
      d.plan_start_at,
      d.plan_end_at,
      d.prompt_at,
      d.response_deadline_at,
      'pending'
    from due_prompts d
    on conflict (user_id, work_date) do nothing
    returning user_id
  )
  insert into public.attendance_chat_messages (user_id, body)
  select
    i.user_id,
    'เลยเวลาออกงาน 30 นาทีแล้ว ระบบถาม OT อัตโนมัติ — หากไม่ตอบรับจะถูกออกงานอัตโนมัติ'
  from inserted i;

  with auto_due as (
    select r.*
    from public.attendance_overtime_requests r
    where r.status = 'pending'
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

revoke all on function public.process_attendance_overtime() from public;
grant execute on function public.process_attendance_overtime() to service_role;

create or replace function public.respond_overtime_request(p_request_id uuid, p_accept boolean)
returns public.attendance_overtime_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  req public.attendance_overtime_requests%rowtype;
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
    update public.attendance_overtime_requests
    set status = 'accepted', responded_at = now()
    where id = req.id
    returning * into req;
    return req;
  end if;

  if not exists (
    select 1
    from public.attendance_logs l
    where l.user_id = req.user_id
      and (l.created_at at time zone 'Asia/Bangkok')::date = req.work_date
      and l.kind = 'check_out'
  ) then
    insert into public.attendance_logs (user_id, branch_id, kind, within_branch, note)
    values (
      req.user_id,
      null,
      'check_out',
      false,
      'ออกงานตามการปฏิเสธ OT'
    );
  end if;

  insert into public.attendance_chat_messages (user_id, body)
  values (req.user_id, 'พนักงานเลือกไม่ทำ OT — ระบบบันทึกออกงานให้แล้ว');

  update public.attendance_overtime_requests
  set status = 'declined', responded_at = now()
  where id = req.id
  returning * into req;

  return req;
end;
$$;

revoke all on function public.respond_overtime_request(uuid, boolean) from public;
grant execute on function public.respond_overtime_request(uuid, boolean) to authenticated;
grant execute on function public.respond_overtime_request(uuid, boolean) to service_role;

do $$
declare
  v_job_id bigint;
begin
  select jobid
  into v_job_id
  from cron.job
  where jobname = 'attendance_overtime_every_minute'
  limit 1;

  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;

  perform cron.schedule(
    'attendance_overtime_every_minute',
    '* * * * *',
    $cron$select public.process_attendance_overtime();$cron$
  );
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'attendance_overtime_requests'
  ) then
    alter publication supabase_realtime add table public.attendance_overtime_requests;
  end if;
end;
$$;
