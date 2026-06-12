-- Add manager/admin approval for accepted overtime and status notifications in the bell.

alter table public.attendance_overtime_requests
  add column if not exists approval_status text not null default 'pending'
    check (approval_status in ('pending', 'approved', 'rejected')),
  add column if not exists approved_by uuid references public.profiles(id) on delete set null,
  add column if not exists approved_at timestamptz,
  add column if not exists approval_note text;

create index if not exists attendance_overtime_requests_approval_idx
  on public.attendance_overtime_requests (approval_status, work_date desc);

drop policy if exists "attendance_overtime_select" on public.attendance_overtime_requests;
create policy "attendance_overtime_select" on public.attendance_overtime_requests
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_admin()
    or (
      public.is_manager()
      and public.is_direct_report_of_me(user_id)
    )
  );

create table if not exists public.status_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  event_type text not null check (event_type in ('leave_status', 'overtime_status')),
  entity_kind text not null check (entity_kind in ('leave', 'overtime')),
  entity_id uuid not null,
  status text not null,
  body text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists status_notifications_recipient_idx
  on public.status_notifications (recipient_id, created_at desc);
create index if not exists status_notifications_unread_idx
  on public.status_notifications (recipient_id, read_at, created_at desc);

alter table public.status_notifications enable row level security;

drop policy if exists "status_notifications_select_recipient" on public.status_notifications;
create policy "status_notifications_select_recipient" on public.status_notifications
  for select to authenticated
  using (auth.uid() = recipient_id);

drop policy if exists "status_notifications_update_recipient" on public.status_notifications;
create policy "status_notifications_update_recipient" on public.status_notifications
  for update to authenticated
  using (auth.uid() = recipient_id)
  with check (auth.uid() = recipient_id);

drop policy if exists "status_notifications_insert_actor" on public.status_notifications;
create policy "status_notifications_insert_actor" on public.status_notifications
  for insert to authenticated
  with check (auth.uid() = actor_id);

create or replace function public.notify_status_update(
  p_recipient_id uuid,
  p_actor_id uuid,
  p_event_type text,
  p_entity_kind text,
  p_entity_id uuid,
  p_status text,
  p_body text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_recipient_id is null then
    return;
  end if;

  insert into public.status_notifications (
    recipient_id,
    actor_id,
    event_type,
    entity_kind,
    entity_id,
    status,
    body
  )
  values (
    p_recipient_id,
    p_actor_id,
    p_event_type,
    p_entity_kind,
    p_entity_id,
    p_status,
    p_body
  );
end;
$$;

revoke all on function public.notify_status_update(uuid, uuid, text, text, uuid, text, text) from public;

create or replace function public.respond_overtime_approval(
  p_request_id uuid,
  p_approve boolean,
  p_note text default null
)
returns public.attendance_overtime_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  req public.attendance_overtime_requests%rowtype;
  v_actor uuid := auth.uid();
  v_status text := case when p_approve then 'approved' else 'rejected' end;
  v_body text;
begin
  if v_actor is null then
    raise exception 'unauthorized';
  end if;

  select *
  into req
  from public.attendance_overtime_requests
  where id = p_request_id
  limit 1;

  if req.id is null then
    raise exception 'request_not_found';
  end if;

  if not (
    public.is_admin()
    or (public.is_manager() and public.is_direct_report_of_me(req.user_id))
  ) then
    raise exception 'forbidden';
  end if;

  if req.status <> 'accepted' then
    raise exception 'overtime_not_accepted';
  end if;

  update public.attendance_overtime_requests
  set
    approval_status = v_status,
    approved_by = v_actor,
    approved_at = now(),
    approval_note = nullif(trim(coalesce(p_note, '')), '')
  where id = req.id
  returning * into req;

  v_body := 'คำขอ OT วันที่ ' || req.work_date::text || ' ถูก'
    || case when p_approve then 'อนุมัติแล้ว' else 'ปฏิเสธแล้ว' end;

  perform public.notify_status_update(
    req.user_id,
    v_actor,
    'overtime_status',
    'overtime',
    req.id,
    v_status,
    v_body
  );

  return req;
end;
$$;

revoke all on function public.respond_overtime_approval(uuid, boolean, text) from public;
grant execute on function public.respond_overtime_approval(uuid, boolean, text) to authenticated;

create or replace function public.respond_leave_request(
  p_leave_id uuid,
  p_approve boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
  v_sub uuid;
  v_actor uuid := auth.uid();
  v_status text := case when p_approve then 'approved' else 'rejected' end;
begin
  if public.is_admin() then
    null;
  elsif public.is_manager() then
    if not exists (
      select 1 from public.manager_scopes s
      where s.manager_id = auth.uid() and s.can_approve_leave
    ) then
      return jsonb_build_object('ok', false, 'error', 'forbidden');
    end if;
    select lr.user_id into v_sub
    from public.leave_requests lr
    where lr.id = p_leave_id;
    if v_sub is null then
      return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    if not public.is_direct_report_of_me(v_sub) then
      return jsonb_build_object('ok', false, 'error', 'forbidden');
    end if;
  else
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  update public.leave_requests
  set status = v_status
  where id = p_leave_id
    and status = 'pending'
  returning user_id into v_sub;

  get diagnostics n = row_count;
  if n < 1 then
    return jsonb_build_object('ok', false, 'error', 'not_pending_or_missing');
  end if;

  perform public.notify_status_update(
    v_sub,
    v_actor,
    'leave_status',
    'leave',
    p_leave_id,
    v_status,
    'คำขอลาของคุณถูก' || case when p_approve then 'อนุมัติแล้ว' else 'ปฏิเสธแล้ว' end
  );

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.respond_leave_request(uuid, boolean) from public;
grant execute on function public.respond_leave_request(uuid, boolean) to authenticated;

create or replace function public.app_badge_notif_snapshot(
  p_chat_seen timestamptz default null,
  p_community_seen timestamptz default null,
  p_limit integer default 40
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_chat_seen timestamptz := coalesce(p_chat_seen, now());
  v_community_seen timestamptz := coalesce(p_community_seen, now());
  v_limit integer := greatest(coalesce(p_limit, 40), 1);
  v_chat_count integer := 0;
  v_community_count integer := 0;
  v_task_unread integer := 0;
  v_mention_unread integer := 0;
  v_finance_unread integer := 0;
  v_status_unread integer := 0;
  v_notifications jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;

  select count(*)::int
  into v_chat_count
  from public.attendance_chat_messages m
  where m.created_at > v_chat_seen;

  select count(*)::int
  into v_task_unread
  from public.task_notifications n
  where n.recipient_id = v_uid
    and n.read_at is null;

  select count(*)::int
  into v_mention_unread
  from public.attendance_chat_mention_notifications n
  where n.recipient_id = v_uid
    and n.read_at is null;

  select count(*)::int
  into v_finance_unread
  from public.finance_claim_notifications n
  where n.recipient_id = v_uid
    and n.read_at is null;

  select count(*)::int
  into v_status_unread
  from public.status_notifications n
  where n.recipient_id = v_uid
    and n.read_at is null;

  select (
    coalesce((select count(*) from public.community_feed_posts p where p.user_id <> v_uid and p.created_at > v_community_seen), 0)
    + coalesce((select count(*) from public.community_feed_comments c where c.user_id <> v_uid and c.created_at > v_community_seen), 0)
    + coalesce((select count(*) from public.community_notes n where n.user_id <> v_uid and n.updated_at > v_community_seen), 0)
    + coalesce((select count(*) from public.community_note_replies r where r.user_id <> v_uid and r.created_at > v_community_seen), 0)
    + coalesce((select count(*) from public.leave_requests l where l.user_id <> v_uid and l.created_at > v_community_seen), 0)
  )::int
  into v_community_count;

  with my_posts as (
    select id from public.community_feed_posts where user_id = v_uid limit 500
  ),
  my_notes as (
    select id from public.community_notes where user_id = v_uid limit 500
  ),
  notif_union as (
    select
      'task'::text as kind,
      n.id,
      n.body,
      n.created_at,
      n.read_at,
      n.task_id,
      null::uuid as message_id,
      null::text as claim_kind,
      null::uuid as claim_id,
      null::text as event_type,
      null::text as status,
      null::text as entity_kind,
      null::uuid as entity_id
    from public.task_notifications n
    where n.recipient_id = v_uid

    union all

    select
      'mention'::text as kind,
      n.id,
      n.body,
      n.created_at,
      n.read_at,
      null::uuid as task_id,
      n.message_id,
      null::text as claim_kind,
      null::uuid as claim_id,
      null::text as event_type,
      null::text as status,
      null::text as entity_kind,
      null::uuid as entity_id
    from public.attendance_chat_mention_notifications n
    where n.recipient_id = v_uid

    union all

    select
      'finance'::text as kind,
      n.id,
      n.body,
      n.created_at,
      n.read_at,
      null::uuid as task_id,
      null::uuid as message_id,
      n.claim_kind,
      n.claim_id,
      n.event_type,
      n.status,
      null::text as entity_kind,
      null::uuid as entity_id
    from public.finance_claim_notifications n
    where n.recipient_id = v_uid

    union all

    select
      'status'::text as kind,
      n.id,
      n.body,
      n.created_at,
      n.read_at,
      null::uuid as task_id,
      null::uuid as message_id,
      null::text as claim_kind,
      null::uuid as claim_id,
      n.event_type,
      n.status,
      n.entity_kind,
      n.entity_id
    from public.status_notifications n
    where n.recipient_id = v_uid

    union all

    select
      'post_comment'::text as kind,
      c.id,
      'มีคนคอมเมนต์โพสต์ของคุณ: ' || coalesce(c.body, '') as body,
      c.created_at,
      null::timestamptz as read_at,
      null::uuid as task_id,
      null::uuid as message_id,
      null::text as claim_kind,
      null::uuid as claim_id,
      null::text as event_type,
      null::text as status,
      null::text as entity_kind,
      null::uuid as entity_id
    from public.community_feed_comments c
    where c.user_id <> v_uid
      and c.created_at > v_community_seen
      and exists (select 1 from my_posts p where p.id = c.post_id)

    union all

    select
      'note_reply'::text as kind,
      r.id,
      'มีคนตอบกลับโน้ตของคุณ: ' || coalesce(r.body, '') as body,
      r.created_at,
      null::timestamptz as read_at,
      null::uuid as task_id,
      null::uuid as message_id,
      null::text as claim_kind,
      null::uuid as claim_id,
      null::text as event_type,
      null::text as status,
      null::text as entity_kind,
      null::uuid as entity_id
    from public.community_note_replies r
    where r.user_id <> v_uid
      and r.created_at > v_community_seen
      and exists (select 1 from my_notes n where n.id = r.note_id)
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'kind', x.kind,
        'id', x.id,
        'body', x.body,
        'created_at', x.created_at,
        'read_at', x.read_at,
        'task_id', x.task_id,
        'message_id', x.message_id,
        'claim_kind', x.claim_kind,
        'claim_id', x.claim_id,
        'event_type', x.event_type,
        'status', x.status,
        'entity_kind', x.entity_kind,
        'entity_id', x.entity_id
      )
      order by x.created_at desc
    ),
    '[]'::jsonb
  )
  into v_notifications
  from (
    select *
    from notif_union
    order by created_at desc
    limit v_limit
  ) x;

  return jsonb_build_object(
    'ok', true,
    'counts', jsonb_build_object(
      'chat', v_chat_count,
      'community', v_community_count,
      'task_unread', v_task_unread,
      'mention_unread', v_mention_unread,
      'finance_unread', v_finance_unread,
      'status_unread', v_status_unread
    ),
    'notifications', v_notifications
  );
end;
$$;

revoke all on function public.app_badge_notif_snapshot(timestamptz, timestamptz, integer) from public;
grant execute on function public.app_badge_notif_snapshot(timestamptz, timestamptz, integer) to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'status_notifications'
  ) then
    alter publication supabase_realtime add table public.status_notifications;
  end if;
end $$;
