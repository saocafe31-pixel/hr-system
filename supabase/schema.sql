-- FOLIAGE Mobile — run once in Supabase SQL Editor
-- After: disable public sign-up in Authentication > Providers (users created by admin)

create extension if not exists "pgcrypto";

-- ---------- types ----------
do $$ begin
  create type public.user_role as enum ('employee', 'manager', 'admin');
exception
  when duplicate_object then null;
end $$;

-- ---------- tables ----------
-- สาขา: ใช้ branch_information (ข้อมูลจริงขององค์กร) แทน branches
create table if not exists public.branch_information (
  branch_code text null,
  branch_name text null,
  address text null,
  latitude double precision null,
  phone_number bigint null,
  id bigint not null,
  longitude double precision null,
  radius_meters integer not null default 150,
  constraint branch_information_pkey primary key (id)
);

alter table public.branch_information
  add column if not exists radius_meters integer not null default 150;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text,
  role public.user_role not null default 'employee',
  branch_id bigint references public.branch_information (id) on delete set null,
  employee_code text unique,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists employee_id uuid;

create table if not exists public.attendance_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  branch_id bigint references public.branch_information (id) on delete set null,
  kind text not null check (kind in ('check_in', 'check_out', 'break_start', 'break_end')),
  latitude double precision,
  longitude double precision,
  within_branch boolean not null default false,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.work_schedules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  start_at timestamptz not null,
  end_at timestamptz not null,
  title text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  assigned_to uuid not null references public.profiles (id) on delete cascade,
  assigned_by uuid references public.profiles (id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'in_progress', 'done', 'cancelled')),
  due_at timestamptz,
  start_at timestamptz,
  priority text not null default 'normal'
    check (priority in ('urgent', 'high', 'medium', 'normal')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.task_checklist_items (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  label text not null,
  done boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.task_attachments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  kind text not null check (kind in ('link', 'image', 'file')),
  url text not null,
  title text,
  created_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.task_notifications (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  body text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.attendance_chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.community_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.community_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles (id) on delete cascade,
  body text not null check (char_length(body) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.community_note_replies (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.community_notes (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(body) <= 120),
  created_at timestamptz not null default now()
);

create index if not exists community_note_replies_note_created_idx
  on public.community_note_replies (note_id, created_at asc);

create table if not exists public.community_feed_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  image_url text not null,
  caption text,
  created_at timestamptz not null default now()
);

create index if not exists community_feed_posts_created_idx
  on public.community_feed_posts (created_at desc);

create table if not exists public.community_feed_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.community_feed_posts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(body) <= 500),
  created_at timestamptz not null default now()
);

create index if not exists community_feed_comments_post_created_idx
  on public.community_feed_comments (post_id, created_at asc);

create table if not exists public.wellbeing_checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  mood_key text not null
    check (
      mood_key in (
        'ready_great',
        'relaxed_ready',
        'ok_start',
        'tired_fight',
        'unwell'
      )
    ),
  score smallint not null check (score >= 1 and score <= 5),
  emoji text not null,
  label text not null,
  attendance_kind text not null
    check (attendance_kind in ('check_in', 'check_out')),
  created_at timestamptz not null default now()
);

create index if not exists wellbeing_checkins_user_created_idx
  on public.wellbeing_checkins (user_id, created_at desc);

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

-- ---------- helpers (RLS) ----------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  );
$$;

create or replace function public.is_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'manager'
  );
$$;

-- คืนค่า branch_information.id (bigint)
drop function if exists public.my_branch_id();

create function public.my_branch_id()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select branch_id from public.profiles where id = auth.uid();
$$;

create or replace function public.same_branch_as(target_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles me
    join public.profiles them on them.id = target_user
    where me.id = auth.uid()
      and me.branch_id is not null
      and me.branch_id = them.branch_id
  );
$$;

-- New auth user → profile row (admin sets role/branch in Dashboard or app)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    'employee'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- updated_at ----------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists tasks_updated_at on public.tasks;
create trigger tasks_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();

drop trigger if exists community_notes_updated_at on public.community_notes;
create trigger community_notes_updated_at
  before update on public.community_notes
  for each row execute function public.set_updated_at();

-- Self-service profile: cannot escalate role/branch/email without admin
create or replace function public.profiles_strip_privileged_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  adm boolean;
begin
  select exists(select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin') into adm;
  if auth.uid() = new.id and not coalesce(adm, false) then
    new.role := old.role;
    new.branch_id := old.branch_id;
    new.email := old.email;
    new.employee_id := old.employee_id;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_strip on public.profiles;
create trigger profiles_strip
  before update on public.profiles
  for each row execute function public.profiles_strip_privileged_fields();

-- ---------- RLS ----------
alter table public.branch_information enable row level security;
alter table public.profiles enable row level security;
alter table public.attendance_logs enable row level security;
alter table public.work_schedules enable row level security;
alter table public.tasks enable row level security;
alter table public.task_checklist_items enable row level security;
alter table public.task_attachments enable row level security;
alter table public.task_notifications enable row level security;
alter table public.attendance_chat_messages enable row level security;
alter table public.community_posts enable row level security;
alter table public.community_notes enable row level security;
alter table public.community_note_replies enable row level security;
alter table public.community_feed_posts enable row level security;
alter table public.community_feed_comments enable row level security;
alter table public.wellbeing_checkins enable row level security;
alter table public.app_settings enable row level security;

-- branch_information: อ่านได้ทุกคนที่ล็อกอิน; แก้ไขเฉพาะแอดมิน
drop policy if exists "branch_information_select_auth" on public.branch_information;
create policy "branch_information_select_auth" on public.branch_information
  for select to authenticated using (true);

drop policy if exists "branch_information_write_admin" on public.branch_information;
create policy "branch_information_write_admin" on public.branch_information
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- profiles
drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles
  for select to authenticated using (
    id = auth.uid()
    or role = 'employee'
    or public.is_admin()
    or (
      public.is_manager()
      and branch_id is not distinct from public.my_branch_id()
      and public.my_branch_id() is not null
    )
  );

drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self" on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

drop policy if exists "profiles_update_admin" on public.profiles;
create policy "profiles_update_admin" on public.profiles
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "profiles_update_manager_employees" on public.profiles;
create policy "profiles_update_manager_employees" on public.profiles
  for update to authenticated
  using (
    public.is_manager()
    and role = 'employee'
    and public.same_branch_as(id)
  )
  with check (
    public.is_manager()
    and role = 'employee'
    and public.same_branch_as(id)
  );

-- attendance_logs
drop policy if exists "attendance_insert_own" on public.attendance_logs;
create policy "attendance_insert_own" on public.attendance_logs
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "attendance_select" on public.attendance_logs;
create policy "attendance_select" on public.attendance_logs
  for select to authenticated using (
    user_id = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = attendance_logs.user_id and p.role = 'employee'
    )
    or public.is_admin()
    or (
      public.is_manager()
      and public.same_branch_as(user_id)
    )
  );

-- work_schedules
drop policy if exists "schedules_select" on public.work_schedules;
create policy "schedules_select" on public.work_schedules
  for select to authenticated using (
    user_id = auth.uid()
    or public.is_admin()
    or (
      public.is_manager()
      and public.same_branch_as(user_id)
    )
  );

drop policy if exists "schedules_write_manager_admin" on public.work_schedules;
create policy "schedules_write_manager_admin" on public.work_schedules
  for insert to authenticated
  with check (
    public.is_admin()
    or (
      public.is_manager()
      and public.same_branch_as(user_id)
    )
  );

drop policy if exists "schedules_update_manager_admin" on public.work_schedules;
create policy "schedules_update_manager_admin" on public.work_schedules
  for update to authenticated
  using (
    public.is_admin()
    or (
      public.is_manager()
      and public.same_branch_as(user_id)
    )
  )
  with check (
    public.is_admin()
    or (
      public.is_manager()
      and public.same_branch_as(user_id)
    )
  );

drop policy if exists "schedules_delete_manager_admin" on public.work_schedules;
create policy "schedules_delete_manager_admin" on public.work_schedules
  for delete to authenticated using (
    public.is_admin()
    or (
      public.is_manager()
      and public.same_branch_as(user_id)
    )
  );

-- tasks
drop policy if exists "tasks_select" on public.tasks;
create policy "tasks_select" on public.tasks
  for select to authenticated using (
    assigned_to = auth.uid()
    or assigned_by = auth.uid()
    or public.is_admin()
    or (
      public.is_manager()
      and public.same_branch_as(assigned_to)
    )
  );

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

drop policy if exists "tasks_update" on public.tasks;
create policy "tasks_update" on public.tasks
  for update to authenticated
  using (
    assigned_to = auth.uid()
    or assigned_by = auth.uid()
    or public.is_admin()
    or (
      public.is_manager()
      and public.same_branch_as(assigned_to)
    )
  )
  with check (
    assigned_to = auth.uid()
    or assigned_by = auth.uid()
    or public.is_admin()
    or (
      public.is_manager()
      and public.same_branch_as(assigned_to)
    )
  );

drop policy if exists "tasks_delete" on public.tasks;
create policy "tasks_delete" on public.tasks
  for delete to authenticated using (
    public.is_admin()
    or (
      public.is_manager()
      and public.same_branch_as(assigned_to)
    )
  );

-- task_checklist_items / task_attachments / task_notifications (รายละเอียดใน migration 20250406220000)
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

-- attendance chat
drop policy if exists "attendance_chat_select" on public.attendance_chat_messages;
create policy "attendance_chat_select" on public.attendance_chat_messages
  for select to authenticated using (true);

drop policy if exists "attendance_chat_insert" on public.attendance_chat_messages;
create policy "attendance_chat_insert" on public.attendance_chat_messages
  for insert to authenticated
  with check (user_id = auth.uid());

-- community
drop policy if exists "community_select" on public.community_posts;
create policy "community_select" on public.community_posts
  for select to authenticated using (true);

drop policy if exists "community_insert" on public.community_posts;
create policy "community_insert" on public.community_posts
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "community_delete" on public.community_posts;
create policy "community_delete" on public.community_posts
  for delete to authenticated using (user_id = auth.uid() or public.is_admin());

drop policy if exists "community_notes_select" on public.community_notes;
create policy "community_notes_select" on public.community_notes
  for select to authenticated using (true);

drop policy if exists "community_notes_insert_own" on public.community_notes;
create policy "community_notes_insert_own" on public.community_notes
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "community_notes_update_own" on public.community_notes;
create policy "community_notes_update_own" on public.community_notes
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "community_notes_delete_own_admin" on public.community_notes;
create policy "community_notes_delete_own_admin" on public.community_notes
  for delete to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists "community_note_replies_select" on public.community_note_replies;
create policy "community_note_replies_select" on public.community_note_replies
  for select to authenticated using (true);

drop policy if exists "community_note_replies_insert_own" on public.community_note_replies;
create policy "community_note_replies_insert_own" on public.community_note_replies
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "community_note_replies_delete_own_admin" on public.community_note_replies;
create policy "community_note_replies_delete_own_admin" on public.community_note_replies
  for delete to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists "community_feed_select" on public.community_feed_posts;
create policy "community_feed_select" on public.community_feed_posts
  for select to authenticated using (true);

drop policy if exists "community_feed_insert_own" on public.community_feed_posts;
create policy "community_feed_insert_own" on public.community_feed_posts
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "community_feed_delete_own_admin" on public.community_feed_posts;
create policy "community_feed_delete_own_admin" on public.community_feed_posts
  for delete to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists "community_feed_comments_select" on public.community_feed_comments;
create policy "community_feed_comments_select" on public.community_feed_comments
  for select to authenticated using (true);

drop policy if exists "community_feed_comments_insert_own" on public.community_feed_comments;
create policy "community_feed_comments_insert_own" on public.community_feed_comments
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "community_feed_comments_delete_own_admin" on public.community_feed_comments;
create policy "community_feed_comments_delete_own_admin" on public.community_feed_comments
  for delete to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- wellbeing (อารมณ์ตอนเข้า-ออกงาน)
drop policy if exists "wellbeing_insert_own" on public.wellbeing_checkins;
create policy "wellbeing_insert_own" on public.wellbeing_checkins
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "wellbeing_select_org" on public.wellbeing_checkins;
create policy "wellbeing_select_org" on public.wellbeing_checkins
  for select to authenticated
  using (true);

-- app_settings: admin เขียนได้ทุก key; ทุกคนที่ล็อกอินอ่าน key ที่ต้องใช้ในแอป
drop policy if exists "settings_all_admin" on public.app_settings;
create policy "settings_all_admin" on public.app_settings
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "settings_select_announcement_slides" on public.app_settings;
create policy "settings_select_announcement_slides" on public.app_settings
  for select to authenticated
  using (
    key in (
      'announcement_slides',
      'attendance_break_start_messages',
      'attendance_break_end_messages'
    )
  );

-- ---------- Realtime (optional; ข้ามถ้าตารางอยู่ใน publication แล้ว) ----------
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'attendance_chat_messages'
  ) then
    alter publication supabase_realtime add table public.attendance_chat_messages;
  end if;
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'community_posts'
  ) then
    alter publication supabase_realtime add table public.community_posts;
  end if;
end $$;

-- ---------- Seed สาขา (ถ้ายังไม่มีข้อมูลใน branch_information) ----------
insert into public.branch_information (
  id, branch_code, branch_name, address, latitude, longitude, phone_number, radius_meters
)
select
  1, 'HQ', 'สำนักงานใหญ่', null, 13.7563, 100.5018, null, 200
where not exists (select 1 from public.branch_information limit 1);

do $$
declare
  employee_has_id boolean;
begin
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'employee'
      and column_name = 'id'
  )
  into employee_has_id;

  if
    employee_has_id
    and not exists (
      select 1 from pg_constraint where conname = 'profiles_employee_id_fkey'
    )
  then
    alter table public.profiles
      add constraint profiles_employee_id_fkey
      foreign key (employee_id) references public.employee (id) on delete set null;
  end if;
end $$;

-- ---------- Storage: รูปโปรไฟล์ (avatars) ----------
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = excluded.public;

-- storage.objects มี RLS บน Supabase อยู่แล้ว; อย่า enable ซ้ำผ่าน migration role

drop policy if exists "avatars_public_read" on storage.objects;
create policy "avatars_public_read" on storage.objects
  for select using (bucket_id = 'avatars');

drop policy if exists "avatars_insert_own" on storage.objects;
create policy "avatars_insert_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername (name))[1] = auth.uid()::text
  );

drop policy if exists "avatars_update_own" on storage.objects;
create policy "avatars_update_own" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername (name))[1] = auth.uid()::text
  );

drop policy if exists "avatars_delete_own" on storage.objects;
create policy "avatars_delete_own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername (name))[1] = auth.uid()::text
  );

-- ---------- Storage: ไฟล์แนบงาน (task_files) ----------
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

-- ---------- Storage: ฟีดคอมมูนิตี้ (community_feed) ----------
insert into storage.buckets (id, name, public)
values ('community_feed', 'community_feed', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "community_feed_storage_read" on storage.objects;
create policy "community_feed_storage_read" on storage.objects
  for select using (bucket_id = 'community_feed');

drop policy if exists "community_feed_storage_insert" on storage.objects;
create policy "community_feed_storage_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'community_feed'
    and (storage.foldername (name))[1] = auth.uid()::text
  );

drop policy if exists "community_feed_storage_update" on storage.objects;
create policy "community_feed_storage_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'community_feed'
    and (storage.foldername (name))[1] = auth.uid()::text
  );

drop policy if exists "community_feed_storage_delete" on storage.objects;
create policy "community_feed_storage_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'community_feed'
    and (storage.foldername (name))[1] = auth.uid()::text
  );

-- ---------- Storage: สไลด์ประกาศบริษัท (announcement_slides) ----------
insert into storage.buckets (id, name, public)
values ('announcement_slides', 'announcement_slides', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "announcement_slides_public_read" on storage.objects;
create policy "announcement_slides_public_read" on storage.objects
  for select using (bucket_id = 'announcement_slides');

drop policy if exists "announcement_slides_admin_insert" on storage.objects;
create policy "announcement_slides_admin_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'announcement_slides'
    and public.is_admin()
  );

drop policy if exists "announcement_slides_admin_update" on storage.objects;
create policy "announcement_slides_admin_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'announcement_slides'
    and public.is_admin()
  )
  with check (
    bucket_id = 'announcement_slides'
    and public.is_admin()
  );

drop policy if exists "announcement_slides_admin_delete" on storage.objects;
create policy "announcement_slides_admin_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'announcement_slides'
    and public.is_admin()
  );

-- แอดมินแก้พนักงาน/รหัส legacy ในแอป: mobile/components/AdminEmployeeEditModal.tsx
-- ตาราง employee + RPC admin_list_employee_passwords + trigger employee_preserve_password
-- (รวมอยู่ในสคริปต์ผสาน employee แยกต่างหากถ้าใช้ตาราง employee)
--
-- เพิ่ม employee.id uuid + เชื่อม profiles.employee_id จาก UserID/อีเมล: migrations/20250406180000_employee_uuid_pk_link_profiles.sql
-- View employee_directory (แมปคอลัมน์ + security_invoker): migrations/20250406190000_employee_directory_view.sql
-- RLS employee_select_self รวมจับคู่ UserID กับอีเมล JWT: migrations/20250406200000_employee_select_self_by_email.sql
