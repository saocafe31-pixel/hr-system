-- Extend Payroll with OT settings, paid status, and employee visibility for paid slips.

alter table public.payroll_employee_compensation
  add column if not exists overtime_hourly_rate_mode text not null default 'auto',
  add column if not exists overtime_manual_hourly_rate numeric(12,2),
  add column if not exists overtime_multiplier numeric(6,2) not null default 1.50;

alter table public.payroll_employee_compensation
  drop constraint if exists payroll_employee_compensation_overtime_hourly_rate_mode_check;

alter table public.payroll_employee_compensation
  add constraint payroll_employee_compensation_overtime_hourly_rate_mode_check
  check (overtime_hourly_rate_mode in ('auto', 'manual'));

alter table public.payroll_employee_compensation
  drop constraint if exists payroll_employee_compensation_overtime_manual_hourly_rate_check;

alter table public.payroll_employee_compensation
  add constraint payroll_employee_compensation_overtime_manual_hourly_rate_check
  check (overtime_manual_hourly_rate is null or overtime_manual_hourly_rate >= 0);

alter table public.payroll_employee_compensation
  drop constraint if exists payroll_employee_compensation_overtime_multiplier_check;

alter table public.payroll_employee_compensation
  add constraint payroll_employee_compensation_overtime_multiplier_check
  check (overtime_multiplier >= 0);

alter table public.payroll_slips
  add column if not exists paid_by uuid references public.profiles(id) on delete set null,
  add column if not exists paid_at timestamptz;

alter table public.payroll_slips
  drop constraint if exists payroll_slips_status_check;

alter table public.payroll_slips
  add constraint payroll_slips_status_check
  check (status in ('draft', 'confirmed', 'paid'));

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

create index if not exists payroll_slips_paid_cycle_idx
  on public.payroll_slips (paid_at desc, cycle_key desc)
  where status = 'paid';
