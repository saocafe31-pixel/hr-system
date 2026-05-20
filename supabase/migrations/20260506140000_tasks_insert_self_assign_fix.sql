-- ยืนยัน tasks_insert: พนักงานสร้างงานให้ตัวเอง (assigned_to = assigned_by = auth.uid())
-- กรณีบางโปรเจกต์ policy หลุดหลัง migration เก่า

drop policy if exists "tasks_insert" on public.tasks;

create policy "tasks_insert" on public.tasks
  for insert to authenticated
  with check (
    public.is_admin()
    or (
      public.is_manager()
      and public.same_branch_as(assigned_to)
    )
    or (
      assigned_to = auth.uid()
      and assigned_by = auth.uid()
    )
  );
