-- Employee base salary rates (monthly / daily / hourly) and per-slip pay mode.

create table if not exists public.base_salary (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  monthly_salary numeric(12,2) not null default 0 check (monthly_salary >= 0),
  daily_rate numeric(12,2) not null default 0 check (daily_rate >= 0),
  hourly_rate numeric(12,2) not null default 0 check (hourly_rate >= 0),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

comment on table public.base_salary is
  'ฐานเงินเดือน / ค่าจ้างรายวัน / ค่าจ้างรายชั่วโมง ต่อพนักงาน — ใช้ทำ Payroll และเบิกเงินเดือน';

insert into public.base_salary (user_id, monthly_salary, daily_rate, hourly_rate, updated_by, updated_at)
select
  c.user_id,
  coalesce(c.base_salary, 0),
  0,
  0,
  c.updated_by,
  coalesce(c.updated_at, now())
from public.payroll_employee_compensation c
where coalesce(c.base_salary, 0) > 0
on conflict (user_id) do nothing;

alter table public.payroll_slips
  add column if not exists pay_mode text not null default 'monthly'
    check (pay_mode in ('monthly', 'daily', 'hourly'));

comment on column public.payroll_slips.pay_mode is
  'โหมดคำนวณรายได้หลักของสลิป: monthly | daily | hourly';

alter table public.base_salary enable row level security;

drop policy if exists "base_salary_admin_all" on public.base_salary;
create policy "base_salary_admin_all" on public.base_salary
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Salary claim: prefer base_salary.monthly_salary, fallback payroll_employee_compensation.base_salary
create or replace function public.salary_claim_eligibility()
returns table (
  claim_month date,
  salary_window_open boolean,
  base_salary numeric,
  base_salary_source text,
  eligible_base_amount numeric,
  max_claim_amount numeric,
  active_claim_id uuid,
  active_claim_status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_claim_month date := date_trunc('month', now() at time zone 'Asia/Bangkok')::date;
  v_base numeric(12,2) := 0;
  v_source text := 'employee_input';
  v_active public.salary_claims%rowtype;
begin
  if v_actor is null then
    raise exception 'unauthorized';
  end if;

  select coalesce(bs.monthly_salary, 0)
  into v_base
  from public.base_salary bs
  where bs.user_id = v_actor
  limit 1;

  if coalesce(v_base, 0) > 0 then
    v_source := 'base_salary';
  else
    select coalesce(c.base_salary, 0)
    into v_base
    from public.payroll_employee_compensation c
    where c.user_id = v_actor
    limit 1;
    if coalesce(v_base, 0) > 0 then
      v_source := 'payroll';
    end if;
  end if;

  select *
  into v_active
  from public.salary_claims s
  where s.user_id = v_actor
    and s.claim_month = v_claim_month
    and s.status <> 'rejected'
  order by s.created_at desc
  limit 1;

  return query
  select
    v_claim_month,
    extract(day from now() at time zone 'Asia/Bangkok') between 10 and 14,
    greatest(coalesce(v_base, 0), 0)::numeric(12,2),
    v_source,
    round((greatest(coalesce(v_base, 0), 0) * 0.5)::numeric, 2)::numeric(12,2),
    round((greatest(coalesce(v_base, 0), 0) * 0.5 * 0.7)::numeric, 2)::numeric(12,2),
    v_active.id,
    v_active.status;
end;
$$;

create or replace function public.submit_salary_claim(
  p_requested_amount numeric,
  p_fallback_base_salary numeric default null,
  p_note text default null
)
returns public.salary_claims
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_claim_month date := date_trunc('month', now() at time zone 'Asia/Bangkok')::date;
  v_payroll_base numeric(12,2) := 0;
  v_base numeric(12,2) := 0;
  v_eligible numeric(12,2) := 0;
  v_max numeric(12,2) := 0;
  v_amount numeric(12,2) := round(coalesce(p_requested_amount, 0)::numeric, 2);
  v_full_name text;
  v_bank_name text;
  v_account_number text;
  v_branch_name text;
  v_branch_id bigint;
  v_row public.salary_claims%rowtype;
begin
  if v_actor is null then
    raise exception 'unauthorized';
  end if;

  if extract(day from now() at time zone 'Asia/Bangkok') not between 10 and 14 then
    raise exception 'salary_claim_window_closed';
  end if;

  select *
  into v_profile
  from public.profiles
  where id = v_actor
  limit 1;

  if v_profile.id is null then
    raise exception 'profile_not_found';
  end if;

  select coalesce(bs.monthly_salary, 0)
  into v_payroll_base
  from public.base_salary bs
  where bs.user_id = v_actor
  limit 1;

  if coalesce(v_payroll_base, 0) <= 0 then
    select coalesce(c.base_salary, 0)
    into v_payroll_base
    from public.payroll_employee_compensation c
    where c.user_id = v_actor
    limit 1;
  end if;

  v_base := case
    when coalesce(v_payroll_base, 0) > 0 then v_payroll_base
    else round(coalesce(p_fallback_base_salary, 0)::numeric, 2)
  end;

  if v_base <= 0 then
    raise exception 'base_salary_required';
  end if;

  v_eligible := round((v_base * 0.5)::numeric, 2);
  v_max := round((v_eligible * 0.7)::numeric, 2);

  if v_amount <= 0 then
    raise exception 'requested_amount_required';
  end if;

  if v_amount > v_max then
    raise exception 'requested_amount_exceeds_limit';
  end if;

  if exists (
    select 1
    from public.salary_claims s
    where s.user_id = v_actor
      and s.claim_month = v_claim_month
      and s.status <> 'rejected'
  ) then
    raise exception 'salary_claim_already_exists';
  end if;

  select
    nullif(trim(concat_ws(' ', nullif(e."Name"::text, ''), nullif(e."Surname"::text, ''))), ''),
    nullif(trim(e.bank::text), ''),
    nullif(trim(e."Account number"::text), ''),
    coalesce(nullif(trim(bi.branch_name), ''), nullif(trim(e.branch::text), '')),
    e.branch_id
  into
    v_full_name,
    v_bank_name,
    v_account_number,
    v_branch_name,
    v_branch_id
  from public.employee e
  left join public.branch_information bi on bi.id = e.branch_id
  where e.id = v_profile.employee_id
  limit 1;

  insert into public.salary_claims (
    user_id,
    employee_id,
    claim_month,
    base_salary,
    eligible_base_amount,
    max_claim_amount,
    requested_amount,
    full_name,
    bank_name,
    account_number,
    branch_name,
    branch_id,
    note
  )
  values (
    v_actor,
    v_profile.employee_id,
    v_claim_month,
    v_base,
    v_eligible,
    v_max,
    v_amount,
    coalesce(v_full_name, v_profile.full_name),
    v_bank_name,
    v_account_number,
    v_branch_name,
    coalesce(v_branch_id, v_profile.branch_id),
    nullif(trim(coalesce(p_note, '')), '')
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.salary_claim_eligibility() from public;
grant execute on function public.salary_claim_eligibility() to authenticated;

revoke all on function public.submit_salary_claim(numeric, numeric, text) from public;
grant execute on function public.submit_salary_claim(numeric, numeric, text) to authenticated;
