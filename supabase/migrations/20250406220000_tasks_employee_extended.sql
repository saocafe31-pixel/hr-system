-- งาน: priority, วันเริ่ม, พนักงานสร้างให้ตัวเอง + checklist + แนบไฟล์/ลิงก์ + แจ้งเตือนหัวหน้า

alter table public.tasks add column if not exists start_at timestamptz;
alter table public.tasks add column if not exists priority text;

update public.tasks set priority = 'normal' where priority is null or priority = '';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'tasks_priority_check'
  ) then
    alter table public.tasks
      add constraint tasks_priority_check
      check (priority in ('urgent', 'high', 'medium', 'normal'));
  end if;
end $$;

alter table public.tasks alter column priority set default 'normal';

-- ---------- checklist ----------
create table if not exists public.task_checklist_items (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  label text not null,
  done boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists task_checklist_items_task_id_idx
  on public.task_checklist_items (task_id, sort_order);

-- ---------- แนบลิงก์/รูป/ไฟล์ (url จาก Storage หรือลิงก์ภายนอก) ----------
create table if not exists public.task_attachments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  kind text not null check (kind in ('link', 'image', 'file')),
  url text not null,
  title text,
  created_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists task_attachments_task_id_idx
  on public.task_attachments (task_id);

-- ---------- แจ้งเตือนในแอป (หัวหน้า / ผู้มอบหมาย) ----------
create table if not exists public.task_notifications (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  body text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists task_notifications_recipient_idx
  on public.task_notifications (recipient_id, created_at desc);

-- ---------- RLS ----------
alter table public.task_checklist_items enable row level security;
alter table public.task_attachments enable row level security;
alter table public.task_notifications enable row level security;

-- tasks: พนักงานสร้างงานให้ตัวเอง (assigned_to = assigned_by = ตัวเอง)
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

-- checklist
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
          or public.is_admin()
          or (
            public.is_manager()
            and public.same_branch_as(t.assigned_to)
          )
        )
    )
  );

-- attachments
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
          or public.is_admin()
          or (
            public.is_manager()
            and public.same_branch_as(t.assigned_to)
          )
        )
    )
  );

drop policy if exists "task_attachments_delete" on public.task_attachments;
create policy "task_attachments_delete" on public.task_attachments
  for delete to authenticated
  using (
    created_by = auth.uid()
    or public.is_admin()
    or (
      public.is_manager()
      and exists (
        select 1
        from public.tasks t
        where t.id = task_id
          and public.same_branch_as(t.assigned_to)
      )
    )
  );

-- notifications
drop policy if exists "task_notifications_select" on public.task_notifications;
create policy "task_notifications_select" on public.task_notifications
  for select to authenticated
  using (recipient_id = auth.uid());

drop policy if exists "task_notifications_insert" on public.task_notifications;
create policy "task_notifications_insert" on public.task_notifications
  for insert to authenticated
  with check (
    exists (
      select 1
      from public.tasks t
      where t.id = task_id
        and t.assigned_to = auth.uid()
    )
    or public.is_admin()
  );

drop policy if exists "task_notifications_update" on public.task_notifications;
create policy "task_notifications_update" on public.task_notifications
  for update to authenticated
  using (recipient_id = auth.uid())
  with check (recipient_id = auth.uid());

-- Storage: ไฟล์งาน (รูป/ไฟล์ อัปโหลดจากแอป)
insert into storage.buckets (id, name, public)
values ('task_files', 'task_files', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "task_files_public_read" on storage.objects;
create policy "task_files_public_read" on storage.objects
  for select using (bucket_id = 'task_files');

drop policy if exists "task_files_insert_own" on storage.objects;
create policy "task_files_insert_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'task_files'
    and (storage.foldername (name))[1] = auth.uid()::text
  );

drop policy if exists "task_files_update_own" on storage.objects;
create policy "task_files_update_own" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'task_files'
    and (storage.foldername (name))[1] = auth.uid()::text
  );

drop policy if exists "task_files_delete_own" on storage.objects;
create policy "task_files_delete_own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'task_files'
    and (storage.foldername (name))[1] = auth.uid()::text
  );
