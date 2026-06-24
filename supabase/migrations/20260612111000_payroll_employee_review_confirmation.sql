-- Let employees confirm they have reviewed each confirmed/paid payslip.

alter table public.payroll_slips
  add column if not exists employee_confirmed_by uuid references public.profiles(id) on delete set null,
  add column if not exists employee_confirmed_at timestamptz;

alter table public.payroll_slip_events
  drop constraint if exists payroll_slip_events_event_type_check;

alter table public.payroll_slip_events
  add constraint payroll_slip_events_event_type_check
  check (event_type in (
    'generated',
    'confirmed',
    'paid',
    'voided',
    'reissued',
    'employee_confirmed',
    'correction_requested',
    'correction_acknowledged'
  ));

create index if not exists payroll_slips_employee_confirmed_idx
  on public.payroll_slips (employee_confirmed_at desc)
  where employee_confirmed_at is not null;

create or replace function public.confirm_payroll_slip_review(p_slip_id uuid)
returns public.payroll_slips
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_slip public.payroll_slips%rowtype;
begin
  if v_actor is null then
    raise exception 'unauthorized';
  end if;

  select *
  into v_profile
  from public.profiles
  where id = v_actor
  limit 1;

  select *
  into v_slip
  from public.payroll_slips
  where id = p_slip_id
  for update;

  if v_slip.id is null then
    raise exception 'slip_not_found';
  end if;

  if v_slip.status not in ('confirmed', 'paid') then
    raise exception 'only_confirmed_or_paid_can_be_reviewed';
  end if;

  if not (
    v_slip.user_id = v_actor
    or (
      v_profile.employee_id is not null
      and v_profile.employee_id = v_slip.employee_id
    )
  ) then
    raise exception 'forbidden';
  end if;

  update public.payroll_slips
  set
    employee_confirmed_by = v_actor,
    employee_confirmed_at = coalesce(employee_confirmed_at, now())
  where id = v_slip.id
  returning * into v_slip;

  insert into public.payroll_slip_events (slip_id, actor_id, event_type, metadata)
  values (
    v_slip.id,
    v_actor,
    'employee_confirmed',
    jsonb_build_object('cycle_key', v_slip.cycle_key, 'status', v_slip.status)
  );

  return v_slip;
end;
$$;

revoke all on function public.confirm_payroll_slip_review(uuid) from public;
grant execute on function public.confirm_payroll_slip_review(uuid) to authenticated;
