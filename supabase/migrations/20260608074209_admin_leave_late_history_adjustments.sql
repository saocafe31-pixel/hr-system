-- Admin-only adjustment RPCs for leave / late-request history.
-- These functions intentionally hard-delete rows when removing history so existing
-- quota calculations immediately return the entitlement without additional filters.

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

  if p_leave_type not in ('sick', 'personal', 'vacation') then
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

create or replace function public.admin_delete_leave_request(p_request_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null or not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  delete from public.leave_requests
  where id = p_request_id;

  if not found then
    raise exception 'leave_request_not_found' using errcode = 'P0002';
  end if;

  return true;
end;
$$;

create or replace function public.admin_update_late_request(
  p_request_id uuid,
  p_work_date date,
  p_minutes_late integer,
  p_note text default null
)
returns public.late_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_row public.late_requests%rowtype;
begin
  if v_actor is null or not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_minutes_late < 1 or p_minutes_late > 30 then
    raise exception 'invalid_late_minutes' using errcode = '22023';
  end if;

  update public.late_requests
  set
    work_date = p_work_date,
    minutes_late = p_minutes_late,
    note = nullif(trim(coalesce(p_note, '')), '')
  where id = p_request_id
  returning * into v_row;

  if not found then
    raise exception 'late_request_not_found' using errcode = 'P0002';
  end if;

  return v_row;
end;
$$;

create or replace function public.admin_delete_late_request(p_request_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null or not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  delete from public.late_requests
  where id = p_request_id;

  if not found then
    raise exception 'late_request_not_found' using errcode = 'P0002';
  end if;

  return true;
end;
$$;

revoke all on function public.admin_update_leave_request(uuid, text, date, date, text, text) from public;
revoke all on function public.admin_delete_leave_request(uuid) from public;
revoke all on function public.admin_update_late_request(uuid, date, integer, text) from public;
revoke all on function public.admin_delete_late_request(uuid) from public;

grant execute on function public.admin_update_leave_request(uuid, text, date, date, text, text) to authenticated;
grant execute on function public.admin_delete_leave_request(uuid) to authenticated;
grant execute on function public.admin_update_late_request(uuid, date, integer, text) to authenticated;
grant execute on function public.admin_delete_late_request(uuid) to authenticated;
