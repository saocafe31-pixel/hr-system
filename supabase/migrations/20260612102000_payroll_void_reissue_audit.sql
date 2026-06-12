-- Add safe void/reissue workflow for confirmed or paid payroll slips.

alter table public.payroll_slips
  add column if not exists voided_by uuid references public.profiles(id) on delete set null,
  add column if not exists voided_at timestamptz,
  add column if not exists void_reason text,
  add column if not exists reissued_from_slip_id uuid references public.payroll_slips(id) on delete set null;

alter table public.payroll_slips
  drop constraint if exists payroll_slips_status_check;

alter table public.payroll_slips
  add constraint payroll_slips_status_check
  check (status in ('draft', 'confirmed', 'paid', 'voided'));

alter table public.payroll_slips
  drop constraint if exists payroll_slips_user_id_cycle_key_key;

create unique index if not exists payroll_slips_active_user_cycle_uidx
  on public.payroll_slips (user_id, cycle_key)
  where status <> 'voided';

create index if not exists payroll_slips_reissued_from_idx
  on public.payroll_slips (reissued_from_slip_id)
  where reissued_from_slip_id is not null;

create table if not exists public.payroll_slip_events (
  id uuid primary key default gen_random_uuid(),
  slip_id uuid not null references public.payroll_slips(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  event_type text not null check (event_type in ('generated', 'confirmed', 'paid', 'voided', 'reissued')),
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists payroll_slip_events_slip_idx
  on public.payroll_slip_events (slip_id, created_at desc);

alter table public.payroll_slip_events enable row level security;

drop policy if exists "payroll_slip_events_admin_all" on public.payroll_slip_events;
create policy "payroll_slip_events_admin_all" on public.payroll_slip_events
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "payroll_slips_select_visible" on public.payroll_slips;
create policy "payroll_slips_select_visible" on public.payroll_slips
  for select to authenticated
  using (
    public.is_admin()
    or (
      status in ('confirmed', 'paid')
      and (
        user_id = auth.uid()
        or exists (
          select 1
          from public.profiles p
          where p.id = auth.uid()
            and p.employee_id is not null
            and p.employee_id = payroll_slips.employee_id
        )
      )
    )
  );

drop policy if exists "payroll_items_select_visible" on public.payroll_items;
create policy "payroll_items_select_visible" on public.payroll_items
  for select to authenticated
  using (
    exists (
      select 1
      from public.payroll_slips s
      where s.id = payroll_items.slip_id
        and (
          public.is_admin()
          or (
            s.status in ('confirmed', 'paid')
            and (
              s.user_id = auth.uid()
              or exists (
                select 1
                from public.profiles p
                where p.id = auth.uid()
                  and p.employee_id is not null
                  and p.employee_id = s.employee_id
              )
            )
          )
        )
    )
  );

create or replace function public.admin_void_and_reissue_payroll_slip(
  p_slip_id uuid,
  p_reason text
)
returns table (
  voided_slip_id uuid,
  new_slip_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_old public.payroll_slips%rowtype;
  v_new_id uuid;
begin
  if v_actor is null then
    raise exception 'unauthorized';
  end if;

  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  if v_reason is null then
    raise exception 'void_reason_required';
  end if;

  select *
  into v_old
  from public.payroll_slips
  where id = p_slip_id
  for update;

  if v_old.id is null then
    raise exception 'slip_not_found';
  end if;

  if v_old.status not in ('confirmed', 'paid') then
    raise exception 'only_confirmed_or_paid_can_be_voided';
  end if;

  update public.payroll_slips
  set
    status = 'voided',
    voided_by = v_actor,
    voided_at = now(),
    void_reason = v_reason
  where id = v_old.id;

  insert into public.payroll_slip_events (slip_id, actor_id, event_type, reason, metadata)
  values (
    v_old.id,
    v_actor,
    'voided',
    v_reason,
    jsonb_build_object('previous_status', v_old.status, 'cycle_key', v_old.cycle_key)
  );

  insert into public.payroll_slips (
    user_id,
    employee_id,
    cycle_key,
    period_start,
    period_end,
    status,
    taxable_income,
    reimbursement_total,
    income_total,
    deduction_total,
    net_pay,
    generated_by,
    generated_at,
    confirmed_by,
    confirmed_at,
    paid_by,
    paid_at,
    notes,
    reissued_from_slip_id
  )
  values (
    v_old.user_id,
    v_old.employee_id,
    v_old.cycle_key,
    v_old.period_start,
    v_old.period_end,
    'draft',
    v_old.taxable_income,
    v_old.reimbursement_total,
    v_old.income_total,
    v_old.deduction_total,
    v_old.net_pay,
    v_actor,
    now(),
    null,
    null,
    null,
    null,
    v_old.notes,
    v_old.id
  )
  returning id into v_new_id;

  insert into public.payroll_items (
    slip_id,
    item_kind,
    item_code,
    label,
    amount,
    taxable,
    source_table,
    source_id,
    sort_order
  )
  select
    v_new_id,
    item_kind,
    item_code,
    label,
    amount,
    taxable,
    source_table,
    source_id,
    sort_order
  from public.payroll_items
  where slip_id = v_old.id
  order by sort_order asc, created_at asc;

  insert into public.payroll_slip_events (slip_id, actor_id, event_type, reason, metadata)
  values (
    v_new_id,
    v_actor,
    'reissued',
    v_reason,
    jsonb_build_object('reissued_from_slip_id', v_old.id, 'cycle_key', v_old.cycle_key)
  );

  return query select v_old.id, v_new_id;
end;
$$;

revoke all on function public.admin_void_and_reissue_payroll_slip(uuid, text) from public;
grant execute on function public.admin_void_and_reissue_payroll_slip(uuid, text) to authenticated;
