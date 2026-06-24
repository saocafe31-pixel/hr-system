import { supabase } from '@/lib/supabase';
import {
  parseEmploymentCertificateSettings,
  type EmploymentCertificateSettings,
} from '@/lib/employmentCertificateSettings';
import { parsePayrollCompanyInfo, type PayrollCompanyInfo } from '@/lib/payrollCompanyInfo';

export type EmploymentCertificatePayload = {
  withSalary: boolean;
  company: PayrollCompanyInfo;
  certificate: EmploymentCertificateSettings;
  employee: {
    fullName: string;
    position: string;
    branch: string;
    startDate: string;
  };
  monthlySalary: number | null;
};

function rpcErrorMessage(code: string): string {
  if (code === 'employee_not_linked') {
    return 'บัญชีของคุณยังไม่ได้เชื่อมกับข้อมูลพนักงาน — ติดต่อ HR/แอดมิน';
  }
  if (code === 'employee_id_required') return 'กรุณาเลือกพนักงาน';
  if (code === 'employee_not_found') return 'ไม่พบข้อมูลพนักงานในระบบ HR';
  if (code === 'employee_not_active') return 'ไม่สามารถออกหนังสือรับรองสำหรับพนักงานที่ลาออกแล้ว';
  if (code === 'salary_not_configured') {
    return 'ยังไม่มีฐานเงินเดือนในระบบ — ตั้งค่าในเมนูจัดการฐานเงินเดือน หรือเลือกแบบไม่ระบุเงินเดือน';
  }
  if (code === 'forbidden') return 'ไม่มีสิทธิ์ออกหนังสือรับรอง';
  return code;
}

function parseRpcEmploymentCertificatePayload(raw: unknown): EmploymentCertificatePayload {
  const record = (raw ?? {}) as Record<string, unknown>;
  const employeeRaw = (record.employee ?? {}) as Record<string, unknown>;
  return {
    withSalary: Boolean(record.with_salary),
    company: parsePayrollCompanyInfo(record.company),
    certificate: parseEmploymentCertificateSettings(record.certificate),
    employee: {
      fullName: String(employeeRaw.full_name ?? '').trim(),
      position: String(employeeRaw.position ?? '').trim(),
      branch: String(employeeRaw.branch ?? '').trim(),
      startDate: String(employeeRaw.start_date ?? '').trim(),
    },
    monthlySalary:
      record.monthly_salary == null || record.monthly_salary === ''
        ? null
        : Number(record.monthly_salary),
  };
}

function throwIfRpcError(error: { message?: string }): void {
  const msg = error.message ?? '';
  for (const code of [
    'employee_not_linked',
    'employee_id_required',
    'employee_not_found',
    'employee_not_active',
    'salary_not_configured',
    'forbidden',
  ]) {
    if (msg.includes(code)) throw new Error(rpcErrorMessage(code));
  }
  throw new Error(error.message);
}

export async function loadMyEmploymentCertificatePayload(
  withSalary: boolean
): Promise<EmploymentCertificatePayload> {
  const { data, error } = await supabase.rpc('get_my_employment_certificate_data', {
    p_with_salary: withSalary,
  });
  if (error) throwIfRpcError(error);
  return parseRpcEmploymentCertificatePayload(data);
}

export async function loadAdminEmploymentCertificatePayload(
  employeeId: string,
  withSalary: boolean
): Promise<EmploymentCertificatePayload> {
  const { data, error } = await supabase.rpc('admin_get_employment_certificate_data', {
    p_employee_id: employeeId,
    p_with_salary: withSalary,
  });
  if (error) throwIfRpcError(error);
  return parseRpcEmploymentCertificatePayload(data);
}
