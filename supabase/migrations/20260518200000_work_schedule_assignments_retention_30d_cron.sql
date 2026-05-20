-- ลบมอบหมายกะรายวัน (work_schedule_assignments) ที่ work_date เก่ากว่า 30 วัน
-- ตามปฏิทิน Asia/Bangkok — รันอัตโนมัติทุกวันผ่าน pg_cron
create extension if not exists pg_cron with schema extensions;

create or replace function public.prune_work_schedule_assignments_retention_30d()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer := 0;
  cutoff date;
begin
  cutoff := (timezone('Asia/Bangkok', now()))::date - interval '30 days';

  delete from public.work_schedule_assignments w
  where w.work_date < cutoff;

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

comment on function public.prune_work_schedule_assignments_retention_30d() is
  'ลบแถว work_schedule_assignments ที่ work_date น้อยกว่า (วันนี้เขต Asia/Bangkok - 30 วัน); ใช้กับ pg_cron';

revoke all on function public.prune_work_schedule_assignments_retention_30d() from public;
grant execute on function public.prune_work_schedule_assignments_retention_30d() to service_role;

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

  /*
    pg_cron บน Supabase ใช้เวลา UTC
    17:20 UTC = 00:20 เวลาไทย (UTC+7) — คนละนาทีกับ community_notes cleanup
  */
  perform cron.schedule(
    'daily_prune_work_schedule_assignments_30d',
    '20 17 * * *',
    $cron$select public.prune_work_schedule_assignments_retention_30d();$cron$
  );
end;
$$;
