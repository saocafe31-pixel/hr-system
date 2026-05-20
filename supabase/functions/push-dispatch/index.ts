import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

type ClaimedJob = {
  id: string;
  expo_push_token: string | null;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  channel: string;
  attempt_count: number;
};

type ExpoPushMessage = {
  to: string;
  sound: 'default';
  title: string;
  body: string;
  data?: Record<string, unknown>;
  badge?: number;
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const PUSH_DISPATCH_SECRET = Deno.env.get('PUSH_DISPATCH_SECRET') ?? '';
const MAX_CLAIM = Number(Deno.env.get('PUSH_DISPATCH_BATCH') ?? '100');

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function chunk<T>(input: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < input.length; i += size) out.push(input.slice(i, i + size));
  return out;
}

async function sendExpo(messages: ExpoPushMessage[]): Promise<unknown[]> {
  if (!messages.length) return [];
  const chunks = chunk(messages, 100);
  const tickets: unknown[] = [];
  for (const part of chunks) {
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(part),
    });
    const body = await res.json().catch(() => ({}));
    const data = Array.isArray(body?.data) ? body.data : [];
    tickets.push(...data);
  }
  return tickets;
}

Deno.serve(async (req) => {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: 'missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' }, 500);
  }
  if (PUSH_DISPATCH_SECRET) {
    const token = req.headers.get('x-push-dispatch-secret') ?? '';
    if (token !== PUSH_DISPATCH_SECRET) {
      return json({ error: 'unauthorized' }, 401);
    }
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const claimLimit = Number.isFinite(MAX_CLAIM) ? Math.min(200, Math.max(1, MAX_CLAIM)) : 100;
  const { data: claimed, error: claimErr } = await supabase.rpc('claim_push_notification_jobs', {
    p_limit: claimLimit,
  });
  if (claimErr) return json({ error: claimErr.message }, 500);

  const jobs = ((claimed as ClaimedJob[] | null) ?? []).filter(
    (j) => typeof j.expo_push_token === 'string' && j.expo_push_token.trim() !== ''
  );
  if (!jobs.length) return json({ ok: true, claimed: 0, sent: 0, failed: 0 });

  const messages: ExpoPushMessage[] = jobs.map((j) => ({
    to: j.expo_push_token!,
    sound: 'default',
    title: j.title,
    body: j.body,
    data: {
      ...(j.data ?? {}),
      job_id: j.id,
      channel: j.channel,
    },
  }));

  let tickets: unknown[] = [];
  try {
    tickets = await sendExpo(messages);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    for (const job of jobs) {
      await supabase.rpc('finalize_push_notification_job', {
        p_id: job.id,
        p_ok: false,
        p_error: msg,
      });
    }
    return json({ ok: false, claimed: jobs.length, sent: 0, failed: jobs.length, error: msg }, 502);
  }

  let sent = 0;
  let failed = 0;
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    const ticket = (tickets[i] ?? {}) as { status?: string; message?: string; details?: unknown };
    const ok = ticket.status === 'ok';
    if (ok) sent++;
    else failed++;
    await supabase.rpc('finalize_push_notification_job', {
      p_id: job.id,
      p_ok: ok,
      p_error: ok ? null : JSON.stringify(ticket.details ?? ticket.message ?? 'expo_error'),
    });
  }

  return json({ ok: true, claimed: jobs.length, sent, failed });
});
