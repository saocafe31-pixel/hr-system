/**
 * แมปฟิลด์ฟอร์ม → คอลัมน์จริงของ public.employee (PostgREST)
 * คอลัมน์ "Password" อัปเดตแยก — เฉพาะแอดมิน (สอดคล้อง trigger employee_preserve_password)
 */
export type EmployeeHrForm = {
  legacy_user_id: string;
  employee_no: string;
  prefix: string;
  name: string;
  surname: string;
  nickname: string;
  position: string;
  branch: string;
  branch_id: number | null;
  phone: string;
  start_date: string;
  national_id: string;
  address_id_card: string;
  current_address: string;
  bank: string;
  account_number: string;
  status: string;
};

export function buildEmployeeHrUpdate(
  f: EmployeeHrForm,
  options?: { includeBranchId?: boolean }
): Record<string, string | number | null> {
  const idNum = f.employee_no.trim() ? parseInt(f.employee_no.trim(), 10) : null;
  const payload: Record<string, string | number | null> = {
    UserID: f.legacy_user_id.trim() || null,
    'Employee ID': idNum !== null && !Number.isNaN(idNum) ? idNum : null,
    Prefix: f.prefix.trim() || null,
    Name: f.name.trim() || null,
    Surname: f.surname.trim() || null,
    nickname: f.nickname.trim() || null,
    position: f.position.trim() || null,
    branch: f.branch.trim() || null,
    branch_code: null,
    ['phone number']: f.phone.trim() || null,
    'Start date': f.start_date.trim() || null,
    'National ID number': f.national_id.trim() || null,
    'Address as per ID card': f.address_id_card.trim() || null,
    'Current address': f.current_address.trim() || null,
    bank: f.bank.trim() || null,
    'Account number': f.account_number.trim() || null,
    status: f.status.trim() || null,
  };
  if (options?.includeBranchId ?? true) {
    payload.branch_id = f.branch_id;
  }
  return payload;
}
