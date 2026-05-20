import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import webpush from 'npm:web-push@3.6.7';

type ClaimedJob = {
  id: string;
  recipient_id: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  channel: string;
  attempt_count: number;
};

type SubscriptionRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const WEBPUSH_DISPATCH_SECRET = Deno.env.get('WEBPUSH_DISPATCH_SECRET') ?? '';
const VAPID_PUBLIC_KEY = Deno.env.get('WEB_PUSH_VAPID_PUBLIC_KEY') ?? '';
const VAPID_PRIVATE_KEY = Deno.env.get('WEB_PUSH_VAPID_PRIVATE_KEY') ?? '';
const VAPID_SUBJECT = Deno.env.get('WEB_PUSH_VAPID_SUBJECT') ?? 'mailto:admin@example.com';
const MAX_CLAIM = Number(Deno.env.get('WEBPUSH_DISPATCH_BATCH') ?? '100');

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

Deno.serve(async (req) => {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: 'missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' }, 500);
  }
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return json({ error: 'missing WEB_PUSH_VAPID_PUBLIC_KEY or WEB_PUSH_VAPID_PRIVATE_KEY' }, 500);
  }
  if (WEBPUSH_DISPATCH_SECRET) {
    const token = req.headers.get('x-webpush-dispatch-secret') ?? '';
    if (token !== WEBPUSH_DISPATCH_SECRET) {
      return json({ error: 'unauthorized' }, 401);
    }
  }

  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const claimLimit = Number.isFinite(MAX_CLAIM) ? Math.min(200, Math.max(1, MAX_CLAIM)) : 100;
  const { data: claimed, error: claimErr } = await supabase.rpc('claim_web_push_notification_jobs', {
    p_limit: claimLimit,
  });
  if (claimErr) return json({ error: claimErr.message }, 500);

  const jobs = (claimed as ClaimedJob[] | null) ?? [];
  if (!jobs.length) return json({ ok: true, claimed: 0, sent: 0, failed: 0 });

  let sent = 0;
  let failed = 0;

  for (const job of jobs) {
    const { data: subs } = await supabase
      .from('web_push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .eq('user_id', job.recipient_id);

    const subscriptions = (subs as SubscriptionRow[] | null) ?? [];
    if (!subscriptions.length) {
      await supabase.rpc('finalize_web_push_notification_job', {
        p_id: job.id,
        p_ok: true,
        p_error: null,
      });
      continue;
    }

    let anyOk = false;
    let lastErr: string | null = null;

    for (const s of subscriptions) {
      try {
        await webpush.sendNotification(
          {
            endpoint: s.endpoint,
            keys: {
              p256dh: s.p256dh,
              auth: s.auth,
            },
          },
          JSON.stringify({
            title: job.title,
            body: job.body,
            data: { ...(job.data ?? {}), channel: job.channel, job_id: job.id },
          })
        );
        anyOk = true;
      } catch (e) {
        const err = e as { statusCode?: number; body?: string; message?: string };
        const msg = err?.body || err?.message || String(e);
        lastErr = msg;
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          await supabase.from('web_push_subscriptions').delete().eq('id', s.id);
        }
      }
    }

    await supabase.rpc('finalize_web_push_notification_job', {
      p_id: job.id,
      p_ok: anyOk,
      p_error: anyOk ? null : lastErr ?? 'web_push_failed',
    });
    if (anyOk) sent++;
    else failed++;
  }

  return json({ ok: true, claimed: jobs.length, sent, failed });
});
