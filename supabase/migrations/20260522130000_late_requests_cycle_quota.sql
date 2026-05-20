-- Enforce late request quota by payroll-style cycle:
-- 26 previous/current month through 25 next/current month, max 2 requests or 30 minutes total.

create index if not exists late_requests_user_work_date_idx
  on public.late_requests (user_id, work_date);

create or replace function public.enforce_late_requests_cycle_quota()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_cycle_start date;
  v_cycle_end date;
  v_existing_count integer := 0;
  v_existing_minutes integer := 0;
begin
  if extract(day from new.work_date)::integer >= 26 then
    v_cycle_start := date_trunc('month', new.work_date)::date + 25;
    v_cycle_end :=
      (date_trunc('month', new.work_date)::date + interval '1 month' + interval '24 days')::date;
  else
    v_cycle_start :=
      (date_trunc('month', new.work_date)::date - interval '1 month' + interval '25 days')::date;
    v_cycle_end := (date_trunc('month', new.work_date)::date + interval '24 days')::date;
  end if;

  perform pg_advisory_xact_lock(hashtext(new.user_id::text), hashtext(v_cycle_start::text));

  select count(*), coalesce(sum(minutes_late), 0)
    into v_existing_count, v_existing_minutes
  from public.late_requests
  where user_id = new.user_id
    and work_date between v_cycle_start and v_cycle_end
    and (tg_op = 'INSERT' or id <> new.id);

  if v_existing_count >= 2 then
    raise exception 'ใช้สิทธิขอเข้าสายครบ 2 ครั้งในรอบ 26–25 แล้ว'
      using errcode = '23514';
  end if;

  if v_existing_minutes + new.minutes_late > 30 then
    raise exception 'ใช้สิทธิขอเข้าสายเกิน 30 นาทีในรอบ 26–25 แล้ว'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_late_requests_cycle_quota on public.late_requests;
create trigger enforce_late_requests_cycle_quota
  before insert or update of user_id, work_date, minutes_late on public.late_requests
  for each row
  execute function public.enforce_late_requests_cycle_quota();
