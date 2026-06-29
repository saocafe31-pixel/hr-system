import { supabase } from '@/lib/supabase';

export async function adminResetUserPassword(params: {
  userId?: string | null;
  employeeId?: string | null;
  password: string;
}): Promise<{ userId: string }> {
  const { data, error } = await supabase.functions.invoke<{
    ok?: boolean;
    error?: string;
    message?: string;
    user_id?: string;
  }>('admin-reset-user-password', {
    body: {
      user_id: params.userId ?? undefined,
      employee_id: params.employeeId ?? undefined,
      password: params.password,
    },
  });

  if (error) {
    const hint =
      error.message?.includes('Failed to fetch') || error.message?.includes('404')
        ? ' — ตรวจสอบว่า deploy Edge Function admin-reset-user-password ใน Supabase แล้ว'
        : '';
    throw new Error(`${error.message ?? 'ไม่ทราบสาเหตุ'}${hint}`);
  }

  const apiErr = data?.error;
  if (apiErr) {
    if (apiErr === 'password_too_short') {
      throw new Error('รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร');
    }
    if (apiErr === 'missing_user_id') {
      throw new Error('ยังไม่มีบัญชีล็อกอินที่เชื่อมกับพนักงานคนนี้');
    }
    if (apiErr === 'forbidden') {
      throw new Error('เฉพาะแอดมินเท่านั้น');
    }
    throw new Error(data?.message ?? apiErr);
  }

  const userId = data?.user_id?.trim();
  if (!userId) {
    throw new Error('อัปเดตรหัสผ่านไม่สำเร็จ');
  }

  return { userId };
}
