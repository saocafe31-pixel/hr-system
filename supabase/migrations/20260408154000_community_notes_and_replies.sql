create table if not exists public.community_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles (id) on delete cascade,
  body text not null check (char_length(body) <= 50),
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

drop trigger if exists community_notes_updated_at on public.community_notes;
create trigger community_notes_updated_at
  before update on public.community_notes
  for each row execute function public.set_updated_at();

alter table public.community_notes enable row level security;
alter table public.community_note_replies enable row level security;

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

