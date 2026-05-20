create table if not exists public.attendance_calendar_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  work_date date not null,
  note text,
  checklist jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, work_date)
);

create index if not exists attendance_calendar_notes_user_date_idx
  on public.attendance_calendar_notes (user_id, work_date desc);

alter table public.attendance_calendar_notes enable row level security;

drop policy if exists "attendance_calendar_notes_select_own" on public.attendance_calendar_notes;
create policy "attendance_calendar_notes_select_own" on public.attendance_calendar_notes
  for select using (auth.uid() = user_id);

drop policy if exists "attendance_calendar_notes_insert_own" on public.attendance_calendar_notes;
create policy "attendance_calendar_notes_insert_own" on public.attendance_calendar_notes
  for insert with check (auth.uid() = user_id);

drop policy if exists "attendance_calendar_notes_update_own" on public.attendance_calendar_notes;
create policy "attendance_calendar_notes_update_own" on public.attendance_calendar_notes
  for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "attendance_calendar_notes_delete_own" on public.attendance_calendar_notes;
create policy "attendance_calendar_notes_delete_own" on public.attendance_calendar_notes
  for delete using (auth.uid() = user_id);
