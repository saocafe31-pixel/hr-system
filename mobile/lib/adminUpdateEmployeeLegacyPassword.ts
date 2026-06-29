import { supabase } from '@/lib/supabase';

export async function adminUpdateEmployeeLegacyPassword(
  employeeId: string,
  password: string
): Promise<void> {
  const { data, error } = await supabase.rpc('admin_update_employee_legacy_password', {
    p_employee_id: employeeId,
    p_password: password,
  });

  if (error) {
    const hint = error.message?.includes('admin_update_employee_legacy_password')
      ? ' — รัน migration admin_update_employee_legacy_password ใน Supabase'
      : '';
    throw new Error(`${error.message}${hint}`);
  }

  const raw = data as { ok?: boolean; error?: string } | null;
  if (raw?.ok === false) {
    if (raw.error === 'no_password_column') {
      throw new Error(
        'ตาราง employee ไม่มีคอลัมน์รหัส legacy — ใช้ส่วน «รหัสผ่านล็อกอิน» แทน'
      );
    }
    if (raw.error === 'employee_not_found') {
      throw new Error('ไม่พบแถวพนักงาน');
    }
    if (raw.error === 'forbidden') {
      throw new Error('เฉพาะแอดมินเท่านั้น');
    }
    throw new Error(raw.error ?? 'บันทึกรหัส legacy ไม่สำเร็จ');
  }
}
