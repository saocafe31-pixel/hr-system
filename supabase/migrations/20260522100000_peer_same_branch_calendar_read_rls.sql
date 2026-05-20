-- พนักงาน (ไม่ใช่ผู้จัดการ/แอดมิน) อ่านตารางกะรายวัน + ตาราง legacy + โน้ตปฏิทินของเพื่อนร่วมสาขาได้
-- เพื่อให้ปฏิทินในโมดัลโปรไฟล์จากแชทเข้า-ออก (และที่อื่นที่ใช้คอมโพเนนต์เดียวกัน) แสดงข้อมูลจริง

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
      not public.is_manager()
      and not public.is_admin()
      and public.same_branch_as(user_id)
    )
  );

-- ---------- work_schedules (legacy) ----------
drop policy if exists "schedules_select" on public.work_schedules;
create policy "schedules_select" on public.work_schedules
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_admin()
    or (
      public.is_manager()
      and public.same_branch_as(user_id)
    )
    or (
      not public.is_manager()
      and not public.is_admin()
      and public.same_branch_as(user_id)
    )
  );

-- ---------- attendance_calendar_notes (อ่านอย่างเดียว — insert/update/delete ยังตาม policy เดิม) ----------
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
      not public.is_manager()
      and not public.is_admin()
      and public.same_branch_as(user_id)
    )
  );
