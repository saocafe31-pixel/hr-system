# Remote Push Pipeline (Expo)

## 1) Apply migration

```bash
npm run db:push
```

Migration created:
- `20260417220000_remote_push_pipeline.sql`

This adds:
- `public.push_notification_jobs` (queue)
- trigger producers for:
  - `task_notifications`
  - `attendance_chat_mention_notifications`
  - `community_feed_comments` (notify post owner)
  - `community_note_replies` (notify note owner)
- RPC:
  - `claim_push_notification_jobs(p_limit)`
  - `finalize_push_notification_job(p_id, p_ok, p_error)`

## 2) Deploy Edge Function worker

```bash
npm run fn:deploy:push
```

Function path:
- `supabase/functions/push-dispatch/index.ts`

## 3) Set secrets (Dashboard → Edge Functions → Secrets)

- `SUPABASE_URL` (usually auto)
- `SUPABASE_SERVICE_ROLE_KEY` (usually auto)
- `PUSH_DISPATCH_SECRET` (custom random secret, optional but recommended)
- `PUSH_DISPATCH_BATCH` (optional, default 100)

## 4) Schedule worker (required for automatic remote push)

Create Scheduled Function in Supabase Dashboard:
- Endpoint: `push-dispatch`
- Method: `POST`
- Frequency: every 1 minute
- Header: `x-push-dispatch-secret: <PUSH_DISPATCH_SECRET>`

## 5) Quick manual test

Call function endpoint directly:

```bash
curl -X POST "https://qidohlmeyhsofuntbmbw.functions.supabase.co/push-dispatch" \
  -H "x-push-dispatch-secret: <PUSH_DISPATCH_SECRET>"
```

If queue exists and tokens are valid, response should show `sent > 0`.

---

## Web Push (PWA) pipeline

### A) Apply migration

```bash
npm run db:push
```

Migration:
- `20260417230000_web_push_pipeline.sql`

Adds:
- `public.web_push_subscriptions`
- `public.web_push_notification_jobs`
- trigger producers (task/mention/post_comment/note_reply)
- RPC claim/finalize for web worker

### B) Deploy web worker

```bash
npm run fn:deploy:webpush
```

### C) Set required secrets

In **Edge Functions → Secrets** set:
- `WEB_PUSH_VAPID_PUBLIC_KEY`
- `WEB_PUSH_VAPID_PRIVATE_KEY`
- `WEB_PUSH_VAPID_SUBJECT` (example: `mailto:admin@chaijunla.com`)
- `WEBPUSH_DISPATCH_SECRET`
- `WEBPUSH_DISPATCH_BATCH` (optional, default 100)

Also set public key for frontend:
- `EXPO_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY` in `.env`

### D) Schedule web worker every minute

POST:
- `https://<project-ref>.functions.supabase.co/webpush-dispatch`

Header:
- `x-webpush-dispatch-secret: <WEBPUSH_DISPATCH_SECRET>`

### E) Client registration behavior

When user grants permission on web/PWA, app auto-registers:
- service worker `/sw-webpush.js`
- `PushManager.subscribe(...)`
- upsert row into `web_push_subscriptions`
