-- แก้รอบก่อน: เงื่อนไข `not is_manager()` ทำให้ผู้ใช้ที่ role = manager มองไม่เห็นกะ/โน้ตของเพื่อนร่วมสาขา
-- (บน production มักมี manager มากกว่า dev) — รวมเป็น: ทุกคนที่ไม่ใช่ admin + same_branch_as กับเจ้าของแถว

-- ---------- work_schedule_assignments ----------
drop policy if exists "wsa_select_scoped" on public.work_schedule_assignments;
create policy "wsa_select_scoped" on public.work_schedule_assignments
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_admin()
    or (
      public.is_manager()
      and public.is_direct_report_of_me(user_id)
    )
    or (
      not public.is_admin()
      and public.same_branch_as(user_id)
    )
  );

-- ---------- work_schedules (legacy) — รวมเงื่อนไข manager/employee เดิมเป็นข้อเดียว ----------
drop policy if exists "schedules_select" on public.work_schedules;
create policy "schedules_select" on public.work_schedules
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_admin()
    or (
      not public.is_admin()
      and public.same_branch_as(user_id)
    )
  );

-- ---------- attendance_calendar_notes ----------
drop policy if exists "attendance_calendar_notes_select_scoped" on public.attendance_calendar_notes;
create policy "attendance_calendar_notes_select_scoped" on public.attendance_calendar_notes
  for select to authenticated
  using (
    auth.uid() = user_id
    or public.is_admin()
    or (
      public.is_manager()
      and public.is_direct_report_of_me(user_id)
    )
    or (
      not public.is_admin()
      and public.same_branch_as(user_id)
    )
  );
