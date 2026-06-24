-- แอดมินออกหนังสือรับรองให้พนักงาน (เลือก employee.id)

create or replace function public.admin_get_employment_certificate_data(
  p_employee_id uuid,
  p_with_salary boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp public.employee%rowtype;
  v_user_id uuid;
  v_salary numeric := 0;
  v_status text;
  v_company jsonb;
  v_cert jsonb;
  v_branch text;
begin
  if auth.uid() is null then
    raise exception 'unauthorized';
  end if;
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;
  if p_employee_id is null then
    raise exception 'employee_id_required';
  end if;

  select * into v_emp
  from public.employee
  where id = p_employee_id;

  if not found then
    raise exception 'employee_not_found';
  end if;

  v_status := lower(coalesce(trim(v_emp.status::text), ''));
  if v_status like '%ลาออก%' or v_status like '%resign%' then
    raise exception 'employee_not_active';
  end if;

  select p.id into v_user_id
  from public.profiles p
  where p.employee_id = v_emp.id
  limit 1;

  if v_user_id is not null then
    select coalesce(bs.monthly_salary, pec.base_salary, 0)
    into v_salary
    from (select 1) dummy
    left join public.base_salary bs on bs.user_id = v_user_id
    left join public.payroll_employee_compensation pec on pec.user_id = v_user_id;
  end if;

  if coalesce(p_with_salary, false) and coalesce(v_salary, 0) <= 0 then
    raise exception 'salary_not_configured';
  end if;

  select coalesce(s.value, '{}'::jsonb)
  into v_company
  from public.app_settings s
  where s.key = 'payroll_company_info';

  select coalesce(s.value, '{}'::jsonb)
  into v_cert
  from public.app_settings s
  where s.key = 'employment_certificate_settings';

  select nullif(trim(coalesce(bi.branch_name, v_emp.branch::text, '')), '')
  into v_branch
  from (select 1) dummy
  left join public.branch_information bi on bi.id = v_emp.branch_id;

  return jsonb_build_object(
    'with_salary', coalesce(p_with_salary, false),
    'company', v_company,
    'certificate', v_cert,
    'employee', jsonb_build_object(
      'full_name', nullif(trim(concat_ws(
        ' ',
        nullif(trim(v_emp."Prefix"::text), ''),
        nullif(trim(v_emp."Name"::text), ''),
        nullif(trim(v_emp."Surname"::text), '')
      )), ''),
      'position', nullif(trim(v_emp.position::text), ''),
      'branch', v_branch,
      'start_date', nullif(trim(v_emp."Start date"::text), '')
    ),
    'monthly_salary', case
      when coalesce(p_with_salary, false) then v_salary
      else null
    end
  );
end;
$$;

revoke all on function public.admin_get_employment_certificate_data(uuid, boolean) from public;
grant execute on function public.admin_get_employment_certificate_data(uuid, boolean) to authenticated;

comment on function public.admin_get_employment_certificate_data(uuid, boolean) is
  'แอดมินดึงข้อมูลออกหนังสือรับรองของพนักงานตาม employee.id';
