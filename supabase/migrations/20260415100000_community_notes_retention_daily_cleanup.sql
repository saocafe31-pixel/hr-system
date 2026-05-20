create extension if not exists pg_cron with schema extensions;

create index if not exists community_notes_updated_at_idx
  on public.community_notes (updated_at asc);

create or replace function public.cleanup_expired_community_notes()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer := 0;
begin
  /*
    ลบโน้ตที่เกิน 24 ชั่วโมงจาก updated_at
    replies จะถูกลบตาม on delete cascade
  */
  delete from public.community_notes n
  where n.updated_at < now() - interval '1 day';

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.cleanup_expired_community_notes() from public;
grant execute on function public.cleanup_expired_community_notes() to service_role;

do $$
declare
  v_job_id bigint;
begin
  select jobid
  into v_job_id
  from cron.job
  where jobname = 'daily_cleanup_community_notes'
  limit 1;

  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;

  /*
    pg_cron บน Supabase ใช้เวลา UTC
    17:10 UTC = 00:10 เวลาไทย (UTC+7)
  */
  perform cron.schedule(
    'daily_cleanup_community_notes',
    '10 17 * * *',
    $cron$select public.cleanup_expired_community_notes();$cron$
  );
end;
$$;
