/** โควตาและกฎลา/สาย (สอดคล้องกับ UI + ฝั่งแอป — ควรตรวจซ้ำที่เซิร์ฟเวอร์ถ้าต้องการความเข้มงวดสูงสุด) */

export const SICK_ANNUAL_DAYS = 30;
export const PERSONAL_ANNUAL_DAYS = 7;
export const LATE_MAX_MINUTES = 30;
export const LATE_MAX_PER_MONTH = 2;

export function currentYearBangkok(): number {
  return Number(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric',
    }).format(new Date())
  );
}

/** ช่วง YYYY-MM-DD ของเดือนปฏิทินกรุงเทพ */
export function bangkokMonthYmdRange(d = new Date()): { lo: string; hi: string } {
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
  const [y, mo] = ymd.split('-').map(Number);
  const lastD = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const lo = `${y}-${String(mo).padStart(2, '0')}-01`;
  const hi = `${y}-${String(mo).padStart(2, '0')}-${String(lastD).padStart(2, '0')}`;
  return { lo, hi };
}

function currentBangkokYmd(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/** วันที่ปฏิทินในเขต Asia/Bangkok (สำหรับคำนวณรอบ 26–25) */
export function bangkokCalendarParts(d = new Date()): { y: number; m: number; day: number } {
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
  const [y, mo, da] = ymd.split('-').map(Number);
  return { y, m: mo, day: da };
}

/**
 * รอบเดือนเงินเดือนแบบ 26 ก่อน – 25 เดือนถัดไป (สิ้นสุดวันที่ 25 ของเดือน `m`)
 * ถ้าวันที่ปัจจุบัน ≥ 26 → อยู่ในรอบที่สิ้นสุดเดือนถัดไปจากเดือนปฏิทินปัจจุบัน
 */
export function payrollCycleEndYMFromBangkokDate(d = new Date()): { y: number; m: number } {
  const { y, m, day } = bangkokCalendarParts(d);
  if (day >= 26) {
    if (m === 12) return { y: y + 1, m: 1 };
    return { y, m: m + 1 };
  }
  return { y, m };
}

/** คีย์รอบเดือน `YYYY-MM` = เดือนที่มีวันที่ 25 เป็นวันสิ้นสุดรอบ */
export function payrollCycleKeyFromBangkokDate(d = new Date()): string {
  const { y, m } = payrollCycleEndYMFromBangkokDate(d);
  return `${y}-${String(m).padStart(2, '0')}`;
}

export function parsePayrollCycleKey(key: string): { y: number; m: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(key.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || mo < 1 || mo > 12) return null;
  return { y, m: mo };
}

/** ช่วง work_date ของรอบที่สิ้นสุดวันที่ 25 ของเดือน endMonth/endYear */
export function bangkokPayrollPeriodBounds(
  endYear: number,
  endMonth: number
): { startYmd: string; endYmd: string } {
  const endYmd = `${endYear}-${String(endMonth).padStart(2, '0')}-25`;
  let sy = endYear;
  let sm = endMonth - 1;
  if (sm < 1) {
    sm = 12;
    sy -= 1;
  }
  const startYmd = `${sy}-${String(sm).padStart(2, '0')}-26`;
  return { startYmd, endYmd };
}

/** รอบโควต้าขอเข้าสาย 26 เดือนก่อนหน้า – 25 เดือนปัจจุบัน ตาม work_date */
export function lateQuotaPeriodBoundsFromWorkYmd(workYmd: string): { lo: string; hi: string } {
  const parts = workYmd.trim().split('-');
  const y = Number(parts[0]);
  const mo = Number(parts[1]);
  const day = Number(parts[2]);
  if (
    !Number.isFinite(y) ||
    !Number.isFinite(mo) ||
    !Number.isFinite(day) ||
    mo < 1 ||
    mo > 12 ||
    day < 1 ||
    day > 31
  ) {
    return { lo: workYmd, hi: workYmd };
  }
  const end =
    day >= 26
      ? payrollCycleEndYMFromBangkokDate(new Date(Date.UTC(y, mo - 1, day, 12)))
      : { y, m: mo };
  const { startYmd, endYmd } = bangkokPayrollPeriodBounds(end.y, end.m);
  return { lo: startYmd, hi: endYmd };
}

export function currentLateQuotaPeriodBounds(d = new Date()): { lo: string; hi: string } {
  return lateQuotaPeriodBoundsFromWorkYmd(currentBangkokYmd(d));
}

/** รายการคีย์รอบย้อนหลังจากวันที่อ้างอิง (เรียงจากรอบล่าสุดก่อน) */
export function listPayrollCycleKeysDescending(count: number, d = new Date()): string[] {
  let { y, m } = payrollCycleEndYMFromBangkokDate(d);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m -= 1;
    if (m < 1) {
      m = 12;
      y -= 1;
    }
  }
  return out;
}

function formatYmdThShort(ymd: string): string {
  const p = ymd.trim().split('-').map(Number);
  if (p.length !== 3 || p.some((n) => !Number.isFinite(n))) return ymd;
  const [yy, mo, dd] = p;
  const dt = new Date(Date.UTC(yy, mo - 1, dd));
  try {
    return new Intl.DateTimeFormat('th-TH', {
      day: 'numeric',
      month: 'short',
      timeZone: 'Asia/Bangkok',
    }).format(dt);
  } catch {
    return ymd;
  }
}

/** แสดงช่วงรอบ เช่น "26 เม.ย. – 25 พ.ค." */
export function formatPayrollPeriodRangeTh(startYmd: string, endYmd: string): string {
  return `${formatYmdThShort(startYmd)} – ${formatYmdThShort(endYmd)}`;
}

/** ป้ายสั้นสำหรับชิปเลือกรอบ (เดือนสิ้นสุดรอบ) */
export function formatPayrollCycleChipTh(cycleKey: string): string {
  const parsed = parsePayrollCycleKey(cycleKey);
  if (!parsed) return cycleKey;
  const endYmd = `${parsed.y}-${String(parsed.m).padStart(2, '0')}-25`;
  try {
    const [yy, mo, dd] = endYmd.split('-').map(Number);
    const dt = new Date(Date.UTC(yy, mo - 1, dd));
    return new Intl.DateTimeFormat('th-TH', {
      month: 'short',
      year: 'numeric',
      timeZone: 'Asia/Bangkok',
    }).format(dt);
  } catch {
    return cycleKey;
  }
}

/** ช่วงเดือนของวันที่ทำงาน workYmd (YYYY-MM-DD) */
export function monthBoundsFromWorkYmd(workYmd: string): { lo: string; hi: string } {
  const parts = workYmd.trim().split('-');
  const y = Number(parts[0]);
  const mo = Number(parts[1]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || mo < 1 || mo > 12) {
    return { lo: workYmd, hi: workYmd };
  }
  const lastD = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const lo = `${y}-${String(mo).padStart(2, '0')}-01`;
  const hi = `${y}-${String(mo).padStart(2, '0')}-${String(lastD).padStart(2, '0')}`;
  return { lo, hi };
}

export type LeaveType = 'sick' | 'personal' | 'vacation';

export type LeaveInterval = { starts_on: string; ends_on: string };

/** แปลง YYYY-MM-DD เป็นดัชนีวัน (UTC) เพื่อไม่ให้ timezone เลื่อนวัน */
export function eachCalendarYmdInclusive(start: string, end: string): string[] {
  const a = ymdToDayIndex(start);
  const b = ymdToDayIndex(end);
  if (Number.isNaN(a) || Number.isNaN(b) || a > b) return [];
  const out: string[] = [];
  for (let i = a; i <= b; i++) {
    const u = new Date(i * 86400000);
    const y = u.getUTCFullYear();
    const mo = u.getUTCMonth() + 1;
    const d = u.getUTCDate();
    out.push(`${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  }
  return out;
}

export function ymdToDayIndex(ymd: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return NaN;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  return Math.floor(Date.UTC(y, mo - 1, d) / 86400000);
}

export function inclusiveCalendarDays(startYmd: string, endYmd: string): number {
  const a = ymdToDayIndex(startYmd);
  const b = ymdToDayIndex(endYmd);
  if (Number.isNaN(a) || Number.isNaN(b) || a > b) return 0;
  return b - a + 1;
}

/** ลาป่วยติดกันเกิน 2 วัน (นับเป็นวันปฏิทิน ≥ 3 วัน) → ต้องมีใบรับรองแพทย์ */
export function sickNeedsMedicalCertificate(
  startsOn: string,
  endsOn: string
): boolean {
  return inclusiveCalendarDays(startsOn, endsOn) > 2;
}

/**
 * ลากิจแนว B: ถ้าช่วงลาติดกันรวมกับลากิจที่อนุมัติแล้ว (โอเวอร์แลปหรือชิดกัน)
 * เกิน 2 วันปฏิทิน (≥ 3 วันรวม) → ต้องมีเหตุผลเพิ่ม + แนะนำแนบเอกสาร
 */
function intervalsTouchOrOverlap(a: LeaveInterval, b: LeaveInterval): boolean {
  const as = ymdToDayIndex(a.starts_on);
  const ae = ymdToDayIndex(a.ends_on);
  const bs = ymdToDayIndex(b.starts_on);
  const be = ymdToDayIndex(b.ends_on);
  if ([as, ae, bs, be].some((n) => Number.isNaN(n))) return false;
  return as <= be + 1 && bs <= ae + 1;
}

export function personalChainInclusiveDays(
  approvedPersonal: LeaveInterval[],
  newStart: string,
  newEnd: string
): number {
  const intervals: LeaveInterval[] = [
    ...approvedPersonal.map((x) => ({
      starts_on: x.starts_on,
      ends_on: x.ends_on,
    })),
    { starts_on: newStart, ends_on: newEnd },
  ];
  const n = intervals.length;
  const newIdx = n - 1;
  const seen = new Set<number>();
  const q: number[] = [];
  for (let i = 0; i < n; i++) {
    if (intervalsTouchOrOverlap(intervals[newIdx], intervals[i])) {
      seen.add(i);
      q.push(i);
    }
  }
  let minS = Infinity;
  let maxE = -Infinity;
  while (q.length > 0) {
    const i = q.pop()!;
    const o = intervals[i];
    const s = ymdToDayIndex(o.starts_on);
    const e = ymdToDayIndex(o.ends_on);
    if (!Number.isNaN(s)) minS = Math.min(minS, s);
    if (!Number.isNaN(e)) maxE = Math.max(maxE, e);
    for (let j = 0; j < n; j++) {
      if (seen.has(j)) continue;
      if (intervalsTouchOrOverlap(o, intervals[j])) {
        seen.add(j);
        q.push(j);
      }
    }
  }
  if (!Number.isFinite(minS) || !Number.isFinite(maxE) || minS > maxE) return 0;
  return maxE - minS + 1;
}

export function personalNeedsExtraReasonAndDoc(
  approvedPersonal: LeaveInterval[],
  newStart: string,
  newEnd: string
): boolean {
  return personalChainInclusiveDays(approvedPersonal, newStart, newEnd) > 2;
}

const SUPPLEMENTARY_NOTE_MIN = 10;

export function supplementaryNoteOk(note: string | null | undefined): boolean {
  return (note ?? '').trim().length >= SUPPLEMENTARY_NOTE_MIN;
}

/** รวมวันลาในปี (นับวันปฏิทินต่อช่วงหลังตัดให้อยู่ในปี) เฉพาะที่อนุมัติ */
export function sumLeaveDaysInYear(
  rows: { leave_type: LeaveType; starts_on: string; ends_on: string; status: string }[],
  year: number,
  type: LeaveType
): number {
  const yStart = `${year}-01-01`;
  const yEnd = `${year}-12-31`;
  let sum = 0;
  for (const r of rows) {
    if (r.status !== 'approved' || r.leave_type !== type) continue;
    const clipStart = r.starts_on < yStart ? yStart : r.starts_on;
    const clipEnd = r.ends_on > yEnd ? yEnd : r.ends_on;
    if (ymdToDayIndex(clipStart) > ymdToDayIndex(clipEnd)) continue;
    sum += inclusiveCalendarDays(clipStart, clipEnd);
  }
  return sum;
}
