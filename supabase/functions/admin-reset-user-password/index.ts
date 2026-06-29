import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

type ReqBody = {
  user_id?: string | null;
  employee_id?: string | null;
  password?: string | null;
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, 'content-type': 'application/json; charset=utf-8' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }
  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405);
  }
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return json({ error: 'server_misconfigured' }, 500);
  }

  const authHeader = req.headers.get('Authorization');
  const jwt = authHeader?.replace(/^Bearer\s+/i, '') ?? '';
  if (!jwt) {
    return json({ error: 'missing_authorization' }, 401);
  }

  let body: ReqBody;
  try {
    body = (await req.json()) as ReqBody;
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const password = String(body.password ?? '');
  if (password.length < 6) {
    return json({ error: 'password_too_short', min: 6 }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: authUser, error: authErr } = await admin.auth.getUser(jwt);
  if (authErr || !authUser?.user) {
    return json({ error: 'invalid_session' }, 401);
  }

  const { data: prof, error: profErr } = await admin
    .from('profiles')
    .select('role')
    .eq('id', authUser.user.id)
    .maybeSingle();
  if (profErr || (prof as { role?: string } | null)?.role !== 'admin') {
    return json({ error: 'forbidden' }, 403);
  }

  let targetUserId = (body.user_id ?? '').trim();
  const employeeId = (body.employee_id ?? '').trim();

  if (!targetUserId && employeeId) {
    const { data: linked, error: linkErr } = await admin
      .from('profiles')
      .select('id')
      .eq('employee_id', employeeId)
      .maybeSingle();
    if (linkErr) {
      return json({ error: 'profile_lookup_failed', message: linkErr.message }, 400);
    }
    targetUserId = (linked as { id?: string } | null)?.id?.trim() ?? '';
  }

  if (!targetUserId) {
    return json({ error: 'missing_user_id' }, 400);
  }

  const { error: updateErr } = await admin.auth.admin.updateUserById(targetUserId, {
    password,
  });
  if (updateErr) {
    return json(
      { error: 'auth_update_failed', message: updateErr.message },
      400
    );
  }

  return json({ ok: true, user_id: targetUserId });
});
