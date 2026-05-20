-- ตอบกลับคอมเมนต์ในฟีด: parent_id ชี้คอมเมนต์แม่ (null = คอมเมนต์ระดับบนสุด)

alter table public.community_feed_comments
  add column if not exists parent_id uuid references public.community_feed_comments (id) on delete cascade;

create index if not exists community_feed_comments_parent_idx
  on public.community_feed_comments (parent_id)
  where parent_id is not null;

create or replace function public.community_feed_comment_parent_same_post()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.parent_id is null then
    return new;
  end if;
  if not exists (
    select 1
    from public.community_feed_comments p
    where p.id = new.parent_id
      and p.post_id = new.post_id
  ) then
    raise exception 'parent comment must belong to the same post';
  end if;
  return new;
end;
$$;

drop trigger if exists community_feed_comment_parent_check on public.community_feed_comments;
create trigger community_feed_comment_parent_check
  before insert or update of parent_id, post_id on public.community_feed_comments
  for each row
  execute function public.community_feed_comment_parent_same_post();
