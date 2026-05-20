-- ตัด infinite recursion ระหว่าง tasks ↔ task_assignees ↔ task_checklist/attachments
-- ใช้ฟังก์ชัน SECURITY DEFINER อ่าน tasks + task_assignees โดยไม่ให้ policy วนกัน

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
  'เช็คสิทธิ์อ่านงาน/ส่วนประกอบ — SECURITY DEFINER เพื่อไม่ให้ RLS ระหว่าง tasks กับ task_assignees วนกัน';

grant execute on function public.auth_can_access_task_for_rls(uuid) to authenticated;

-- ---------- tasks ----------
drop policy if exists "tasks_select" on public.tasks;
create policy "tasks_select" on public.tasks
  for select to authenticated
  using (public.auth_can_access_task_for_rls(id));

drop policy if exists "tasks_update" on public.tasks;
create policy "tasks_update" on public.tasks
  for update to authenticated
  using (public.auth_can_access_task_for_rls(id))
  with check (public.auth_can_access_task_for_rls(id));

-- ---------- task_assignees ----------
drop policy if exists "task_assignees_select" on public.task_assignees;
create policy "task_assignees_select" on public.task_assignees
  for select to authenticated
  using (public.auth_can_access_task_for_rls(task_id));

-- ---------- checklist ----------
drop policy if exists "task_checklist_select" on public.task_checklist_items;
create policy "task_checklist_select" on public.task_checklist_items
  for select to authenticated
  using (public.auth_can_access_task_for_rls(task_id));

drop policy if exists "task_checklist_insert" on public.task_checklist_items;
create policy "task_checklist_insert" on public.task_checklist_items
  for insert to authenticated
  with check (public.auth_can_access_task_for_rls(task_id));

drop policy if exists "task_checklist_update" on public.task_checklist_items;
create policy "task_checklist_update" on public.task_checklist_items
  for update to authenticated
  using (public.auth_can_access_task_for_rls(task_id))
  with check (public.auth_can_access_task_for_rls(task_id));

drop policy if exists "task_checklist_delete" on public.task_checklist_items;
create policy "task_checklist_delete" on public.task_checklist_items
  for delete to authenticated
  using (public.auth_can_access_task_for_rls(task_id));

-- ---------- attachments ----------
drop policy if exists "task_attachments_select" on public.task_attachments;
create policy "task_attachments_select" on public.task_attachments
  for select to authenticated
  using (public.auth_can_access_task_for_rls(task_id));

drop policy if exists "task_attachments_insert" on public.task_attachments;
create policy "task_attachments_insert" on public.task_attachments
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and public.auth_can_access_task_for_rls(task_id)
  );

-- ---------- notifications (เดิมเฉพาะ assigned_to — ขยายให้ผู้ร่วมงานแจ้งได้) ----------
drop policy if exists "task_notifications_insert" on public.task_notifications;
create policy "task_notifications_insert" on public.task_notifications
  for insert to authenticated
  with check (
    public.auth_can_access_task_for_rls(task_id)
    or public.is_admin()
  );
