import type { AdminEmployeePasswordRow, EmployeeDirectory } from '@/lib/types';

/** ฟิลด์สอดคล้องกับ CSV HR / ตาราง employee */
export const HR_DIRECTORY_FIELDS: {
  key: keyof EmployeeDirectory;
  label: string;
}[] = [
  { key: 'legacy_user_id', label: 'User ID (อีเมล)' },
  { key: 'employee_no', label: 'รหัสพนักงาน' },
  { key: 'prefix', label: 'คำนำหน้า' },
  { key: 'name', label: 'ชื่อ' },
  { key: 'surname', label: 'นามสกุล' },
  { key: 'nickname', label: 'ชื่อเล่น' },
  { key: 'position', label: 'ตำแหน่ง' },
  { key: 'branch', label: 'สาขา' },
  { key: 'phone', label: 'เบอร์โทร' },
  { key: 'start_date', label: 'วันเริ่มงาน' },
  { key: 'national_id', label: 'เลขบัตรประชาชน' },
  { key: 'address_id_card', label: 'ที่อยู่ตามบัตร' },
  { key: 'current_address', label: 'ที่อยู่ปัจจุบัน' },
  { key: 'bank', label: 'ธนาคาร' },
  { key: 'account_number', label: 'เลขบัญชี' },
  { key: 'status', label: 'สถานะ' },
];

export function formatDirectoryValue(
  row: EmployeeDirectory,
  key: keyof EmployeeDirectory
): string {
  const v = row[key];
  if (v == null || v === '') return '—';
  if (typeof v === 'number') return String(v);
  return String(v);
}

export function directoryDisplayName(row: EmployeeDirectory): string {
  const parts = [row.prefix, row.name, row.surname].filter(Boolean);
  if (parts.length) return parts.join(' ');
  if (row.nickname) return row.nickname;
  return row.legacy_user_id || '—';
}

export function directoryToAdminPreview(
  row: EmployeeDirectory
): AdminEmployeePasswordRow {
  return {
    id: row.id,
    legacy_user_id: row.legacy_user_id,
    legacy_password: null,
    employee_no: row.employee_no,
    display_name: directoryDisplayName(row),
    branch: row.branch,
  };
}
