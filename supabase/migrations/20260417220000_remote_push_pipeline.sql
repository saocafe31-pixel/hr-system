-- Remote push pipeline: queue + trigger producers + claim/finalize RPC for Edge Function worker

create table if not exists public.push_notification_jobs (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  channel text not null check (
    channel in ('task', 'mention', 'community_post_comment', 'community_note_reply')
  ),
  title text not null,
  body text not null,
  data jsonb not null default '{}'::jsonb,
  source_table text,
  source_id uuid,
  status text not null default 'queued' check (
    status in ('queued', 'processing', 'sent', 'retry', 'failed')
  ),
  attempt_count integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  processing_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists push_jobs_status_next_idx
  on public.push_notification_jobs (status, next_attempt_at, created_at);

create index if not exists push_jobs_recipient_created_idx
  on public.push_notification_jobs (recipient_id, created_at desc);

alter table public.push_notification_jobs enable row level security;

drop policy if exists "push_jobs_deny_all_select" on public.push_notification_jobs;
create policy "push_jobs_deny_all_select" on public.push_notification_jobs
  for select to authenticated
  using (false);

drop policy if exists "push_jobs_deny_all_insert" on public.push_notification_jobs;
create policy "push_jobs_deny_all_insert" on public.push_notification_jobs
  for insert to authenticated
  with check (false);

drop policy if exists "push_jobs_deny_all_update" on public.push_notification_jobs;
create policy "push_jobs_deny_all_update" on public.push_notification_jobs
  for update to authenticated
  using (false)
  with check (false);

create or replace function public.enqueue_push_notification_job(
  p_recipient_id uuid,
  p_channel text,
  p_title text,
  p_body text,
  p_data jsonb default '{}'::jsonb,
  p_source_table text default null,
  p_source_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text;
begin
  if p_recipient_id is null then
    return;
  end if;
  if coalesce(trim(p_title), '') = '' or coalesce(trim(p_body), '') = '' then
    return;
  end if;

  select nullif(trim(expo_push_token), '')
  into v_token
  from public.profiles
  where id = p_recipient_id;

  if v_token is null then
    return;
  end if;

  insert into public.push_notification_jobs (
    recipient_id,
    channel,
    title,
    body,
    data,
    source_table,
    source_id
  )
  values (
    p_recipient_id,
    p_channel,
    p_title,
    p_body,
    coalesce(p_data, '{}'::jsonb),
    p_source_table,
    p_source_id
  );
end;
$$;

create or replace function public.claim_push_notification_jobs(
  p_limit integer default 50
)
returns table (
  id uuid,
  expo_push_token text,
  title text,
  body text,
  data jsonb,
  channel text,
  attempt_count integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with to_claim as (
    select j.id
    from public.push_notification_jobs j
    where j.status in ('queued', 'retry')
      and j.next_attempt_at <= now()
    order by j.created_at asc
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 50), 200))
  ),
  claimed as (
    update public.push_notification_jobs j
    set
      status = 'processing',
      processing_at = now(),
      attempt_count = j.attempt_count + 1
    where j.id in (select id from to_claim)
    returning j.id, j.recipient_id, j.title, j.body, j.data, j.channel, j.attempt_count
  )
  select
    c.id,
    p.expo_push_token,
    c.title,
    c.body,
    c.data,
    c.channel,
    c.attempt_count
  from claimed c
  join public.profiles p on p.id = c.recipient_id
  where nullif(trim(p.expo_push_token), '') is not null;
end;
$$;

create or replace function public.finalize_push_notification_job(
  p_id uuid,
  p_ok boolean,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_ok then
    update public.push_notification_jobs
    set
      status = 'sent',
      sent_at = now(),
      last_error = null
    where id = p_id;
    return;
  end if;

  update public.push_notification_jobs
  set
    status = case when attempt_count >= 5 then 'failed' else 'retry' end,
    next_attempt_at = now() + (interval '1 minute' * least(30, greatest(1, attempt_count * 2))),
    last_error = left(coalesce(p_error, 'push_failed'), 1000)
  where id = p_id;
end;
$$;

create or replace function public.enqueue_push_on_task_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.enqueue_push_notification_job(
    new.recipient_id,
    'task',
    'งาน',
    coalesce(new.body, 'มีการแจ้งเตือนงาน'),
    jsonb_build_object('task_id', new.task_id, 'notification_id', new.id),
    'task_notifications',
    new.id
  );
  return new;
end;
$$;

create or replace function public.enqueue_push_on_chat_mention()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.enqueue_push_notification_job(
    new.recipient_id,
    'mention',
    'กล่าวถึงคุณ',
    coalesce(new.body, 'มีคนกล่าวถึงคุณในแชท'),
    jsonb_build_object('message_id', new.message_id, 'mention_id', new.id),
    'attendance_chat_mention_notifications',
    new.id
  );
  return new;
end;
$$;

create or replace function public.enqueue_push_on_post_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  select p.user_id into v_owner
  from public.community_feed_posts p
  where p.id = new.post_id;

  if v_owner is not null and v_owner <> new.user_id then
    perform public.enqueue_push_notification_job(
      v_owner,
      'community_post_comment',
      'คอมมูนิตี้',
      'มีคนตอบโพสต์ของคุณ',
      jsonb_build_object('post_id', new.post_id, 'comment_id', new.id),
      'community_feed_comments',
      new.id
    );
  end if;
  return new;
end;
$$;

create or replace function public.enqueue_push_on_note_reply()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  select n.user_id into v_owner
  from public.community_notes n
  where n.id = new.note_id;

  if v_owner is not null and v_owner <> new.user_id then
    perform public.enqueue_push_notification_job(
      v_owner,
      'community_note_reply',
      'คอมมูนิตี้',
      'มีคนตอบโน้ตของคุณ',
      jsonb_build_object('note_id', new.note_id, 'reply_id', new.id),
      'community_note_replies',
      new.id
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_push_task_notifications on public.task_notifications;
create trigger trg_push_task_notifications
after insert on public.task_notifications
for each row execute function public.enqueue_push_on_task_notification();

drop trigger if exists trg_push_chat_mentions on public.attendance_chat_mention_notifications;
create trigger trg_push_chat_mentions
after insert on public.attendance_chat_mention_notifications
for each row execute function public.enqueue_push_on_chat_mention();

drop trigger if exists trg_push_post_comments on public.community_feed_comments;
create trigger trg_push_post_comments
after insert on public.community_feed_comments
for each row execute function public.enqueue_push_on_post_comment();

drop trigger if exists trg_push_note_replies on public.community_note_replies;
create trigger trg_push_note_replies
after insert on public.community_note_replies
for each row execute function public.enqueue_push_on_note_reply();
