import { supabase } from '@/lib/supabase';
import type { CompanyHolidayDateRow } from '@/lib/types';

const COMPANY_HOLIDAY_SELECT =
  'id, holiday_date, title, description, created_by, created_at, updated_at';

export async function fetchCompanyHolidayDates(options?: {
  startYmd?: string;
  endYmd?: string;
}): Promise<CompanyHolidayDateRow[]> {
  let query = supabase
    .from('company_holiday_dates')
    .select(COMPANY_HOLIDAY_SELECT)
    .order('holiday_date', { ascending: true });
  if (options?.startYmd) query = query.gte('holiday_date', options.startYmd);
  if (options?.endYmd) query = query.lte('holiday_date', options.endYmd);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as CompanyHolidayDateRow[];
}

export function companyHolidayMapByDate(
  rows: CompanyHolidayDateRow[]
): Map<string, CompanyHolidayDateRow> {
  const map = new Map<string, CompanyHolidayDateRow>();
  for (const row of rows) map.set(row.holiday_date, row);
  return map;
}
