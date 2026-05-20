import type { EmployeeDirectory } from '@/lib/types';

/** แมปแถวจากตาราง employee (ชื่อคอลัมน์จริง) → EmployeeDirectory */
export function mapEmployeeTableRowToDirectory(
  row: Record<string, unknown>
): EmployeeDirectory {
  const n = (v: unknown): number | null => {
    if (v == null || v === '') return null;
    if (typeof v === 'number' && !Number.isNaN(v)) return v;
    const x = parseInt(String(v), 10);
    return Number.isNaN(x) ? null : x;
  };
  const s = (v: unknown): string | null => {
    if (v == null) return null;
    const t = String(v).trim();
    return t === '' ? null : t;
  };

  return {
    id: String(row.id ?? ''),
    legacy_user_id: s(row.UserID),
    employee_no: n(row['Employee ID']),
    prefix: s(row.Prefix),
    name: s(row.Name),
    surname: s(row.Surname),
    nickname: s(row.nickname),
    position: s(row.position),
    branch: s(row.branch),
    branch_code: s(row.branch_code),
    branch_id:
      row.branch_id != null && row.branch_id !== ''
        ? Number(row.branch_id)
        : null,
    phone: s(row['phone number']),
    start_date: s(row['Start date']),
    national_id: s(row['National ID number']),
    address_id_card: s(row['Address as per ID card']),
    current_address: s(row['Current address']),
    bank: s(row.bank),
    account_number: s(row['Account number']),
    status: s(row.status),
  };
}
