import { isUuidLike } from '@/lib/adminEmployeeMerge';
import type { EmployeeDirectory } from '@/lib/types';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * หา profiles.id สำหรับแอดมิน (วันลา / vacation_grants)
 * ลำดับ: RPC admin_profile_id_for_employee → employee_id → email = UserID → id = UserID(uuid) → employee_code
 */
export async function resolveProfileUserIdForLeave(
  client: SupabaseClient,
  employeeId: string,
  hrRow: EmployeeDirectory | null
): Promise<string | null> {
  const empKey = String(employeeId).trim();
  if (!empKey) return null;

  const { data: rpcRaw, error: rpcErr } = await client.rpc(
    'admin_profile_id_for_employee',
    { p_employee_id: empKey }
  );
  if (!rpcErr && rpcRaw != null && rpcRaw !== '') {
    const u = typeof rpcRaw === 'string' ? rpcRaw : String(rpcRaw);
    if (u.length >= 32) return u;
  }

  const { data: d1 } = await client
    .from('profiles')
    .select('id')
    .eq('employee_id', empKey)
    .maybeSingle();
  if (d1?.id) return d1.id as string;

  const legacy = hrRow?.legacy_user_id?.trim() ?? '';
  if (legacy.includes('@')) {
    const email = legacy.toLowerCase();
    const { data: d2 } = await client
      .from('profiles')
      .select('id')
      .eq('email', email)
      .maybeSingle();
    if (d2?.id) return d2.id as string;
  }

  if (legacy && isUuidLike(legacy)) {
    const { data: d3 } = await client
      .from('profiles')
      .select('id')
      .eq('id', legacy)
      .maybeSingle();
    if (d3?.id) return d3.id as string;
  }

  if (hrRow?.employee_no != null) {
    const code = String(hrRow.employee_no).trim();
    if (code) {
      const { data: d4 } = await client
        .from('profiles')
        .select('id')
        .eq('employee_code', code)
        .maybeSingle();
      if (d4?.id) return d4.id as string;
    }
  }

  return null;
}
