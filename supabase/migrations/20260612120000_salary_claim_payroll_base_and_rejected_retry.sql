-- Make Claim Salary use admin Payroll base salary when available,
-- and let employees retry in the same month after a rejected claim.

alter table public.salary_claims
  drop constraint if exists salary_claims_user_id_claim_month_key;

create unique index if not exists salary_claims_active_user_month_uidx
  on public.salary_claims (user_id, claim_month)
  where status <> 'rejected';

drop policy if exists "salary_claims_insert_own" on public.salary_claims;

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
  v_active public.salary_claims%rowtype;
begin
  if v_actor is null then
    raise exception 'unauthorized';
  end if;

  select coalesce(c.base_salary, 0)
  into v_base
  from public.payroll_employee_compensation c
  where c.user_id = v_actor
  limit 1;

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
    case when coalesce(v_base, 0) > 0 then 'payroll' else 'employee_input' end,
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

  select coalesce(c.base_salary, 0)
  into v_payroll_base
  from public.payroll_employee_compensation c
  where c.user_id = v_actor
  limit 1;

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
