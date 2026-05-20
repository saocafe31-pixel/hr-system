-- แจ้งเตือนเมื่อมีคน @ กล่าวถึงในแชทเข้า-ออก
create table if not exists public.attendance_chat_mention_notifications (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.attendance_chat_messages (id) on delete cascade,
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  body text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists attendance_chat_mention_notifications_recipient_created_idx
  on public.attendance_chat_mention_notifications (recipient_id, created_at desc);

alter table public.attendance_chat_mention_notifications enable row level security;

drop policy if exists "attendance_chat_mention_notifications_select" on public.attendance_chat_mention_notifications;
create policy "attendance_chat_mention_notifications_select" on public.attendance_chat_mention_notifications
  for select to authenticated
  using (recipient_id = auth.uid());

drop policy if exists "attendance_chat_mention_notifications_insert" on public.attendance_chat_mention_notifications;
create policy "attendance_chat_mention_notifications_insert" on public.attendance_chat_mention_notifications
  for insert to authenticated
  with check (
    exists (
      select 1
      from public.attendance_chat_messages m
      where m.id = message_id
        and m.user_id = auth.uid()
    )
    and recipient_id <> auth.uid()
  );

drop policy if exists "attendance_chat_mention_notifications_update" on public.attendance_chat_mention_notifications;
create policy "attendance_chat_mention_notifications_update" on public.attendance_chat_mention_notifications
  for update to authenticated
  using (recipient_id = auth.uid())
  with check (recipient_id = auth.uid());

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'attendance_chat_mention_notifications'
  ) then
    alter publication supabase_realtime add table public.attendance_chat_mention_notifications;
  end if;
end $$;
