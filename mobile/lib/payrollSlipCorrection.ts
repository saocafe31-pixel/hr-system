import type { PayrollSlipRow } from '@/lib/types';

export function slipHasPendingPayrollCorrection(slip: Pick<
  PayrollSlipRow,
  | 'employee_correction_note'
  | 'employee_correction_requested_at'
  | 'employee_correction_admin_seen_at'
>): boolean {
  const note = slip.employee_correction_note?.trim();
  if (!note) return false;
  if (!slip.employee_correction_requested_at) return false;
  if (!slip.employee_correction_admin_seen_at) return true;
  return (
    new Date(slip.employee_correction_admin_seen_at).getTime() <
    new Date(slip.employee_correction_requested_at).getTime()
  );
}

export function slipHasEmployeeCorrectionRequest(slip: Pick<
  PayrollSlipRow,
  'employee_correction_note' | 'employee_correction_requested_at'
>): boolean {
  return !!slip.employee_correction_note?.trim() && !!slip.employee_correction_requested_at;
}
