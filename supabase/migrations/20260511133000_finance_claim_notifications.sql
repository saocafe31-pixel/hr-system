create table if not exists public.finance_claim_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  claim_kind text not null check (claim_kind in ('salary', 'expense')),
  claim_id uuid not null,
  event_type text not null check (event_type in ('submitted', 'status_updated')),
  status text check (status in ('pending', 'approved', 'rejected', 'paid')),
  body text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists finance_claim_notifications_recipient_idx
  on public.finance_claim_notifications (recipient_id, created_at desc);
create index if not exists finance_claim_notifications_unread_idx
  on public.finance_claim_notifications (recipient_id, read_at, created_at desc);

alter table public.finance_claim_notifications enable row level security;

drop policy if exists "finance_claim_notifications_select_recipient" on public.finance_claim_notifications;
create policy "finance_claim_notifications_select_recipient" on public.finance_claim_notifications
  for select using (auth.uid() = recipient_id);

drop policy if exists "finance_claim_notifications_insert_actor" on public.finance_claim_notifications;
create policy "finance_claim_notifications_insert_actor" on public.finance_claim_notifications
  for insert with check (auth.uid() = actor_id);

drop policy if exists "finance_claim_notifications_update_recipient" on public.finance_claim_notifications;
create policy "finance_claim_notifications_update_recipient" on public.finance_claim_notifications
  for update using (auth.uid() = recipient_id)
  with check (auth.uid() = recipient_id);
