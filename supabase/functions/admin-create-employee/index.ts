import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

type UserRole = 'employee' | 'manager' | 'admin';

type EmployeeBody = {
  employee_no?: string | null;
  prefix?: string | null;
  name?: string | null;
  surname?: string | null;
  nickname?: string | null;
  position?: string | null;
  branch?: string | null;
  branch_id?: number | null;
  phone?: string | null;
  start_date?: string | null;
  national_id?: string | null;
  address_id_card?: string | null;
  current_address?: string | null;
  bank?: string | null;
  account_number?: string | null;
  status?: string | null;
  password?: string | null;
};

type ReqBody = {
  email: string;
  password: string;
  full_name?: string | null;
  role?: UserRole | null;
  branch_id?: number | null;
  employee?: EmployeeBody | null;
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, 'content-type': 'application/json; charset=utf-8' },
  });
}

function buildEmployeeRow(emailNorm: string, e: EmployeeBody | null | undefined) {
  const emp = e ?? {};
  const idRaw = emp.employee_no != null ? String(emp.employee_no).trim() : '';
  const idNum = idRaw ? parseInt(idRaw, 10) : null;
  const row: Record<string, string | number | null> = {
    UserID: emailNorm,
    'Employee ID': idNum !== null && !Number.isNaN(idNum) ? idNum : null,
    Prefix: emp.prefix?.trim() || null,
    Name: emp.name?.trim() || null,
    Surname: emp.surname?.trim() || null,
    nickname: emp.nickname?.trim() || null,
    position: emp.position?.trim() || null,
    branch: emp.branch?.trim() || null,
    ['phone number']: emp.phone?.trim() || null,
    'Start date': emp.start_date?.trim() || null,
    'National ID number': emp.national_id?.trim() || null,
    'Address as per ID card': emp.address_id_card?.trim() || null,
    'Current address': emp.current_address?.trim() || null,
    bank: emp.bank?.trim() || null,
    'Account number': emp.account_number?.trim() || null,
    status: emp.status?.trim() || null,
  };
  if (typeof emp.branch_id === 'number' && !Number.isNaN(emp.branch_id)) {
    row.branch_id = emp.branch_id;
  }
  const pw = emp.password?.trim();
  if (pw) {
    row.Password = pw;
  }
  return row;
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

  const email = String(body.email ?? '')
    .trim()
    .toLowerCase();
  const password = String(body.password ?? '');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: 'invalid_email' }, 400);
  }
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

  const role: UserRole =
    body.role === 'manager' || body.role === 'admin' ? body.role : 'employee';
  const nameFromEmp = [body.employee?.name, body.employee?.surname]
    .map((s) => (s ?? '').trim())
    .filter(Boolean)
    .join(' ')
    .trim();
  const displayName = body.full_name?.trim() || nameFromEmp || email;

  const profileBranchId =
    typeof body.branch_id === 'number' && !Number.isNaN(body.branch_id)
      ? body.branch_id
      : typeof body.employee?.branch_id === 'number' &&
          !Number.isNaN(body.employee.branch_id)
        ? body.employee.branch_id
        : null;

  let newUserId: string | null = null;
  let newEmpId: string | null = null;

  try {
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: displayName },
    });
    if (createErr || !created.user) {
      return json(
        { error: 'auth_create_failed', message: createErr?.message ?? 'unknown' },
        400
      );
    }
    newUserId = created.user.id;

    let insertPayload = buildEmployeeRow(email, body.employee ?? undefined);
    let ins = await admin.from('employee').insert(insertPayload).select('id').single();
    if (ins.error && String(ins.error.message).includes('branch_id')) {
      const { branch_id: _b, ...rest } = insertPayload;
      insertPayload = rest;
      ins = await admin.from('employee').insert(insertPayload).select('id').single();
    }
    if (ins.error || !ins.data) {
      await admin.auth.admin.deleteUser(newUserId);
      return json(
        { error: 'employee_insert_failed', message: ins.error?.message ?? 'unknown' },
        400
      );
    }
    newEmpId = (ins.data as { id: string }).id;

    const { error: upErr } = await admin
      .from('profiles')
      .update({
        employee_id: newEmpId,
        full_name: displayName,
        role,
        branch_id: profileBranchId,
        email,
      })
      .eq('id', newUserId);

    if (upErr) {
      await admin.from('employee').delete().eq('id', newEmpId);
      await admin.auth.admin.deleteUser(newUserId);
      return json(
        { error: 'profile_update_failed', message: upErr.message },
        400
      );
    }

    return json({
      ok: true,
      user_id: newUserId,
      employee_id: newEmpId,
    });
  } catch (e) {
    if (newEmpId) {
      await admin.from('employee').delete().eq('id', newEmpId);
    }
    if (newUserId) {
      await admin.auth.admin.deleteUser(newUserId);
    }
    return json(
      {
        error: 'unexpected',
        message: e instanceof Error ? e.message : String(e),
      },
      500
    );
  }
});
