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
      null::text as status
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
      null::text as status
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
      n.status
    from public.finance_claim_notifications n
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
      null::text as status
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
      null::text as status
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
        'status', x.status
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
      'finance_unread', v_finance_unread
    ),
    'notifications', v_notifications
  );
end;
$$;

revoke all on function public.app_badge_notif_snapshot(timestamptz, timestamptz, integer) from public;
grant execute on function public.app_badge_notif_snapshot(timestamptz, timestamptz, integer) to authenticated;
