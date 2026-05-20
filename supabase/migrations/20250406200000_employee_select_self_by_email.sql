-- ให้พนักงานอ่านแถวของตัวเองได้เมื่อ UserID ตรงกับอีเมลใน JWT
-- (กรณี profiles.employee_id ชี้ UUID เก่า/ผิดหลัง import หรือยังไม่เชื่อม)
do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'employee'
  ) then
    return;
  end if;

  drop policy if exists "employee_select_self" on public.employee;

  create policy "employee_select_self" on public.employee
    for select to authenticated
    using (
      exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.employee_id = employee.id
      )
      or (
        employee."UserID" is not null
        and btrim(employee."UserID"::text) <> ''
        and trim(lower(employee."UserID"::text))
          = trim(lower(coalesce(auth.jwt() ->> 'email', '')))
      )
    );
end $$;
