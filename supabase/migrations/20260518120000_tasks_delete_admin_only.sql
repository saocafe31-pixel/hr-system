-- ลบงานได้เฉพาะ admin (เดิมผู้จัดการในสาขาเดียวกับผู้รับงานลบได้)
drop policy if exists "tasks_delete" on public.tasks;

create policy "tasks_delete" on public.tasks
  for delete to authenticated
  using (public.is_admin());
