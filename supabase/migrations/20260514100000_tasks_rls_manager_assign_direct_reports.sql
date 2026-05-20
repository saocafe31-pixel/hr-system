-- มอบหมายงานจากผู้จัดการ: policy รุ่นก่อน (และบาง remote) ยังใช้แค่ same_branch_as(assigned_to)
-- ทำให้ลูกทีมที่สาขา/branch_id ไม่ตรงหรือว่างมอบหมายไม่ได้ แม้อยู่ใน manager_direct_reports
-- + ขยาย auth_can_access_task_for_rls ให้ผู้จัดการเห็นงานของลูกทีมโดยตรง

create or replace function public.auth_can_access_task_for_rls(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.tasks t
    where t.id = p_task_id
      and (
        t.assigned_to = auth.uid()
        or t.assigned_by = auth.uid()
        or public.is_admin()
        or (
          public.is_manager()
          and public.same_branch_as(t.assigned_to)
        )
        or (
          public.is_manager()
          and exists (
            select 1
            from public.manager_direct_reports r
            where r.manager_id = auth.uid()
              and r.subordinate_id = t.assigned_to
          )
        )
      )
  )
  or exists (
    select 1
    from public.task_assignees ta
    where ta.task_id = p_task_id
      and ta.user_id = auth.uid()
  );
$$;

comment on function public.auth_can_access_task_for_rls(uuid) is
  'เช็คสิทธิ์อ่านงาน/ส่วนประกอบ — รวมผู้จัดการกับลูกทีมใน manager_direct_reports';

-- ---------- tasks: insert ----------
drop policy if exists "tasks_insert" on public.tasks;

create policy "tasks_insert" on public.tasks
  for insert to authenticated
  with check (
    public.is_admin()
    or (
      public.is_manager()
      and assigned_by = (select auth.uid())
      and (
        assigned_to = (select auth.uid())
        or public.same_branch_as(assigned_to)
        or exists (
          select 1
          from public.manager_direct_reports r
          where r.manager_id = (select auth.uid())
            and r.subordinate_id = assigned_to
        )
      )
    )
    or (
      assigned_to = (select auth.uid())
      and (
        assigned_by is null
        or assigned_by = (select auth.uid())
      )
    )
  );

-- ---------- task_assignees: ผู้มอบหมาย (assigned_by) จัดการแถวได้โดยไม่พึ่งสาขา ----------
drop policy if exists "task_assignees_insert" on public.task_assignees;

create policy "task_assignees_insert" on public.task_assignees
  for insert to authenticated
  with check (
    exists (
      select 1
      from public.tasks t
      where t.id = task_id
        and (
          t.assigned_by = auth.uid()
          or (
            t.assigned_to = auth.uid()
            and t.assigned_by = auth.uid()
          )
          or public.is_admin()
          or (
            public.is_manager()
            and t.assigned_by = auth.uid()
          )
          or (
            public.is_manager()
            and public.same_branch_as(t.assigned_to)
          )
        )
    )
  );

drop policy if exists "task_assignees_update" on public.task_assignees;

create policy "task_assignees_update" on public.task_assignees
  for update to authenticated
  using (
    exists (
      select 1
      from public.tasks t
      where t.id = task_id
        and (
          t.assigned_by = auth.uid()
          or public.is_admin()
          or (
            public.is_manager()
            and t.assigned_by = auth.uid()
          )
          or (
            public.is_manager()
            and public.same_branch_as(t.assigned_to)
          )
        )
    )
  )
  with check (
    exists (
      select 1
      from public.tasks t
      where t.id = task_id
        and (
          t.assigned_by = auth.uid()
          or public.is_admin()
          or (
            public.is_manager()
            and t.assigned_by = auth.uid()
          )
          or (
            public.is_manager()
            and public.same_branch_as(t.assigned_to)
          )
        )
    )
  );

drop policy if exists "task_assignees_delete" on public.task_assignees;

create policy "task_assignees_delete" on public.task_assignees
  for delete to authenticated
  using (
    exists (
      select 1
      from public.tasks t
      where t.id = task_id
        and (
          t.assigned_by = auth.uid()
          or public.is_admin()
          or (
            public.is_manager()
            and t.assigned_by = auth.uid()
          )
          or (
            public.is_manager()
            and public.same_branch_as(t.assigned_to)
          )
        )
    )
  );
