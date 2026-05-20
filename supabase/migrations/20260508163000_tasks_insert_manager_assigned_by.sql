-- มอบหมายงาน (หน้า tasks.tsx): ผู้จัดการต้องเป็น assigned_by
-- เดิมบังคับ same_branch_as(assigned_to) เท่านั้น — ถ้า branch_id ว่างหรือไม่ตรงจะ insert ไม่ได้
-- ให้ผ่านเมื่อ is_manager + เป็นผู้มอบหมายจริง (ไม่ต้องพึ่งสาขา ณ ขั้น insert)

drop policy if exists "tasks_insert" on public.tasks;

create policy "tasks_insert" on public.tasks
  for insert to authenticated
  with check (
    public.is_admin()
    or (
      public.is_manager()
      and assigned_by = (select auth.uid())
    )
    or (
      assigned_to = (select auth.uid())
      and (
        assigned_by is null
        or assigned_by = (select auth.uid())
      )
    )
  );
