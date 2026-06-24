-- Employee requests payslip correction; notify admins and show note in Payroll UI.

alter table public.payroll_slips
  add column if not exists employee_correction_note text,
  add column if not exists employee_correction_requested_at timestamptz,
  add column if not exists employee_correction_requested_by uuid references public.profiles(id) on delete set null,
  add column if not exists employee_correction_admin_seen_at timestamptz;

create index if not exists payroll_slips_correction_pending_idx
  on public.payroll_slips (employee_correction_requested_at desc)
  where employee_correction_note is not null;

create table if not exists public.payroll_correction_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  slip_id uuid not null references public.payroll_slips(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  cycle_key text not null,
  body text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists payroll_correction_notifications_recipient_idx
  on public.payroll_correction_notifications (recipient_id, created_at desc);
create index if not exists payroll_correction_notifications_unread_idx
  on public.payroll_correction_notifications (recipient_id, read_at, created_at desc);
create index if not exists payroll_correction_notifications_slip_idx
  on public.payroll_correction_notifications (slip_id, created_at desc);

alter table public.payroll_correction_notifications enable row level security;

drop policy if exists "payroll_correction_notifications_select_recipient" on public.payroll_correction_notifications;
create policy "payroll_correction_notifications_select_recipient" on public.payroll_correction_notifications
  for select to authenticated
  using (auth.uid() = recipient_id);

drop policy if exists "payroll_correction_notifications_update_recipient" on public.payroll_correction_notifications;
create policy "payroll_correction_notifications_update_recipient" on public.payroll_correction_notifications
  for update to authenticated
  using (auth.uid() = recipient_id)
  with check (auth.uid() = recipient_id);

alter table public.payroll_slip_events
  drop constraint if exists payroll_slip_events_event_type_check;

alter table public.payroll_slip_events
  add constraint payroll_slip_events_event_type_check
  check (event_type in (
    'generated',
    'confirmed',
    'paid',
    'voided',
    'reissued',
    'employee_confirmed',
    'correction_requested',
    'correction_acknowledged'
  ));

create or replace function public.request_payroll_slip_correction(
  p_slip_id uuid,
  p_note text
)
returns public.payroll_slips
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_slip public.payroll_slips%rowtype;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_employee_name text;
  v_body text;
begin
  if v_actor is null then
    raise exception 'unauthorized';
  end if;

  if v_note is null then
    raise exception 'note_required';
  end if;

  select *
  into v_profile
  from public.profiles
  where id = v_actor
  limit 1;

  select *
  into v_slip
  from public.payroll_slips
  where id = p_slip_id
  for update;

  if v_slip.id is null then
    raise exception 'slip_not_found';
  end if;

  if v_slip.status not in ('confirmed', 'paid') then
    raise exception 'only_confirmed_or_paid_can_request_correction';
  end if;

  if not (
    v_slip.user_id = v_actor
    or (
      v_profile.employee_id is not null
      and v_profile.employee_id = v_slip.employee_id
    )
  ) then
    raise exception 'forbidden';
  end if;

  update public.payroll_slips
  set
    employee_correction_note = v_note,
    employee_correction_requested_at = now(),
    employee_correction_requested_by = v_actor,
    employee_correction_admin_seen_at = null,
    employee_confirmed_by = null,
    employee_confirmed_at = null
  where id = v_slip.id
  returning * into v_slip;

  select coalesce(nullif(trim(p.full_name), ''), nullif(trim(p.email), ''), 'พนักงาน')
  into v_employee_name
  from public.profiles p
  where p.id = v_slip.user_id
  limit 1;

  v_body := v_employee_name || ' แจ้งแก้ไขสลิปรอบ ' || v_slip.cycle_key || ': ' || v_note;

  insert into public.payroll_correction_notifications (
    recipient_id,
    actor_id,
    slip_id,
    user_id,
    cycle_key,
    body
  )
  select
    p.id,
    v_actor,
    v_slip.id,
    v_slip.user_id,
    v_slip.cycle_key,
    v_body
  from public.profiles p
  where p.role = 'admin';

  insert into public.payroll_slip_events (slip_id, actor_id, event_type, reason, metadata)
  values (
    v_slip.id,
    v_actor,
    'correction_requested',
    v_note,
    jsonb_build_object('cycle_key', v_slip.cycle_key, 'status', v_slip.status)
  );

  return v_slip;
end;
$$;

revoke all on function public.request_payroll_slip_correction(uuid, text) from public;
grant execute on function public.request_payroll_slip_correction(uuid, text) to authenticated;

create or replace function public.acknowledge_payroll_slip_correction(p_slip_id uuid)
returns public.payroll_slips
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_slip public.payroll_slips%rowtype;
begin
  if v_actor is null then
    raise exception 'unauthorized';
  end if;

  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  select *
  into v_slip
  from public.payroll_slips
  where id = p_slip_id
  for update;

  if v_slip.id is null then
    raise exception 'slip_not_found';
  end if;

  update public.payroll_slips
  set employee_correction_admin_seen_at = now()
  where id = v_slip.id
  returning * into v_slip;

  update public.payroll_correction_notifications
  set read_at = coalesce(read_at, now())
  where slip_id = p_slip_id
    and recipient_id = v_actor
    and read_at is null;

  insert into public.payroll_slip_events (slip_id, actor_id, event_type, metadata)
  values (
    v_slip.id,
    v_actor,
    'correction_acknowledged',
    jsonb_build_object('cycle_key', v_slip.cycle_key)
  );

  return v_slip;
end;
$$;

revoke all on function public.acknowledge_payroll_slip_correction(uuid) from public;
grant execute on function public.acknowledge_payroll_slip_correction(uuid) to authenticated;

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
  v_payroll_unread integer := 0;
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

  select count(*)::int
  into v_payroll_unread
  from public.payroll_correction_notifications n
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
      null::uuid as entity_id,
      null::text as cycle_key
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
      null::uuid as entity_id,
      null::text as cycle_key
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
      null::uuid as entity_id,
      null::text as cycle_key
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
      n.entity_id,
      null::text as cycle_key
    from public.status_notifications n
    where n.recipient_id = v_uid

    union all

    select
      'payroll'::text as kind,
      n.id,
      n.body,
      n.created_at,
      n.read_at,
      null::uuid as task_id,
      null::uuid as message_id,
      'payroll'::text as claim_kind,
      n.slip_id as claim_id,
      'correction_requested'::text as event_type,
      'pending'::text as status,
      'payroll'::text as entity_kind,
      n.user_id as entity_id,
      n.cycle_key
    from public.payroll_correction_notifications n
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
      null::uuid as entity_id,
      null::text as cycle_key
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
      null::uuid as entity_id,
      null::text as cycle_key
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
        'entity_id', x.entity_id,
        'cycle_key', x.cycle_key
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
      'status_unread', v_status_unread,
      'payroll_unread', v_payroll_unread
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
      and tablename = 'payroll_correction_notifications'
  ) then
    alter publication supabase_realtime add table public.payroll_correction_notifications;
  end if;
end $$;
