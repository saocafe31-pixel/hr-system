-- Let admins decide whether each approved expense claim should be included
-- in Payroll / payslips or recorded as a separate direct payment.

alter table public.expense_claims
  add column if not exists payroll_handling text not null default 'undecided',
  add column if not exists payroll_handling_decided_by uuid references public.profiles(id) on delete set null,
  add column if not exists payroll_handling_decided_at timestamptz;

alter table public.expense_claims
  drop constraint if exists expense_claims_payroll_handling_check;

alter table public.expense_claims
  add constraint expense_claims_payroll_handling_check
  check (payroll_handling in ('undecided', 'payroll', 'direct'));

update public.expense_claims
set
  payroll_handling = 'payroll',
  payroll_handling_decided_by = coalesce(payroll_handling_decided_by, reviewed_by),
  payroll_handling_decided_at = coalesce(payroll_handling_decided_at, reviewed_at, updated_at, now())
where status in ('approved', 'paid')
  and payroll_handling = 'undecided';

create index if not exists expense_claims_payroll_handling_idx
  on public.expense_claims (payroll_handling, status, created_at desc);
