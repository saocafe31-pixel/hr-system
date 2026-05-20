-- HR/ผู้จัดการ อนุมัติหรือปฏิเสธคำขอลา (จากแอปแชทเข้า-ออก)

create or replace function public.respond_leave_request(
  p_leave_id uuid,
  p_approve boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  if not (public.is_admin() or public.is_manager()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  update public.leave_requests
  set status = case when p_approve then 'approved'::text else 'rejected'::text end
  where id = p_leave_id
    and status = 'pending';

  get diagnostics n = row_count;
  if n < 1 then
    return jsonb_build_object('ok', false, 'error', 'not_pending_or_missing');
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.respond_leave_request(uuid, boolean) from public;
grant execute on function public.respond_leave_request(uuid, boolean) to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'leave_requests'
  ) then
    alter publication supabase_realtime add table public.leave_requests;
  end if;
end $$;
