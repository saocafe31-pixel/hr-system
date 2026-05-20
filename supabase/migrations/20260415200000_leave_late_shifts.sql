-- ลา / ขอเข้าสาย / กะงาน (template) / มอบหมายกะรายวัน + โควตาวันลาพักร้อน

-- ---------- leave_requests ----------
create table if not exists public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  leave_type text not null check (leave_type in ('sick', 'personal', 'vacation')),
  starts_on date not null,
  ends_on date not null,
  reason text,
  medical_certificate_url text,
  supplementary_note text,
  supplementary_document_url text,
  status text not null default 'approved'
    check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  constraint leave_requests_date_order check (starts_on <= ends_on)
);

create index if not exists leave_requests_user_starts_idx
  on public.leave_requests (user_id, starts_on);

alter table public.leave_requests enable row level security;

drop policy if exists "leave_insert_own" on public.leave_requests;
create policy "leave_insert_own" on public.leave_requests
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "leave_select_own_or_admin" on public.leave_requests;
create policy "leave_select_own_or_admin" on public.leave_requests
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists "leave_update_admin" on public.leave_requests;
create policy "leave_update_admin" on public.leave_requests
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------- vacation_grants (โควตาพักร้อนตามปี) ----------
create table if not exists public.vacation_grants (
  user_id uuid not null references public.profiles(id) on delete cascade,
  year int not null check (year >= 2000 and year <= 2100),
  days_granted numeric(8, 2) not null default 0 check (days_granted >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  primary key (user_id, year)
);

alter table public.vacation_grants enable row level security;

drop policy if exists "vacation_grants_select" on public.vacation_grants;
create policy "vacation_grants_select" on public.vacation_grants
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists "vacation_grants_write_admin" on public.vacation_grants;
create policy "vacation_grants_write_admin" on public.vacation_grants
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------- late_requests ----------
create table if not exists public.late_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  work_date date not null,
  minutes_late int not null check (minutes_late >= 1 and minutes_late <= 30),
  note text,
  created_at timestamptz not null default now()
);

create index if not exists late_requests_user_created_idx
  on public.late_requests (user_id, created_at desc);

alter table public.late_requests enable row level security;

drop policy if exists "late_insert_own" on public.late_requests;
create policy "late_insert_own" on public.late_requests
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "late_select_own_or_admin" on public.late_requests;
create policy "late_select_own_or_admin" on public.late_requests
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- ---------- work_shifts (เทมเพลตเวลา) ----------
create table if not exists public.work_shifts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  start_time time not null,
  end_time time not null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.work_shifts enable row level security;

drop policy if exists "work_shifts_select_auth" on public.work_shifts;
create policy "work_shifts_select_auth" on public.work_shifts
  for select to authenticated
  using (true);

drop policy if exists "work_shifts_write_mgr_admin" on public.work_shifts;
create policy "work_shifts_write_mgr_admin" on public.work_shifts
  for all to authenticated
  using (public.is_manager() or public.is_admin())
  with check (public.is_manager() or public.is_admin());

-- ---------- work_schedule_assignments (พนักงาน + วันที่ + กะ) ----------
create table if not exists public.work_schedule_assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  work_date date not null,
  shift_id uuid not null references public.work_shifts(id) on delete restrict,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (user_id, work_date)
);

create index if not exists work_schedule_assignments_date_idx
  on public.work_schedule_assignments (work_date);

alter table public.work_schedule_assignments enable row level security;

drop policy if exists "wsa_select_own_or_mgr" on public.work_schedule_assignments;
create policy "wsa_select_own_or_mgr" on public.work_schedule_assignments
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_manager()
    or public.is_admin()
  );

drop policy if exists "wsa_write_mgr_admin" on public.work_schedule_assignments;
create policy "wsa_write_mgr_admin" on public.work_schedule_assignments
  for all to authenticated
  using (public.is_manager() or public.is_admin())
  with check (public.is_manager() or public.is_admin());

-- ---------- Storage: เอกสารแนบลา ----------
insert into storage.buckets (id, name, public)
values ('leave_attachments', 'leave_attachments', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "leave_attach_public_read" on storage.objects;
create policy "leave_attach_public_read" on storage.objects
  for select using (bucket_id = 'leave_attachments');

drop policy if exists "leave_attach_insert_own" on storage.objects;
create policy "leave_attach_insert_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'leave_attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "leave_attach_update_own" on storage.objects;
create policy "leave_attach_update_own" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'leave_attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'leave_attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "leave_attach_delete_own" on storage.objects;
create policy "leave_attach_delete_own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'leave_attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
