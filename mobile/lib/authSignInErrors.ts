/** Map Supabase GoTrue errors to readable Thai for the login UI. */
export function formatAuthSignInError(error: {
  message: string;
  code?: string;
}): string {
  const msg = (error.message || '').toLowerCase();
  const code = (error.code || '').toLowerCase();

  if (
    code === 'invalid_credentials' ||
    msg.includes('invalid login') ||
    msg.includes('invalid email or password')
  ) {
    return 'อีเมลหรือรหัสผ่านไม่ถูกต้อง';
  }
  if (msg.includes('email not confirmed')) {
    return 'ยังไม่ได้ยืนยันอีเมล กรุณาตรวจกล่องจดหมายหรือติดต่อผู้ดูแลระบบ';
  }
  if (msg.includes('too many requests') || msg.includes('rate limit')) {
    return 'ลองเข้าสู่ระบบบ่อยเกินไป รอสักครู่แล้วลองใหม่';
  }
  if (msg.includes('network') || msg.includes('fetch')) {
    return 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่';
  }

  return error.message?.trim() || 'เข้าสู่ระบบไม่สำเร็จ';
}
