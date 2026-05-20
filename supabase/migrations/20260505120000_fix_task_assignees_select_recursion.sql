-- แก้ infinite recursion: task_assignees_select ห้ามอ้าง task_assignees ซ้อน
-- (tasks_select อ้าง task_assignees → policy นี้ห้ามวนกลับไปอ่าน task_assignees อีกชั้น)

drop policy if exists "task_assignees_select" on public.task_assignees;
create policy "task_assignees_select" on public.task_assignees
  for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1
      from public.tasks t
      where t.id = task_id
        and (
          t.assigned_to = auth.uid()
          or t.assigned_by = auth.uid()
          or public.is_admin()
          or (
            public.is_manager()
            and public.same_branch_as(t.assigned_to)
          )
        )
    )
    or exists (
      select 1
      from public.task_assignees me
      where me.task_id = task_assignees.task_id
        and me.user_id = auth.uid()
    )
  );
