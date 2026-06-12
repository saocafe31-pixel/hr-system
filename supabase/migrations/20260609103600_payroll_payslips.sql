-- Payroll MVP: employee compensation settings, 26-25 payslip snapshots,
-- and unpaid leave as a leave request type.

alter table public.leave_requests
  drop constraint if exists leave_requests_leave_type_check;

alter table public.leave_requests
  add constraint leave_requests_leave_type_check
  check (leave_type in ('sick', 'personal', 'vacation', 'unpaid'));

create table if not exists public.payroll_employee_compensation (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  base_salary numeric(12,2) not null default 0 check (base_salary >= 0),
  position_allowance numeric(12,2) not null default 0 check (position_allowance >= 0),
  special_allowance numeric(12,2) not null default 0 check (special_allowance >= 0),
  diligence_allowance numeric(12,2) not null default 0 check (diligence_allowance >= 0),
  travel_allowance numeric(12,2) not null default 0 check (travel_allowance >= 0),
  commission numeric(12,2) not null default 0 check (commission >= 0),
  other_income numeric(12,2) not null default 0 check (other_income >= 0),
  social_security_mode text not null default 'auto'
    check (social_security_mode in ('auto', 'manual')),
  social_security_manual_amount numeric(12,2) check (social_security_manual_amount >= 0),
  withholding_tax_mode text not null default 'auto'
    check (withholding_tax_mode in ('auto', 'manual')),
  withholding_tax_manual_amount numeric(12,2) check (withholding_tax_manual_amount >= 0),
  notes text,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.payroll_slips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  employee_id uuid references public.employee(id) on delete set null,
  cycle_key text not null check (cycle_key ~ '^\d{4}-\d{2}$'),
  period_start date not null,
  period_end date not null,
  status text not null default 'draft' check (status in ('draft', 'confirmed')),
  taxable_income numeric(12,2) not null default 0,
  reimbursement_total numeric(12,2) not null default 0,
  income_total numeric(12,2) not null default 0,
  deduction_total numeric(12,2) not null default 0,
  net_pay numeric(12,2) not null default 0,
  generated_by uuid references public.profiles(id) on delete set null,
  generated_at timestamptz not null default now(),
  confirmed_by uuid references public.profiles(id) on delete set null,
  confirmed_at timestamptz,
  notes text,
  unique (user_id, cycle_key),
  constraint payroll_slips_period_order check (period_start <= period_end)
);

create index if not exists payroll_slips_user_cycle_idx
  on public.payroll_slips (user_id, cycle_key desc);

create index if not exists payroll_slips_status_cycle_idx
  on public.payroll_slips (status, cycle_key desc);

create table if not exists public.payroll_items (
  id uuid primary key default gen_random_uuid(),
  slip_id uuid not null references public.payroll_slips(id) on delete cascade,
  item_kind text not null check (item_kind in ('income', 'deduction', 'reimbursement')),
  item_code text not null,
  label text not null,
  amount numeric(12,2) not null check (amount >= 0),
  taxable boolean not null default false,
  source_table text,
  source_id uuid,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists payroll_items_slip_idx
  on public.payroll_items (slip_id, sort_order asc);

alter table public.payroll_employee_compensation enable row level security;
alter table public.payroll_slips enable row level security;
alter table public.payroll_items enable row level security;

drop policy if exists "payroll_compensation_admin_all" on public.payroll_employee_compensation;
create policy "payroll_compensation_admin_all" on public.payroll_employee_compensation
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "payroll_slips_select_visible" on public.payroll_slips;
create policy "payroll_slips_select_visible" on public.payroll_slips
  for select to authenticated
  using (
    public.is_admin()
    or (
      user_id = auth.uid()
      and status = 'confirmed'
    )
  );

drop policy if exists "payroll_slips_admin_insert" on public.payroll_slips;
create policy "payroll_slips_admin_insert" on public.payroll_slips
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists "payroll_slips_admin_update" on public.payroll_slips;
create policy "payroll_slips_admin_update" on public.payroll_slips
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

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
            s.user_id = auth.uid()
            and s.status = 'confirmed'
          )
        )
    )
  );

drop policy if exists "payroll_items_admin_insert" on public.payroll_items;
create policy "payroll_items_admin_insert" on public.payroll_items
  for insert to authenticated
  with check (
    public.is_admin()
    and exists (
      select 1
      from public.payroll_slips s
      where s.id = payroll_items.slip_id
    )
  );

drop policy if exists "payroll_items_admin_update" on public.payroll_items;
create policy "payroll_items_admin_update" on public.payroll_items
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "payroll_items_admin_delete" on public.payroll_items;
create policy "payroll_items_admin_delete" on public.payroll_items
  for delete to authenticated
  using (public.is_admin());
