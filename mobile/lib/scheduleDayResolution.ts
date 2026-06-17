import { supabase } from '@/lib/supabase';
import type { EmployeeHolidayDateRow, WorkScheduleAssignmentRow } from '@/lib/types';

export type ScheduleDayStatus = 'work' | 'holiday';

type UserDatePair = { user_id: string; date: string };

function pairKey(userId: string, ymd: string): string {
  return `${userId}:${ymd}`;
}

function uniqueUserDatePairs(pairs: UserDatePair[]): UserDatePair[] {
  return [...new Map(pairs.map((p) => [pairKey(p.user_id, p.date), p])).values()];
}

/** วันหยุด vs มอบหมายกะ — อันไหน created_at ใหม่กว่าให้ชนะ */
export function resolveScheduleDayStatus(
  assignmentCreatedAt: string | null | undefined,
  holidayCreatedAt: string | null | undefined
): ScheduleDayStatus {
  if (!holidayCreatedAt) return 'work';
  if (!assignmentCreatedAt) return 'holiday';
  return new Date(holidayCreatedAt).getTime() >= new Date(assignmentCreatedAt).getTime()
    ? 'holiday'
    : 'work';
}

export function buildHolidayByUserDate(
  rows: EmployeeHolidayDateRow[],
  visibleUserIds?: Set<string>
): Map<string, EmployeeHolidayDateRow> {
  const map = new Map<string, EmployeeHolidayDateRow>();
  for (const row of rows) {
    if (visibleUserIds && !visibleUserIds.has(row.user_id)) continue;
    map.set(pairKey(row.user_id, row.holiday_date), row);
  }
  return map;
}

export function buildAssignmentByUserDate<
  T extends Pick<WorkScheduleAssignmentRow, 'user_id' | 'work_date' | 'created_at'>,
>(rows: T[], visibleUserIds?: Set<string>): Map<string, T> {
  const map = new Map<string, T>();
  for (const row of rows) {
    if (visibleUserIds && !visibleUserIds.has(row.user_id)) continue;
    map.set(pairKey(row.user_id, row.work_date), row);
  }
  return map;
}

export function resolvedScheduleDayStatusForUser(
  userId: string,
  ymd: string,
  holidayByUserDate: Map<string, EmployeeHolidayDateRow>,
  assignmentByUserDate: Map<string, Pick<WorkScheduleAssignmentRow, 'created_at'>>
): ScheduleDayStatus | null {
  const hol = holidayByUserDate.get(pairKey(userId, ymd));
  const asn = assignmentByUserDate.get(pairKey(userId, ymd));
  if (!hol && !asn) return null;
  return resolveScheduleDayStatus(asn?.created_at, hol?.created_at);
}

export async function deleteScheduleAssignmentsForPairs(
  pairs: Array<{ user_id: string; work_date: string }>
): Promise<void> {
  const unique = uniqueUserDatePairs(
    pairs.map((p) => ({ user_id: p.user_id, date: p.work_date }))
  );
  if (unique.length === 0) return;
  const chunkSize = 25;
  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    const orFilter = chunk
      .map((p) => `and(user_id.eq.${p.user_id},work_date.eq.${p.date})`)
      .join(',');
    const { error } = await supabase.from('work_schedule_assignments').delete().or(orFilter);
    if (error) throw error;
  }
}

export async function deleteEmployeeHolidayDatesForPairs(
  pairs: Array<{ user_id: string; holiday_date: string }>
): Promise<void> {
  const unique = uniqueUserDatePairs(
    pairs.map((p) => ({ user_id: p.user_id, date: p.holiday_date }))
  );
  if (unique.length === 0) return;
  const chunkSize = 25;
  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    const orFilter = chunk
      .map((p) => `and(user_id.eq.${p.user_id},holiday_date.eq.${p.date})`)
      .join(',');
    const { error } = await supabase.from('employee_holiday_dates').delete().or(orFilter);
    if (error) throw error;
  }
}
