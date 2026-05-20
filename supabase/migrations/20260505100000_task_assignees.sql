-- หลายผู้รับงานต่อ 1 task: task_assignees + RLS ที่ครอบคลุมผู้ร่วมงาน

create table if not exists public.task_assignees (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  is_primary boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (task_id, user_id)
);

create index if not exists task_assignees_task_id_idx
  on public.task_assignees (task_id);

create index if not exists task_assignees_user_id_idx
  on public.task_assignees (user_id);

comment on table public.task_assignees is
  'ผู้เกี่ยวข้องกับงานหนึ่งรายการ — is_primary หลายแถว true = รับผิดชอบร่วมกัน';

-- ข้อมูลเดิม: ผู้รับงานหลัก = assigned_to
insert into public.task_assignees (task_id, user_id, is_primary, sort_order)
select t.id, t.assigned_to, true, 0
from public.tasks t
on conflict (task_id, user_id) do nothing;

alter table public.task_assignees enable row level security;

-- อ่านแถว assignee — ห้ามอ้าง task_assignees ซ้อนใน policy นี้ (จะเกิด infinite recursion กับ tasks_select)
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

-- เพิ่ม/แก้ assignee: ผู้มอบหมาย หรือ แอดมิน/หัวหน้าสาขาเดียวกับ assigned_to
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
            and public.same_branch_as(t.assigned_to)
          )
        )
    )
  );

-- ---------- tasks: ให้ผู้ร่วมงานอ่าน/แก้แถวงาน ----------
drop policy if exists "tasks_select" on public.tasks;
create policy "tasks_select" on public.tasks
  for select to authenticated
  using (
    assigned_to = auth.uid()
    or assigned_by = auth.uid()
    or exists (
      select 1
      from public.task_assignees ta
      where ta.task_id = tasks.id
        and ta.user_id = auth.uid()
    )
    or public.is_admin()
    or (
      public.is_manager()
      and public.same_branch_as(assigned_to)
    )
  );

drop policy if exists "tasks_update" on public.tasks;
create policy "tasks_update" on public.tasks
  for update to authenticated
  using (
    assigned_to = auth.uid()
    or assigned_by = auth.uid()
    or exists (
      select 1
      from public.task_assignees ta
      where ta.task_id = tasks.id
        and ta.user_id = auth.uid()
    )
    or public.is_admin()
    or (
      public.is_manager()
      and public.same_branch_as(assigned_to)
    )
  )
  with check (
    assigned_to = auth.uid()
    or assigned_by = auth.uid()
    or exists (
      select 1
      from public.task_assignees ta
      where ta.task_id = tasks.id
        and ta.user_id = auth.uid()
    )
    or public.is_admin()
    or (
      public.is_manager()
      and public.same_branch_as(assigned_to)
    )
  );

-- ---------- checklist / attachments: ผู้ร่วมงาน ----------
drop policy if exists "task_checklist_select" on public.task_checklist_items;
create policy "task_checklist_select" on public.task_checklist_items
  for select to authenticated
  using (
    exists (
      select 1
      from public.tasks t
      where t.id = task_id
        and (
          t.assigned_to = auth.uid()
          or t.assigned_by = auth.uid()
          or exists (
            select 1
            from public.task_assignees ta
            where ta.task_id = t.id
              and ta.user_id = auth.uid()
          )
          or public.is_admin()
          or (
            public.is_manager()
            and public.same_branch_as(t.assigned_to)
          )
        )
    )
  );

drop policy if exists "task_checklist_insert" on public.task_checklist_items;
create policy "task_checklist_insert" on public.task_checklist_items
  for insert to authenticated
  with check (
    exists (
      select 1
      from public.tasks t
      where t.id = task_id
        and (
          t.assigned_to = auth.uid()
          or t.assigned_by = auth.uid()
          or exists (
            select 1
            from public.task_assignees ta
            where ta.task_id = t.id
              and ta.user_id = auth.uid()
          )
          or public.is_admin()
          or (
            public.is_manager()
            and public.same_branch_as(t.assigned_to)
          )
        )
    )
  );

drop policy if exists "task_checklist_update" on public.task_checklist_items;
create policy "task_checklist_update" on public.task_checklist_items
  for update to authenticated
  using (
    exists (
      select 1
      from public.tasks t
      where t.id = task_id
        and (
          t.assigned_to = auth.uid()
          or t.assigned_by = auth.uid()
          or exists (
            select 1
            from public.task_assignees ta
            where ta.task_id = t.id
              and ta.user_id = auth.uid()
          )
          or public.is_admin()
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
          t.assigned_to = auth.uid()
          or t.assigned_by = auth.uid()
          or exists (
            select 1
            from public.task_assignees ta
            where ta.task_id = t.id
              and ta.user_id = auth.uid()
          )
          or public.is_admin()
          or (
            public.is_manager()
            and public.same_branch_as(t.assigned_to)
          )
        )
    )
  );

drop policy if exists "task_checklist_delete" on public.task_checklist_items;
create policy "task_checklist_delete" on public.task_checklist_items
  for delete to authenticated
  using (
    exists (
      select 1
      from public.tasks t
      where t.id = task_id
        and (
          t.assigned_to = auth.uid()
          or t.assigned_by = auth.uid()
          or exists (
            select 1
            from public.task_assignees ta
            where ta.task_id = t.id
              and ta.user_id = auth.uid()
          )
          or public.is_admin()
          or (
            public.is_manager()
            and public.same_branch_as(t.assigned_to)
          )
        )
    )
  );

drop policy if exists "task_attachments_select" on public.task_attachments;
create policy "task_attachments_select" on public.task_attachments
  for select to authenticated
  using (
    exists (
      select 1
      from public.tasks t
      where t.id = task_id
        and (
          t.assigned_to = auth.uid()
          or t.assigned_by = auth.uid()
          or exists (
            select 1
            from public.task_assignees ta
            where ta.task_id = t.id
              and ta.user_id = auth.uid()
          )
          or public.is_admin()
          or (
            public.is_manager()
            and public.same_branch_as(t.assigned_to)
          )
        )
    )
  );

drop policy if exists "task_attachments_insert" on public.task_attachments;
create policy "task_attachments_insert" on public.task_attachments
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and exists (
      select 1
      from public.tasks t
      where t.id = task_id
        and (
          t.assigned_to = auth.uid()
          or t.assigned_by = auth.uid()
          or exists (
            select 1
            from public.task_assignees ta
            where ta.task_id = t.id
              and ta.user_id = auth.uid()
          )
          or public.is_admin()
          or (
            public.is_manager()
            and public.same_branch_as(t.assigned_to)
          )
        )
    )
  );

drop policy if exists "task_notifications_insert" on public.task_notifications;
create policy "task_notifications_insert" on public.task_notifications
  for insert to authenticated
  with check (
    exists (
      select 1
      from public.tasks t
      where t.id = task_id
        and (
          t.assigned_to = auth.uid()
          or exists (
            select 1
            from public.task_assignees ta
            where ta.task_id = t.id
              and ta.user_id = auth.uid()
          )
        )
    )
    or public.is_admin()
  );
