-- งานให้ตัวเอง: รองรับ assigned_by เป็น null (หรือเท่ากับ auth.uid())
-- + บังคับใช้ policy อีกครั้งหากโปรเจกต์ remote ไม่ตรงกับ migration ก่อนหน้า

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
      assigned_to = (select auth.uid())
      and (
        assigned_by is null
        or assigned_by = (select auth.uid())
      )
    )
  );
