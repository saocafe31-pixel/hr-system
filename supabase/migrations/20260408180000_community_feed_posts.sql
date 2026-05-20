-- ฟีดคอมมูนิตี้: โพสต์รูป + แคปชัน
create table if not exists public.community_feed_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  image_url text not null,
  caption text,
  created_at timestamptz not null default now()
);

create index if not exists community_feed_posts_created_idx
  on public.community_feed_posts (created_at desc);

alter table public.community_feed_posts enable row level security;

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

-- Storage: community_feed (โฟลเดอร์แรก = user id)
insert into storage.buckets (id, name, public)
values ('community_feed', 'community_feed', true)
on conflict (id) do nothing;

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
