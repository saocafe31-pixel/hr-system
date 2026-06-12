-- Keep admin leave adjustment RPC in sync with the unpaid leave type added for payroll.

create or replace function public.admin_update_leave_request(
  p_request_id uuid,
  p_leave_type text,
  p_starts_on date,
  p_ends_on date,
  p_reason text default null,
  p_status text default null
)
returns public.leave_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_row public.leave_requests%rowtype;
begin
  if v_actor is null or not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_leave_type not in ('sick', 'personal', 'vacation', 'unpaid') then
    raise exception 'invalid_leave_type' using errcode = '22023';
  end if;

  if p_status is not null and p_status not in ('pending', 'approved', 'rejected') then
    raise exception 'invalid_leave_status' using errcode = '22023';
  end if;

  if p_starts_on > p_ends_on then
    raise exception 'invalid_leave_date_range' using errcode = '22023';
  end if;

  update public.leave_requests
  set
    leave_type = p_leave_type,
    starts_on = p_starts_on,
    ends_on = p_ends_on,
    reason = nullif(trim(coalesce(p_reason, '')), ''),
    status = coalesce(p_status, status),
    admin_adjusted_by = v_actor,
    admin_adjusted_at = now()
  where id = p_request_id
  returning * into v_row;

  if not found then
    raise exception 'leave_request_not_found' using errcode = 'P0002';
  end if;

  return v_row;
end;
$$;

revoke all on function public.admin_update_leave_request(uuid, text, date, date, text, text) from public;
grant execute on function public.admin_update_leave_request(uuid, text, date, date, text, text) to authenticated;
