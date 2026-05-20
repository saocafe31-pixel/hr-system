import { eachCalendarYmdInclusive } from '@/lib/leaveLateRules';
import { dateToBangkokYmd, dateYmdToIsoBangkokEnd, dateYmdToIsoBangkokStart } from '@/lib/taskHelpers';
import type { WorkScheduleRow } from '@/lib/types';

/** แถวสรุปมาสายจริง — เทียบเวลา check_in กับเวลาเริ่มตามตาราง */
export type LateActualFromScheduleRow = {
  id: string;
  work_date: string;
  /** นาทีสายสุทธิหลังหักสิทธิ์ขอเข้าสายแล้ว */
  minutes_late: number;
  /** นาทีสายจากเวลาเข้างานจริงก่อนหักสิทธิ์ */
  actual_late_minutes: number;
  plan_start_at: string;
  check_in_at: string;
  /** เวลาเข้างานหลังหักสิทธิ์ขอเข้าสาย ใช้เทียบกับเวลาเริ่มงาน */
  adjusted_check_in_at: string;
  /** ชื่อกะ (มอบหมายรายวัน) หรือหัวข้อตารางงานแบบ legacy */
  plan_label: string | null;
  source: 'assignment' | 'legacy';
  /** รวมนาทีจากคำขอเข้าสาย (`late_requests`) ในวัน work_date เดียวกัน — 0 = ไม่มีคำขอ */
  late_request_minutes: number;
  /** นาทีที่ขอ − สายจริง (บวก = สิทธิ์เกินเทียบสายจริง, ลบ = สายเกินสิทธิ์) */
  rights_minus_actual_minutes: number;
};

export type AssignmentWithShiftTimes = {
  id: string;
  work_date: string;
  work_shifts: {
    name: string;
    start_time: string;
    end_time: string;
  } | null;
};

function normalizeTimeHhMmSs(raw: string): string {
  const t = raw.trim();
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(t);
  if (!m) return '09:00:00';
  const h = String(Number(m[1])).padStart(2, '0');
  const min = m[2].padStart(2, '0');
  const sec = (m[3] ?? '00').padStart(2, '0');
  return `${h}:${min}:${sec}`;
}

/** เวลาเริ่มกะตาม work_date + start_time ใน Asia/Bangkok (+07) */
export function bangkokShiftStartMs(workDateYmd: string, startTimeRaw: string): number {
  const time = normalizeTimeHhMmSs(startTimeRaw);
  return new Date(`${workDateYmd}T${time}+07:00`).getTime();
}

function earliestCheckInMsByBangkokYmd(
  checkIns: { created_at: string }[]
): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of checkIns) {
    const ymd = dateToBangkokYmd(new Date(c.created_at));
    const t = new Date(c.created_at).getTime();
    const prev = m.get(ymd);
    if (prev === undefined || t < prev) m.set(ymd, t);
  }
  return m;
}

function minutesLateFloor(planMs: number, checkMs: number): number {
  const diff = checkMs - planMs;
  if (diff <= 0) return 0;
  return Math.floor(diff / 60000);
}

/** ตารางงานแบบ legacy ที่ครอบคลุมเที่ยงวันของ workYmd ในเขตไทย — ใช้ start_at ที่เร็วที่สุด */
function legacyPlanStartIsoForDay(
  workYmd: string,
  schedules: WorkScheduleRow[]
): string | null {
  const noonMs = new Date(`${workYmd}T12:00:00+07:00`).getTime();
  let bestIso: string | null = null;
  let bestStart = Infinity;
  for (const w of schedules) {
    const s = new Date(w.start_at).getTime();
    const e = new Date(w.end_at).getTime();
    if (!(s <= noonMs && e >= noonMs)) continue;
    if (s < bestStart) {
      bestStart = s;
      bestIso = w.start_at;
    }
  }
  return bestIso;
}

export type ComputeLateParams = {
  startYmd: string;
  endYmd: string;
  assignments: AssignmentWithShiftTimes[];
  legacySchedules: WorkScheduleRow[];
  checkIns: { created_at: string }[];
  /** รวมนาทีที่ขอมาสายต่อวัน (work_date → ผลรวม minutes_late) */
  lateRequestMinutesByYmd?: Map<string, number>;
};

/**
 * คำนวณนาทีสายจากการเข้างานจริง (check-in แรกของวันในเขต Bangkok)
 * โดยหักนาทีจากคำขอเข้าสายของวันนั้นก่อน แล้วจึงเทียบกับเวลาเริ่มงาน
 * เทียบกับเวลาเริ่มจาก work_schedule_assignments + work_shifts
 * ถ้าไม่มีมอบหมายรายวัน แต่มี work_schedules ที่ครอบวันนั้น — ใช้ start_at ของตารางนั้น
 */
export function computeLateFromAttendanceData(
  params: ComputeLateParams
): LateActualFromScheduleRow[] {
  const {
    startYmd,
    endYmd,
    assignments,
    legacySchedules,
    checkIns,
    lateRequestMinutesByYmd = new Map<string, number>(),
  } = params;
  const byYmd = earliestCheckInMsByBangkokYmd(checkIns);
  const rows: LateActualFromScheduleRow[] = [];
  const daysWithAssignment = new Set<string>();

  function lateReqMins(ymd: string): number {
    return lateRequestMinutesByYmd.get(ymd) ?? 0;
  }

  for (const a of assignments) {
    daysWithAssignment.add(a.work_date);
    const ws = a.work_shifts;
    if (!ws) continue;
    const planMs = bangkokShiftStartMs(a.work_date, ws.start_time);
    const checkMs = byYmd.get(a.work_date);
    if (checkMs === undefined) continue;
    const req = lateReqMins(a.work_date);
    const actualMins = minutesLateFloor(planMs, checkMs);
    const adjustedCheckMs = checkMs - req * 60000;
    const mins = minutesLateFloor(planMs, adjustedCheckMs);
    if (mins < 1) continue;
    rows.push({
      id: `${a.id}-asn`,
      work_date: a.work_date,
      minutes_late: mins,
      actual_late_minutes: actualMins,
      plan_start_at: new Date(planMs).toISOString(),
      check_in_at: new Date(checkMs).toISOString(),
      adjusted_check_in_at: new Date(adjustedCheckMs).toISOString(),
      plan_label: ws.name ?? null,
      source: 'assignment',
      late_request_minutes: req,
      rights_minus_actual_minutes: req - actualMins,
    });
  }

  const days = eachCalendarYmdInclusive(startYmd, endYmd);
  for (const d of days) {
    if (daysWithAssignment.has(d)) continue;
    const planIso = legacyPlanStartIsoForDay(d, legacySchedules);
    if (!planIso) continue;
    const planMs = new Date(planIso).getTime();
    const checkMs = byYmd.get(d);
    if (checkMs === undefined) continue;
    const sch = legacySchedules.find((w) => w.start_at === planIso);
    const req = lateReqMins(d);
    const actualMins = minutesLateFloor(planMs, checkMs);
    const adjustedCheckMs = checkMs - req * 60000;
    const mins = minutesLateFloor(planMs, adjustedCheckMs);
    if (mins < 1) continue;
    rows.push({
      id: `${d}-legacy`,
      work_date: d,
      minutes_late: mins,
      actual_late_minutes: actualMins,
      plan_start_at: planIso,
      check_in_at: new Date(checkMs).toISOString(),
      adjusted_check_in_at: new Date(adjustedCheckMs).toISOString(),
      plan_label: sch?.title?.trim() || 'ตารางงาน',
      source: 'legacy',
      late_request_minutes: req,
      rights_minus_actual_minutes: req - actualMins,
    });
  }

  rows.sort((a, b) => {
    const cmp = b.work_date.localeCompare(a.work_date);
    if (cmp !== 0) return cmp;
    return b.check_in_at.localeCompare(a.check_in_at);
  });
  return rows;
}

/** ช่วง ISO สำหรับ query attendance_logs / work_schedules ทับรอบ payroll */
export function payrollPeriodCheckInIsoRange(
  startYmd: string,
  endYmd: string
): { fromIso: string; toIso: string } {
  const fromIso = dateYmdToIsoBangkokStart(startYmd);
  const toIso = dateYmdToIsoBangkokEnd(endYmd);
  return {
    fromIso: fromIso ?? `${startYmd}T00:00:00.000+07:00`,
    toIso: toIso ?? `${endYmd}T23:59:59.999+07:00`,
  };
}
