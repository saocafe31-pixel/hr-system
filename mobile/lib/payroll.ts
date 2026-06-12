import { ymdToDayIndex } from '@/lib/leaveLateRules';

export const SOCIAL_SECURITY_BASE_CAP = 17_500;
export const SOCIAL_SECURITY_RATE = 0.05;
export const LATE_DEDUCTION_BAHT_PER_MINUTE = 1;

export function money(n: number): string {
  return n.toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function parseMoneyInput(raw: string): number {
  const n = Number(raw.replace(/,/g, '').trim() || 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function roundMoney(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

export function socialSecurityAuto(baseSalary: number): number {
  return roundMoney(Math.min(Math.max(0, baseSalary), SOCIAL_SECURITY_BASE_CAP) * SOCIAL_SECURITY_RATE);
}

export function withholdingTaxMonthly(taxableMonthlyIncome: number): number {
  const salaryYear = Math.max(0, taxableMonthlyIncome) * 12;
  const expenses = Math.min(100_000, salaryYear * 0.5);
  const deduction = 60_000 + 9_000;
  const netIncome = Math.max(0, salaryYear - expenses - deduction);
  let taxYear = 0;
  if (netIncome <= 150_000) {
    taxYear = 0;
  } else if (netIncome <= 300_000) {
    taxYear = (netIncome - 150_000) * 0.05;
  } else if (netIncome <= 500_000) {
    taxYear = (netIncome - 300_000) * 0.1 + 7_500;
  } else if (netIncome <= 750_000) {
    taxYear = (netIncome - 500_000) * 0.15 + 27_500;
  } else if (netIncome <= 1_000_000) {
    taxYear = (netIncome - 750_000) * 0.2 + 65_000;
  } else {
    taxYear = (netIncome - 1_000_000) * 0.25 + 115_000;
  }
  return roundMoney(Math.max(0, taxYear / 12));
}

export function overlapDaysInclusive(
  rowStartYmd: string,
  rowEndYmd: string,
  periodStartYmd: string,
  periodEndYmd: string
): number {
  const start = Math.max(ymdToDayIndex(rowStartYmd), ymdToDayIndex(periodStartYmd));
  const end = Math.min(ymdToDayIndex(rowEndYmd), ymdToDayIndex(periodEndYmd));
  if (Number.isNaN(start) || Number.isNaN(end) || start > end) return 0;
  return end - start + 1;
}
