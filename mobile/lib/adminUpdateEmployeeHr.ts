import type { EmployeeHrForm } from '@/lib/employeeTableUpdate';
import { supabase } from '@/lib/supabase';

function parseEmployeeNo(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = parseInt(trimmed, 10);
  return Number.isNaN(n) ? null : n;
}

/** บันทึกข้อมูล HR ผ่าน RPC (ข้าม RLS / คอลัมน์ legacy ที่ PostgREST แมปยาก) */
export async function adminUpdateEmployeeHr(
  employeeId: string,
  form: EmployeeHrForm
): Promise<string> {
  const { data, error } = await supabase.rpc('admin_update_employee_hr', {
    p_id: employeeId,
    p_legacy_user_id: form.legacy_user_id.trim() || null,
    p_employee_no: parseEmployeeNo(form.employee_no),
    p_prefix: form.prefix.trim() || null,
    p_name: form.name.trim() || null,
    p_surname: form.surname.trim() || null,
    p_nickname: form.nickname.trim() || null,
    p_position: form.position.trim() || null,
    p_branch: form.branch.trim() || null,
    p_branch_id: form.branch_id,
    p_phone: form.phone.trim() || null,
    p_start_date: form.start_date.trim() || null,
    p_national_id: form.national_id.trim() || null,
    p_address_id_card: form.address_id_card.trim() || null,
    p_current_address: form.current_address.trim() || null,
    p_bank: form.bank.trim() || null,
    p_account_number: form.account_number.trim() || null,
    p_status: form.status.trim() || null,
  });
  if (error) throw new Error(error.message);
  const id = typeof data === 'string' ? data.trim() : '';
  if (!id) {
    throw new Error('ไม่พบพนักงานหรืออัปเดตไม่สำเร็จ — ตรวจสอบว่ารัน migration admin_update_employee_hr แล้ว');
  }
  return id;
}
