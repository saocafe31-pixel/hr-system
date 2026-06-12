-- Allow employees to see confirmed payslips by either their auth profile id
-- or the HR employee_id linked to their profile. This covers duplicate/relinked
-- profile rows that point to the same employee record.

drop policy if exists "payroll_slips_select_visible" on public.payroll_slips;
create policy "payroll_slips_select_visible" on public.payroll_slips
  for select to authenticated
  using (
    public.is_admin()
    or (
      status = 'confirmed'
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
            s.status = 'confirmed'
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
