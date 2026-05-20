-- ฟีดคอมมูนิตี้: วิดีโอ, อัตราส่วนรูป, ถูกใจ, ลบอัตโนมัติ 30 วัน (ตามตั้งค่าโปรไฟล์)

create extension if not exists pg_cron with schema extensions;

alter table public.community_feed_posts
  add column if not exists media_type text not null default 'image';

alter table public.community_feed_posts
  drop constraint if exists community_feed_posts_media_type_check;

alter table public.community_feed_posts
  add constraint community_feed_posts_media_type_check
  check (media_type in ('image', 'video'));

alter table public.community_feed_posts
  add column if not exists image_layout text null;

alter table public.community_feed_posts
  drop constraint if exists community_feed_posts_image_layout_check;

alter table public.community_feed_posts
  add constraint community_feed_posts_image_layout_check
  check (
    image_layout is null
    or image_layout in ('square', 'portrait', 'landscape')
  );

update public.community_feed_posts
set image_layout = 'landscape'
where image_layout is null
  and media_type = 'image';

alter table public.profiles
  add column if not exists community_feed_auto_delete_enabled boolean not null default false;

comment on column public.profiles.community_feed_auto_delete_enabled is
  'ถ้าเปิด ระบบจะลบโพสต์ฟีดของผู้ใช้ที่เกิน 30 วัน (cron รายวัน) — ค่าเริ่มต้นปิดเพื่อไม่ลบย้อนหลังโดยไม่ตั้งใจ';

-- ---------- likes ----------
create table if not exists public.community_feed_likes (
  post_id uuid not null references public.community_feed_posts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create index if not exists community_feed_likes_post_idx
  on public.community_feed_likes (post_id);

create index if not exists community_feed_likes_user_idx
  on public.community_feed_likes (user_id);

alter table public.community_feed_likes enable row level security;

drop policy if exists "community_feed_likes_select" on public.community_feed_likes;
create policy "community_feed_likes_select" on public.community_feed_likes
  for select to authenticated using (true);

drop policy if exists "community_feed_likes_insert_own" on public.community_feed_likes;
create policy "community_feed_likes_insert_own" on public.community_feed_likes
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "community_feed_likes_delete_own" on public.community_feed_likes;
create policy "community_feed_likes_delete_own" on public.community_feed_likes
  for delete to authenticated
  using (user_id = auth.uid());

-- ---------- cleanup (โพสต์ + ไฟล์ใน storage ถ้าแยก path จาก URL ได้) ----------
create or replace function public.cleanup_expired_community_feed_posts()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_posts integer := 0;
  r record;
  v_name text;
begin
  for r in
    select p.id, p.image_url
    from public.community_feed_posts p
    join public.profiles prof on prof.id = p.user_id
    where coalesce(prof.community_feed_auto_delete_enabled, false) = true
      and p.created_at < now() - interval '30 days'
  loop
    v_name := substring(r.image_url from 'community_feed/(.+)$');
    if v_name is not null and v_name <> '' and position('/' in v_name) > 0 then
      delete from storage.objects o
      where o.bucket_id = 'community_feed'
        and o.name = v_name;
    end if;

    delete from public.community_feed_posts where id = r.id;
    deleted_posts := deleted_posts + 1;
  end loop;

  return deleted_posts;
end;
$$;

comment on function public.cleanup_expired_community_feed_posts() is
  'ลบโพสต์ฟีดเกิน 30 วันเมื่อผู้โพสต์เปิด community_feed_auto_delete_enabled';

revoke all on function public.cleanup_expired_community_feed_posts() from public;
grant execute on function public.cleanup_expired_community_feed_posts() to service_role;

do $$
declare
  v_job_id bigint;
begin
  select jobid
  into v_job_id
  from cron.job
  where jobname = 'daily_cleanup_community_feed_posts'
  limit 1;

  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;

  perform cron.schedule(
    'daily_cleanup_community_feed_posts',
    '20 17 * * *',
    $cron$select public.cleanup_expired_community_feed_posts();$cron$
  );
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'community_feed_likes'
  ) then
    alter publication supabase_realtime add table public.community_feed_likes;
  end if;
end;
$$;
