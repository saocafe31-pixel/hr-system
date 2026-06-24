-- หนังสือรับรองการทำงาน: ตั้งค่าลายเซ็น (app_settings) + RPC ดึงข้อมูลสำหรับพนักงาน

insert into public.app_settings (key, value)
values (
  'employment_certificate_settings',
  '{
    "signer_name": "",
    "signer_title": "ประธานกรรมการบริษัท",
    "signature_url": "",
    "logo_url": "",
    "hr_footer_note": "หมายเหตุ: ฝ่ายทรัพยากรมนุษย์ โทร. 061-732-1346"
  }'::jsonb
)
on conflict (key) do nothing;

-- ---------- Storage: ลายเซ็น / โลโก้หนังสือรับรอง ----------
insert into storage.buckets (id, name, public)
values ('employment_certificate_assets', 'employment_certificate_assets', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "emp_cert_assets_public_read" on storage.objects;
create policy "emp_cert_assets_public_read" on storage.objects
  for select using (bucket_id = 'employment_certificate_assets');

drop policy if exists "emp_cert_assets_admin_write" on storage.objects;
create policy "emp_cert_assets_admin_write" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'employment_certificate_assets' and public.is_admin());

drop policy if exists "emp_cert_assets_admin_update" on storage.objects;
create policy "emp_cert_assets_admin_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'employment_certificate_assets' and public.is_admin())
  with check (bucket_id = 'employment_certificate_assets' and public.is_admin());

drop policy if exists "emp_cert_assets_admin_delete" on storage.objects;
create policy "emp_cert_assets_admin_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'employment_certificate_assets' and public.is_admin());

-- ---------- RPC: พนักงานดึงข้อมูลออกหนังสือรับรองของตัวเอง ----------
create or replace function public.get_my_employment_certificate_data(
  p_with_salary boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_emp public.employee%rowtype;
  v_salary numeric := 0;
  v_status text;
  v_company jsonb;
  v_cert jsonb;
  v_branch text;
begin
  if v_uid is null then
    raise exception 'unauthorized';
  end if;

  select * into v_profile
  from public.profiles
  where id = v_uid;

  if v_profile.employee_id is null then
    raise exception 'employee_not_linked';
  end if;

  select * into v_emp
  from public.employee
  where id = v_profile.employee_id;

  if not found then
    raise exception 'employee_not_found';
  end if;

  v_status := lower(coalesce(trim(v_emp.status::text), ''));
  if v_status like '%ลาออก%' or v_status like '%resign%' then
    raise exception 'employee_not_active';
  end if;

  select coalesce(bs.monthly_salary, pec.base_salary, 0)
  into v_salary
  from (select 1) dummy
  left join public.base_salary bs on bs.user_id = v_uid
  left join public.payroll_employee_compensation pec on pec.user_id = v_uid;

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

revoke all on function public.get_my_employment_certificate_data(boolean) from public;
grant execute on function public.get_my_employment_certificate_data(boolean) to authenticated;

comment on function public.get_my_employment_certificate_data(boolean) is
  'พนักงานดึงข้อมูลออกหนังสือรับรองของตัวเอง (with/without salary)';
