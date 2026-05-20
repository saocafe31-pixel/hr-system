-- คอมเมนต์ใต้โพสต์ฟีดคอมมูนิตี้
create table if not exists public.community_feed_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.community_feed_posts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(body) <= 500),
  created_at timestamptz not null default now()
);

create index if not exists community_feed_comments_post_created_idx
  on public.community_feed_comments (post_id, created_at asc);

alter table public.community_feed_comments enable row level security;

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
