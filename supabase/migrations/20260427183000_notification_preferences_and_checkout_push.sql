-- User-level notification toggles + checkout reminder push channel

create table if not exists public.notification_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  task_enabled boolean not null default true,
  mention_enabled boolean not null default true,
  checkout_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.notification_preferences enable row level security;

drop policy if exists "notification_preferences_select_own" on public.notification_preferences;
create policy "notification_preferences_select_own" on public.notification_preferences
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists "notification_preferences_insert_own" on public.notification_preferences;
create policy "notification_preferences_insert_own" on public.notification_preferences
  for insert to authenticated
  with check (user_id = auth.uid() or public.is_admin());

drop policy if exists "notification_preferences_update_own" on public.notification_preferences;
create policy "notification_preferences_update_own" on public.notification_preferences
  for update to authenticated
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

drop policy if exists "notification_preferences_delete_own" on public.notification_preferences;
create policy "notification_preferences_delete_own" on public.notification_preferences
  for delete to authenticated
  using (user_id = auth.uid() or public.is_admin());

create or replace function public.notification_preferences_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists notification_preferences_updated_at on public.notification_preferences;
create trigger notification_preferences_updated_at
  before update on public.notification_preferences
  for each row execute function public.notification_preferences_set_updated_at();

-- Backfill default preferences for existing profiles.
insert into public.notification_preferences (user_id)
select p.id
from public.profiles p
on conflict (user_id) do nothing;

-- Extend push channel enum-like checks
alter table public.push_notification_jobs
  drop constraint if exists push_notification_jobs_channel_check;
alter table public.push_notification_jobs
  add constraint push_notification_jobs_channel_check
  check (channel in ('task', 'mention', 'community_post_comment', 'community_note_reply', 'checkout_reminder'));

alter table public.web_push_notification_jobs
  drop constraint if exists web_push_notification_jobs_channel_check;
alter table public.web_push_notification_jobs
  add constraint web_push_notification_jobs_channel_check
  check (channel in ('task', 'mention', 'community_post_comment', 'community_note_reply', 'checkout_reminder'));

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
  v_task_enabled boolean := true;
  v_mention_enabled boolean := true;
  v_checkout_enabled boolean := true;
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

  select
    coalesce(np.task_enabled, true),
    coalesce(np.mention_enabled, true),
    coalesce(np.checkout_enabled, true)
  into v_task_enabled, v_mention_enabled, v_checkout_enabled
  from public.notification_preferences np
  where np.user_id = p_recipient_id;

  if p_channel = 'task' and not v_task_enabled then
    return;
  end if;
  if p_channel = 'mention' and not v_mention_enabled then
    return;
  end if;
  if p_channel = 'checkout_reminder' and not v_checkout_enabled then
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

create or replace function public.enqueue_web_push_notification_job(
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
  v_task_enabled boolean := true;
  v_mention_enabled boolean := true;
  v_checkout_enabled boolean := true;
begin
  if p_recipient_id is null then
    return;
  end if;
  if coalesce(trim(p_title), '') = '' or coalesce(trim(p_body), '') = '' then
    return;
  end if;

  if not exists (
    select 1 from public.web_push_subscriptions s where s.user_id = p_recipient_id
  ) then
    return;
  end if;

  select
    coalesce(np.task_enabled, true),
    coalesce(np.mention_enabled, true),
    coalesce(np.checkout_enabled, true)
  into v_task_enabled, v_mention_enabled, v_checkout_enabled
  from public.notification_preferences np
  where np.user_id = p_recipient_id;

  if p_channel = 'task' and not v_task_enabled then
    return;
  end if;
  if p_channel = 'mention' and not v_mention_enabled then
    return;
  end if;
  if p_channel = 'checkout_reminder' and not v_checkout_enabled then
    return;
  end if;

  insert into public.web_push_notification_jobs (
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

create or replace function public.enqueue_push_on_overtime_prompt()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'pending' then
    perform public.enqueue_push_notification_job(
      new.user_id,
      'checkout_reminder',
      'แจ้งออกงาน',
      'เลยเวลาออกงานแล้ว กรุณายืนยันว่าจะทำ OT หรือออกงาน',
      jsonb_build_object('overtime_request_id', new.id, 'work_date', new.work_date),
      'attendance_overtime_requests',
      new.id
    );
  end if;
  return new;
end;
$$;

create or replace function public.enqueue_web_push_on_overtime_prompt()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'pending' then
    perform public.enqueue_web_push_notification_job(
      new.user_id,
      'checkout_reminder',
      'แจ้งออกงาน',
      'เลยเวลาออกงานแล้ว กรุณายืนยันว่าจะทำ OT หรือออกงาน',
      jsonb_build_object('overtime_request_id', new.id, 'work_date', new.work_date),
      'attendance_overtime_requests',
      new.id
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_push_overtime_prompt on public.attendance_overtime_requests;
create trigger trg_push_overtime_prompt
after insert on public.attendance_overtime_requests
for each row execute function public.enqueue_push_on_overtime_prompt();

drop trigger if exists trg_web_push_overtime_prompt on public.attendance_overtime_requests;
create trigger trg_web_push_overtime_prompt
after insert on public.attendance_overtime_requests
for each row execute function public.enqueue_web_push_on_overtime_prompt();
