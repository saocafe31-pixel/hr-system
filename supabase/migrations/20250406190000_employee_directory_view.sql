-- View สำหรับแอป: แมปคอลัมน์จริงของ employee → ชื่อฟิลด์ที่ mobile ใช้ (EmployeeDirectory)
-- security_invoker ให้ RLS ของตาราง employee ใช้กับแถวที่อ่านผ่าน view
-- branch_id: บางโปรเจกต์ยังไม่มีคอลัมน์นี้ในตาราง employee → ใช้ NULL แทน

do $$
declare
  branch_expr text := 'null::bigint';
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'employee'
      and column_name = 'branch_id'
  ) then
    branch_expr := 'e.branch_id';
  end if;

  execute
    'create or replace view public.employee_directory
    with (security_invoker = true) as
    select
      e.id,
      e."UserID" as legacy_user_id,
      e."Employee ID" as employee_no,
      e."Prefix" as prefix,
      e."Name" as name,
      e."Surname" as surname,
      e.nickname,
      e.position,
      e.branch,
      ' || branch_expr || ' as branch_id,
      e."phone number" as phone,
      e."Start date" as start_date,
      e."National ID number" as national_id,
      e."Address as per ID card" as address_id_card,
      e."Current address" as current_address,
      e.bank,
      e."Account number" as account_number,
      e.status
    from public.employee e';
end $$;

grant select on public.employee_directory to authenticated;
