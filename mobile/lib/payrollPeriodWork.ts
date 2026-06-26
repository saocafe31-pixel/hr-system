import { bangkokPayrollPeriodBounds, payrollCycleEndYMFromBangkokDate } from '@/lib/leaveLateRules';
import {
  buildAssignmentByUserDate,
  buildHolidayByUserDate,
  resolvedScheduleDayStatusForUser,
  type ScheduleDayStatus,
} from '@/lib/scheduleDayResolution';
import { calculateBreakMinutes, calculateWorkMinutes } from '@/lib/attendanceDurations';
import { roundMoney } from '@/lib/payroll';
import type { EmployeeHolidayDateRow, WorkScheduleAssignmentRow } from '@/lib/types';

export type PayrollPayMode = 'monthly' | 'daily' | 'hourly';

/** ข้อความในคอลัมน์หมายเหตุตารางเวลาเข้า-ออก */
export const PAYROLL_ABSENCE_NOTE_TABLE =
  'ขาดงาน (มีตารางแต่ไม่มีเวลาเข้างาน — อาจถูกหักใน Payroll รายเดือน)';

export const PAYROLL_ABSENCE_NOTE_DETAIL =
  'ระบบบันทึกว่าวันนี้มีตารางเข้างานแต่ไม่มีการลาอนุมัติและไม่พบเวลาเข้างาน — อาจถูกนำไปหักขาดงานเมื่อทำ Payroll';

export const PAYROLL_ABSENCE_NOTE_ADMIN =
  'ตรวจสอบ: วันนี้มีตารางแต่ไม่พบเวลาเข้างานและไม่มีลาอนุมัติ — อาจถูกหักขาดงานใน Payroll';

export const PAYROLL_ABSENCE_DISPUTE_HINT =
  'หากข้อมูลไม่ถูกต้อง แจ้ง HR/แอดมินผ่านแชทเข้า-ออกหรือหน้าทีม';

export type PeriodWorkMetrics = {
  /** วันมอบหมายในตาราง (กะ + วันหยุดที่มอบหมาย) — ไม่รวมวันลาไม่รับเงิน · โหมดรายวัน */
  scheduledWorkDayCount: number;
  /** วันขาดงาน: มีตาราง ไม่มีลาอนุมัติ ไม่มี check-in — หักเฉพาะโหมดรายเดือน */
  absenceDayCount: number;
  /** ชั่วโมงทำงานจริงจาก check-in/out (หักพัก) — ให้ตรงตารางเข้า-ออก */
  workHours: number;
};

/** วันมอบหมายในรอบ payroll (กะหรือวันหยุดพนักงาน) ไม่นับวันหยุดบริษัท */
export function isPayrollAssignedScheduleDay(
  status: ScheduleDayStatus | null,
  isCompanyHoliday: boolean
): boolean {
  if (isCompanyHoliday || !status) return false;
  return status === 'work' || status === 'holiday';
}

export function listYmdRange(startYmd: string, endYmd: string): string[] {
  const out: string[] = [];
  const start = new Date(`${startYmd}T12:00:00`);
  const end = new Date(`${endYmd}T12:00:00`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start > end) {
    return out;
  }
  const cursor = new Date(start);
  while (cursor <= end) {
    const y = cursor.getFullYear();
    const m = String(cursor.getMonth() + 1).padStart(2, '0');
    const d = String(cursor.getDate()).padStart(2, '0');
    out.push(`${y}-${m}-${d}`);
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

function ymdInLeaveRange(ymd: string, startsOn: string, endsOn: string): boolean {
  return ymd >= startsOn.slice(0, 10) && ymd <= endsOn.slice(0, 10);
}

const bangkokYmdFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bangkok',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function bangkokYmdFromIso(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '';
  const parts = bangkokYmdFormatter.formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  return year && month && day ? `${year}-${month}-${day}` : '';
}

export function bangkokYmdToday(): string {
  return bangkokYmdFromIso(new Date().toISOString());
}

/** รอบ Payroll 26–25 จากวันที่อ้างอิง (สอดคล้อง cycle key ใน Payroll) */
export function payrollPeriodFromAnchorDate(
  anchor: Date
): { startYmd: string; endYmd: string } {
  const { y, m } = payrollCycleEndYMFromBangkokDate(anchor);
  return bangkokPayrollPeriodBounds(y, m);
}

/** รอบ Payroll 26–25 ที่สิ้นสุดวันที่ 25 ของเดือนปฏิทิน (year, month) */
export function payrollPeriodForCalendarMonth(
  year: number,
  month: number
): { startYmd: string; endYmd: string } {
  return bangkokPayrollPeriodBounds(year, month);
}

export function mergeYmdBounds(
  ...ranges: Array<{ startYmd: string; endYmd: string }>
): { startYmd: string; endYmd: string } {
  if (ranges.length === 0) return { startYmd: '', endYmd: '' };
  let startYmd = ranges[0].startYmd;
  let endYmd = ranges[0].endYmd;
  for (let i = 1; i < ranges.length; i++) {
    if (ranges[i].startYmd < startYmd) startYmd = ranges[i].startYmd;
    if (ranges[i].endYmd > endYmd) endYmd = ranges[i].endYmd;
  }
  return { startYmd, endYmd };
}

export function buildCheckInByDateFromLogs(
  logs: Array<{ kind: string; created_at: string }>
): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of logs) {
    if (row.kind !== 'check_in') continue;
    const ymd = bangkokYmdFromIso(row.created_at);
    if (!ymd) continue;
    const current = map.get(ymd);
    if (!current || new Date(row.created_at).getTime() < new Date(current).getTime()) {
      map.set(ymd, row.created_at);
    }
  }
  return map;
}

function buildAttendanceLogsByDate(
  logs: Array<{ kind: string; created_at: string }>
): Map<string, Array<{ kind: string; created_at: string }>> {
  const map = new Map<string, Array<{ kind: string; created_at: string }>>();
  for (const row of logs) {
    const ymd = bangkokYmdFromIso(row.created_at);
    if (!ymd) continue;
    const bucket = map.get(ymd) ?? [];
    bucket.push(row);
    map.set(ymd, bucket);
  }
  return map;
}

/** วันขาดงานตามกฎ Payroll — เฉพาะวันที่ผ่านมาแล้ว (ymd < asOfYmd) */
export function buildAbsenceDateSet(params: {
  userId: string;
  startYmd: string;
  endYmd: string;
  asOfYmd: string;
  assignments: Pick<WorkScheduleAssignmentRow, 'user_id' | 'work_date' | 'created_at'>[];
  employeeHolidays: EmployeeHolidayDateRow[];
  companyHolidayDates: Set<string>;
  approvedLeaves: Array<{ starts_on: string; ends_on: string; leave_type?: string }>;
  checkInByDate: Map<string, string>;
}): Set<string> {
  const {
    userId,
    startYmd,
    endYmd,
    asOfYmd,
    assignments,
    employeeHolidays,
    companyHolidayDates,
    approvedLeaves,
    checkInByDate,
  } = params;

  const holidayByUserDate = buildHolidayByUserDate(employeeHolidays);
  const assignmentByUserDate = buildAssignmentByUserDate(assignments);
  const out = new Set<string>();

  for (const ymd of listYmdRange(startYmd, endYmd)) {
    if (ymd >= asOfYmd) continue;
    if (companyHolidayDates.has(ymd)) continue;

    const status = resolvedScheduleDayStatusForUser(
      userId,
      ymd,
      holidayByUserDate,
      assignmentByUserDate
    );
    if (status !== 'work') continue;

    const onApprovedLeave = approvedLeaves.some((leave) =>
      ymdInLeaveRange(ymd, leave.starts_on, leave.ends_on)
    );
    if (onApprovedLeave) continue;

    if (!checkInByDate.get(ymd)) {
      out.add(ymd);
    }
  }

  return out;
}

/** ฐานเงินเดือน ÷ 30 → รายวัน, รายวัน ÷ 8 → รายชั่วโมง */
export function deriveRatesFromMonthlySalary(monthlySalary: number): {
  daily_rate: number;
  hourly_rate: number;
} {
  const monthly = Math.max(0, monthlySalary);
  const daily_rate = roundMoney(monthly / 30);
  const hourly_rate = roundMoney(daily_rate / 8);
  return { daily_rate, hourly_rate };
}

export function computePeriodWorkMetrics(params: {
  userId: string;
  startYmd: string;
  endYmd: string;
  /** นับขาดงานเฉพาะวันที่ผ่านมาแล้ว (ymd < asOfYmd) — ค่าเริ่มต้นวันนี้ กรุงเทพ */
  asOfYmd?: string;
  assignments: Pick<WorkScheduleAssignmentRow, 'user_id' | 'work_date' | 'created_at'>[];
  employeeHolidays: EmployeeHolidayDateRow[];
  companyHolidayDates: Set<string>;
  approvedLeaves: Array<{ starts_on: string; ends_on: string; leave_type?: string }>;
  checkInByDate: Map<string, string>;
  checkOutByDate: Map<string, string>;
  /** บันทึกเข้า-ออกทั้งหมดในช่วง — ใช้หักพักให้ตรงตารางทีม */
  attendanceLogs?: Array<{ kind: string; created_at: string }>;
}): PeriodWorkMetrics {
  const {
    userId,
    startYmd,
    endYmd,
    asOfYmd = bangkokYmdToday(),
    assignments,
    employeeHolidays,
    companyHolidayDates,
    approvedLeaves,
    checkInByDate,
    checkOutByDate,
    attendanceLogs = [],
  } = params;

  const holidayByUserDate = buildHolidayByUserDate(employeeHolidays);
  const assignmentByUserDate = buildAssignmentByUserDate(assignments);
  const logsByDate = buildAttendanceLogsByDate(attendanceLogs);

  let scheduledWorkDayCount = 0;
  let workHours = 0;

  for (const ymd of listYmdRange(startYmd, endYmd)) {
    const isCompanyHoliday = companyHolidayDates.has(ymd);
    const status = resolvedScheduleDayStatusForUser(
      userId,
      ymd,
      holidayByUserDate,
      assignmentByUserDate
    );

    const onUnpaidLeave = approvedLeaves.some(
      (leave) =>
        leave.leave_type === 'unpaid' && ymdInLeaveRange(ymd, leave.starts_on, leave.ends_on)
    );
    const onApprovedLeave = approvedLeaves.some((leave) =>
      ymdInLeaveRange(ymd, leave.starts_on, leave.ends_on)
    );

    if (isPayrollAssignedScheduleDay(status, isCompanyHoliday) && !onUnpaidLeave) {
      scheduledWorkDayCount += 1;
    }

    if (onApprovedLeave) continue;

    const checkIn = checkInByDate.get(ymd);
    const checkOut = checkOutByDate.get(ymd);
    if (checkIn && checkOut) {
      const dayLogs = logsByDate.get(ymd) ?? [];
      const breakMinutes = calculateBreakMinutes(dayLogs, checkOut);
      const workMinutes = calculateWorkMinutes(checkIn, checkOut, breakMinutes);
      workHours += workMinutes / 60;
    }
  }

  const absenceDayCount = buildAbsenceDateSet({
    userId,
    startYmd,
    endYmd,
    asOfYmd,
    assignments,
    employeeHolidays,
    companyHolidayDates,
    approvedLeaves,
    checkInByDate,
  }).size;

  return {
    scheduledWorkDayCount,
    absenceDayCount,
    workHours: Math.round(workHours * 100) / 100,
  };
}

export function payModeLabelTh(mode: PayrollPayMode): string {
  if (mode === 'daily') return 'ค่าจ้างรายวัน';
  if (mode === 'hourly') return 'ค่าจ้างรายชั่วโมง';
  return 'ฐานเงินเดือน (รายเดือน)';
}
