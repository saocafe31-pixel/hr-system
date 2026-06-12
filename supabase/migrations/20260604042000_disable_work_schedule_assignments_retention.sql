-- Stop deleting daily work schedule assignments automatically.
--
-- Historical work_schedule_assignments are used to calculate late attendance
-- accurately after the 30-day window, so the retention cron should remain off.

create extension if not exists pg_cron with schema extensions;

do $$
declare
  v_job_id bigint;
begin
  select jobid
  into v_job_id
  from cron.job
  where jobname = 'daily_prune_work_schedule_assignments_30d'
  limit 1;

  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;
end;
$$;

create or replace function public.prune_work_schedule_assignments_retention_30d()
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Retention is disabled. Keep the function as a no-op for compatibility with
  -- any existing references, but do not delete historical schedule rows.
  return 0;
end;
$$;

comment on function public.prune_work_schedule_assignments_retention_30d() is
  'Disabled: historical work_schedule_assignments are retained for attendance/late calculations.';

revoke all on function public.prune_work_schedule_assignments_retention_30d() from public;
grant execute on function public.prune_work_schedule_assignments_retention_30d() to service_role;
