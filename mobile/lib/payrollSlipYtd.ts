import { parsePayrollCycleKey } from '@/lib/leaveLateRules';
import { roundMoney } from '@/lib/payroll';
import { supabase } from '@/lib/supabase';
import type { PayrollItemRow, PayrollSlipRow } from '@/lib/types';

export type PayslipYearToDate = {
  year: number;
  taxableIncomeYtd: number;
  socialSecurityYtd: number;
};

type SlipYtdRow = Pick<PayrollSlipRow, 'id' | 'cycle_key' | 'status' | 'taxable_income'>;

function slipYear(cycleKey: string): number | null {
  return parsePayrollCycleKey(cycleKey)?.y ?? null;
}

export function taxableIncomeFromItems(items: PayrollItemRow[]): number {
  return roundMoney(
    items
      .filter((row) => row.item_kind === 'income' && row.taxable)
      .reduce((sum, row) => sum + Number(row.amount || 0), 0)
  );
}

export function socialSecurityFromItems(items: PayrollItemRow[]): number {
  return roundMoney(
    items
      .filter((row) => row.item_kind === 'deduction' && row.item_code === 'social_security')
      .reduce((sum, row) => sum + Number(row.amount || 0), 0)
  );
}

function slipCountsForYtd(
  row: SlipYtdRow,
  year: number,
  currentCycleKey: string,
  currentSlipId: string
): boolean {
  if (row.status === 'voided') return false;
  if (row.status !== 'confirmed' && row.status !== 'paid' && row.status !== 'draft') return false;
  if (slipYear(row.cycle_key) !== year) return false;
  if (row.cycle_key > currentCycleKey) return false;
  if (row.status === 'draft' && row.id !== currentSlipId) return false;
  return true;
}

export function computePayslipYearToDate(
  slips: SlipYtdRow[],
  socialSecurityBySlipId: Map<string, number>,
  currentSlip: SlipYtdRow,
  currentItems: PayrollItemRow[]
): PayslipYearToDate {
  const year = slipYear(currentSlip.cycle_key) ?? new Date().getFullYear();
  const currentCycleKey = currentSlip.cycle_key;
  const currentTaxable =
    currentItems.length > 0
      ? taxableIncomeFromItems(currentItems)
      : roundMoney(Number(currentSlip.taxable_income || 0));
  const currentSocialSecurity =
    currentItems.length > 0
      ? socialSecurityFromItems(currentItems)
      : roundMoney(socialSecurityBySlipId.get(currentSlip.id) ?? 0);

  let taxableIncomeYtd = 0;
  let socialSecurityYtd = 0;

  for (const row of slips) {
    if (!slipCountsForYtd(row, year, currentCycleKey, currentSlip.id)) continue;
    if (row.id === currentSlip.id) {
      taxableIncomeYtd += currentTaxable;
      socialSecurityYtd += currentSocialSecurity;
      continue;
    }
    taxableIncomeYtd += Number(row.taxable_income || 0);
    socialSecurityYtd += socialSecurityBySlipId.get(row.id) ?? 0;
  }

  const includedCurrent = slips.some(
    (row) => row.id === currentSlip.id && slipCountsForYtd(row, year, currentCycleKey, currentSlip.id)
  );
  if (!includedCurrent && slipCountsForYtd(currentSlip, year, currentCycleKey, currentSlip.id)) {
    taxableIncomeYtd += currentTaxable;
    socialSecurityYtd += currentSocialSecurity;
  }

  return {
    year,
    taxableIncomeYtd: roundMoney(taxableIncomeYtd),
    socialSecurityYtd: roundMoney(socialSecurityYtd),
  };
}

export async function fetchPayslipYearToDate(
  slip: PayrollSlipRow,
  currentItems: PayrollItemRow[]
): Promise<PayslipYearToDate> {
  const year = slipYear(slip.cycle_key) ?? new Date().getFullYear();

  let slipQuery = supabase
    .from('payroll_slips')
    .select('id, cycle_key, status, taxable_income')
    .neq('status', 'voided')
    .gte('cycle_key', `${year}-01`)
    .lte('cycle_key', `${year}-12`);

  if (slip.employee_id) {
    slipQuery = slipQuery.or(`user_id.eq.${slip.user_id},employee_id.eq.${slip.employee_id}`);
  } else {
    slipQuery = slipQuery.eq('user_id', slip.user_id);
  }

  const { data: slipRows, error: slipError } = await slipQuery;
  if (slipError) throw slipError;

  const slips = (slipRows as SlipYtdRow[]) ?? [];
  const slipIds = slips.map((row) => row.id);
  const socialSecurityBySlipId = new Map<string, number>();

  if (slipIds.length > 0) {
    const { data: ssRows, error: ssError } = await supabase
      .from('payroll_items')
      .select('slip_id, amount')
      .in('slip_id', slipIds)
      .eq('item_kind', 'deduction')
      .eq('item_code', 'social_security');
    if (ssError) throw ssError;
    for (const row of ssRows ?? []) {
      const slipId = String(row.slip_id);
      socialSecurityBySlipId.set(
        slipId,
        roundMoney((socialSecurityBySlipId.get(slipId) ?? 0) + Number(row.amount || 0))
      );
    }
  }

  return computePayslipYearToDate(slips, socialSecurityBySlipId, slip, currentItems);
}
