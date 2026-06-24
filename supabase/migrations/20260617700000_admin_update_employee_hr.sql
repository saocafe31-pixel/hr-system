-- แอดมินบันทึกข้อมูล HR ใน employee ผ่าน SECURITY DEFINER (สอดคล้อง admin_get_employee_directory_row)
-- แก้กรณี client .update() คืน success แต่ RLS/PostgREST ไม่อัปเดตแถวจริง

create or replace function public.admin_update_employee_hr(
  p_id uuid,
  p_legacy_user_id text,
  p_employee_no integer,
  p_prefix text,
  p_name text,
  p_surname text,
  p_nickname text,
  p_position text,
  p_branch text,
  p_branch_id bigint,
  p_phone text,
  p_start_date text,
  p_national_id text,
  p_address_id_card text,
  p_current_address text,
  p_bank text,
  p_account_number text,
  p_status text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_has_branch_id boolean;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'employee'
      and column_name = 'branch_id'
  )
  into v_has_branch_id;

  if v_has_branch_id then
    update public.employee e
    set
      "UserID" = nullif(btrim(coalesce(p_legacy_user_id, '')), ''),
      "Employee ID" = p_employee_no,
      "Prefix" = nullif(btrim(coalesce(p_prefix, '')), ''),
      "Name" = nullif(btrim(coalesce(p_name, '')), ''),
      "Surname" = nullif(btrim(coalesce(p_surname, '')), ''),
      nickname = nullif(btrim(coalesce(p_nickname, '')), ''),
      "position" = nullif(btrim(coalesce(p_position, '')), ''),
      branch = nullif(btrim(coalesce(p_branch, '')), ''),
      branch_id = p_branch_id,
      "phone number" = nullif(btrim(coalesce(p_phone, '')), ''),
      "Start date" = nullif(btrim(coalesce(p_start_date, '')), ''),
      "National ID number" = nullif(btrim(coalesce(p_national_id, '')), ''),
      "Address as per ID card" = nullif(btrim(coalesce(p_address_id_card, '')), ''),
      "Current address" = nullif(btrim(coalesce(p_current_address, '')), ''),
      bank = nullif(btrim(coalesce(p_bank, '')), ''),
      "Account number" = nullif(btrim(coalesce(p_account_number, '')), ''),
      status = nullif(btrim(coalesce(p_status, '')), '')
    where e.id = p_id
    returning e.id into v_id;
  else
    update public.employee e
    set
      "UserID" = nullif(btrim(coalesce(p_legacy_user_id, '')), ''),
      "Employee ID" = p_employee_no,
      "Prefix" = nullif(btrim(coalesce(p_prefix, '')), ''),
      "Name" = nullif(btrim(coalesce(p_name, '')), ''),
      "Surname" = nullif(btrim(coalesce(p_surname, '')), ''),
      nickname = nullif(btrim(coalesce(p_nickname, '')), ''),
      "position" = nullif(btrim(coalesce(p_position, '')), ''),
      branch = nullif(btrim(coalesce(p_branch, '')), ''),
      "phone number" = nullif(btrim(coalesce(p_phone, '')), ''),
      "Start date" = nullif(btrim(coalesce(p_start_date, '')), ''),
      "National ID number" = nullif(btrim(coalesce(p_national_id, '')), ''),
      "Address as per ID card" = nullif(btrim(coalesce(p_address_id_card, '')), ''),
      "Current address" = nullif(btrim(coalesce(p_current_address, '')), ''),
      bank = nullif(btrim(coalesce(p_bank, '')), ''),
      "Account number" = nullif(btrim(coalesce(p_account_number, '')), ''),
      status = nullif(btrim(coalesce(p_status, '')), '')
    where e.id = p_id
    returning e.id into v_id;
  end if;

  if v_id is null then
    raise exception 'ไม่พบพนักงานตามรหัส % หรืออัปเดตไม่สำเร็จ', p_id;
  end if;

  return v_id;
end;
$$;

revoke all on function public.admin_update_employee_hr(
  uuid, text, integer,
  text, text, text, text, text, text,
  bigint,
  text, text, text, text, text, text, text, text
) from public;
grant execute on function public.admin_update_employee_hr(
  uuid, text, integer,
  text, text, text, text, text, text,
  bigint,
  text, text, text, text, text, text, text, text
) to authenticated;

comment on function public.admin_update_employee_hr(
  uuid, text, integer,
  text, text, text, text, text, text,
  bigint,
  text, text, text, text, text, text, text, text
) is
  'แอดมินอัปเดตแถว public.employee ตามฟอร์ม HR ใน AdminEmployeeEditModal';
