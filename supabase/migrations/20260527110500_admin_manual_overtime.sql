-- Allow admins/HR to record approved manual overtime for an employee.

alter table public.attendance_overtime_requests
  add column if not exists manual_minutes integer,
  add column if not exists manual_created_by uuid references public.profiles(id) on delete set null;

alter table public.attendance_overtime_requests
  drop constraint if exists attendance_overtime_requests_source_check;

alter table public.attendance_overtime_requests
  add constraint attendance_overtime_requests_source_check
  check (source in ('shift', 'legacy', 'manual'));

alter table public.attendance_overtime_requests
  drop constraint if exists attendance_overtime_requests_kind_check;

alter table public.attendance_overtime_requests
  add constraint attendance_overtime_requests_kind_check
  check (overtime_kind in ('after_work', 'before_work', 'manual'));

alter table public.attendance_overtime_requests
  drop constraint if exists attendance_overtime_requests_manual_minutes_check;

alter table public.attendance_overtime_requests
  add constraint attendance_overtime_requests_manual_minutes_check
  check (
    overtime_kind <> 'manual'
    or manual_minutes is null
    or manual_minutes > 0
  );

create or replace function public.admin_set_manual_overtime(
  p_user_id uuid,
  p_work_date date,
  p_minutes integer,
  p_reason text default null
)
returns public.attendance_overtime_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_start timestamptz;
  req public.attendance_overtime_requests%rowtype;
begin
  if v_actor is null then
    raise exception 'unauthorized';
  end if;

  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  if p_user_id is null or p_work_date is null then
    raise exception 'invalid_manual_overtime_target';
  end if;

  if coalesce(p_minutes, 0) <= 0 then
    delete from public.attendance_overtime_requests r
    where r.user_id = p_user_id
      and r.work_date = p_work_date
      and r.overtime_kind = 'manual'
    returning * into req;

    return req;
  end if;

  if v_reason is null then
    raise exception 'overtime_reason_required';
  end if;

  v_start := ((p_work_date::text || ' 00:00:00+07')::timestamptz);

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
    approval_status,
    approved_by,
    approved_at,
    reason,
    manual_minutes,
    manual_created_by
  )
  values (
    p_user_id,
    p_work_date,
    'manual',
    'manual',
    'OT แมนนวลโดยแอดมิน/HR',
    v_start,
    v_start + make_interval(mins => p_minutes),
    now(),
    now(),
    'accepted',
    now(),
    'approved',
    v_actor,
    now(),
    v_reason,
    p_minutes,
    v_actor
  )
  on conflict (user_id, work_date, overtime_kind)
  do update set
    source = 'manual',
    plan_title = excluded.plan_title,
    plan_start_at = excluded.plan_start_at,
    plan_end_at = excluded.plan_end_at,
    prompt_at = excluded.prompt_at,
    response_deadline_at = excluded.response_deadline_at,
    status = 'accepted',
    responded_at = now(),
    approval_status = 'approved',
    approved_by = v_actor,
    approved_at = now(),
    approval_note = null,
    reason = excluded.reason,
    manual_minutes = excluded.manual_minutes,
    manual_created_by = v_actor
  returning * into req;

  perform public.notify_status_update(
    req.user_id,
    v_actor,
    'overtime_status',
    'overtime',
    req.id,
    'approved',
    'บันทึก OT แมนนวลวันที่ ' || req.work_date::text || ' จำนวน ' || req.manual_minutes::text || ' นาทีแล้ว'
  );

  return req;
end;
$$;

revoke all on function public.admin_set_manual_overtime(uuid, date, integer, text) from public;
grant execute on function public.admin_set_manual_overtime(uuid, date, integer, text) to authenticated;
