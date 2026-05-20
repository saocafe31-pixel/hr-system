-- Fix ambiguous "id" reference in claim_push_notification_jobs()
-- (output column "id" in RETURNS TABLE can clash with unqualified id in subquery)

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
    where j.id in (select tc.id from to_claim tc)
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
