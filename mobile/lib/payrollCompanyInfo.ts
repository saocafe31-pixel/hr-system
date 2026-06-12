import { supabase } from '@/lib/supabase';

export const PAYROLL_COMPANY_INFO_KEY = 'payroll_company_info';

export type PayrollCompanyInfo = {
  name: string;
  addressLines: string[];
  juristicId: string;
};

export const emptyPayrollCompanyInfo: PayrollCompanyInfo = {
  name: '',
  addressLines: [],
  juristicId: '',
};

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function parsePayrollCompanyInfo(raw: unknown): PayrollCompanyInfo {
  if (!raw || typeof raw !== 'object') return emptyPayrollCompanyInfo;
  const obj = raw as Record<string, unknown>;
  const rawAddressLines = obj.address_lines ?? obj.addressLines;
  const addressLines = Array.isArray(rawAddressLines)
    ? rawAddressLines.map(cleanText).filter(Boolean)
    : cleanText(rawAddressLines)
      ? [cleanText(rawAddressLines)]
      : [];

  return {
    name: cleanText(obj.name),
    addressLines,
    juristicId: cleanText(obj.juristic_id ?? obj.juristicId),
  };
}

export async function loadPayrollCompanyInfo(): Promise<PayrollCompanyInfo> {
  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', PAYROLL_COMPANY_INFO_KEY)
    .maybeSingle();
  if (error) throw error;
  return parsePayrollCompanyInfo(data?.value);
}
