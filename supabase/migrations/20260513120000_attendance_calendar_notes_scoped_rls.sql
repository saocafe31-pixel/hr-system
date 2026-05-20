-- ขยาย RLS ของ attendance_calendar_notes: ผู้จัดการอ่านโน้ตลูกทีมได้;
-- แก้ไข/เพิ่ม/ลบแทนลูกทีมได้เมื่อมีสิทธิ์ can_manage_schedule (และเป็น direct report);
-- แอดมินทำได้ทุกแถว

drop policy if exists "attendance_calendar_notes_select_own" on public.attendance_calendar_notes;
drop policy if exists "attendance_calendar_notes_insert_own" on public.attendance_calendar_notes;
drop policy if exists "attendance_calendar_notes_update_own" on public.attendance_calendar_notes;
drop policy if exists "attendance_calendar_notes_delete_own" on public.attendance_calendar_notes;

create policy "attendance_calendar_notes_select_scoped" on public.attendance_calendar_notes
  for select to authenticated
  using (
    auth.uid() = user_id
    or public.is_admin()
    or (
      public.is_manager()
      and public.is_direct_report_of_me(user_id)
    )
  );

create policy "attendance_calendar_notes_insert_scoped" on public.attendance_calendar_notes
  for insert to authenticated
  with check (
    auth.uid() = user_id
    or public.is_admin()
    or (
      public.is_manager()
      and exists (
        select 1 from public.manager_scopes s
        where s.manager_id = auth.uid() and s.can_manage_schedule
      )
      and public.is_direct_report_of_me(user_id)
    )
  );

create policy "attendance_calendar_notes_update_scoped" on public.attendance_calendar_notes
  for update to authenticated
  using (
    auth.uid() = user_id
    or public.is_admin()
    or (
      public.is_manager()
      and exists (
        select 1 from public.manager_scopes s
        where s.manager_id = auth.uid() and s.can_manage_schedule
      )
      and public.is_direct_report_of_me(user_id)
    )
  )
  with check (
    auth.uid() = user_id
    or public.is_admin()
    or (
      public.is_manager()
      and exists (
        select 1 from public.manager_scopes s
        where s.manager_id = auth.uid() and s.can_manage_schedule
      )
      and public.is_direct_report_of_me(user_id)
    )
  );

create policy "attendance_calendar_notes_delete_scoped" on public.attendance_calendar_notes
  for delete to authenticated
  using (
    auth.uid() = user_id
    or public.is_admin()
    or (
      public.is_manager()
      and exists (
        select 1 from public.manager_scopes s
        where s.manager_id = auth.uid() and s.can_manage_schedule
      )
      and public.is_direct_report_of_me(user_id)
    )
  );
