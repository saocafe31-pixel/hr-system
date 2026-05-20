import type { LateActualFromScheduleRow } from '@/lib/computeLateFromAttendance';
import type { LeaveRequestRow } from '@/lib/types';

export const ATTENDANCE_KPI_SETTINGS_KEY = 'attendance_kpi_settings';

export type AttendanceKpiSettings = {
  leaveMaxScore: number;
  lateMaxScore: number;
  personalNotice: {
    goodDays: number;
    midDays: number;
    lowDays: number;
    penaltyBelowGood: number;
    penaltyBelowMid: number;
    penaltyBelowLow: number;
  };
  sickNotice: {
    minHours: number;
    penaltyBelowMin: number;
  };
  vacationNotice: {
    goodDays: number;
    midDays: number;
    lowDays: number;
    penaltyBelowGood: number;
    penaltyBelowMid: number;
    penaltyBelowLow: number;
  };
  late: {
    firstMinCount: number;
    firstMaxCount: number;
    firstMaxMinutes: number;
    firstPenalty: number;
    secondMaxCount: number;
    secondMaxMinutes: number;
    secondPenalty: number;
    severeCountOver: number;
    severeMinutesOver: number;
    severePenalty: number;
  };
};

export type AttendanceKpiDeduction = {
  kind: 'leave' | 'late';
  label: string;
  points: number;
};

export type AttendanceKpiQuarter = {
  key: string;
  label: string;
  startYmd: string;
  endYmd: string;
  leaveScore: number;
  lateScore: number;
  totalScore: number;
  maxScore: number;
  percent: number;
  leaveDeductions: AttendanceKpiDeduction[];
  lateDeductions: AttendanceKpiDeduction[];
  lateCount: number;
  lateMinutes: number;
};

export type AttendanceKpiResult = {
  year: number;
  quarters: AttendanceKpiQuarter[];
  yearScore: number;
  yearMaxScore: number;
  yearPercent: number;
};

export type WorkStartByYmd = Record<string, string>;

export const DEFAULT_ATTENDANCE_KPI_SETTINGS: AttendanceKpiSettings = {
  leaveMaxScore: 10,
  lateMaxScore: 10,
  personalNotice: {
    goodDays: 7,
    midDays: 4,
    lowDays: 2,
    penaltyBelowGood: 1,
    penaltyBelowMid: 2,
    penaltyBelowLow: 3,
  },
  sickNotice: {
    minHours: 1,
    penaltyBelowMin: 2,
  },
  vacationNotice: {
    goodDays: 30,
    midDays: 20,
    lowDays: 10,
    penaltyBelowGood: 1,
    penaltyBelowMid: 2,
    penaltyBelowLow: 3,
  },
  late: {
    firstMinCount: 4,
    firstMaxCount: 6,
    firstMaxMinutes: 90,
    firstPenalty: 2,
    secondMaxCount: 10,
    secondMaxMinutes: 90,
    secondPenalty: 4,
    severeCountOver: 10,
    severeMinutesOver: 90,
    severePenalty: 10,
  },
};

function num(raw: unknown, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export function parseAttendanceKpiSettings(raw: unknown): AttendanceKpiSettings {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_ATTENDANCE_KPI_SETTINGS;
  const personal =
    obj.personalNotice && typeof obj.personalNotice === 'object'
      ? (obj.personalNotice as Record<string, unknown>)
      : {};
  const sick =
    obj.sickNotice && typeof obj.sickNotice === 'object'
      ? (obj.sickNotice as Record<string, unknown>)
      : {};
  const vacation =
    obj.vacationNotice && typeof obj.vacationNotice === 'object'
      ? (obj.vacationNotice as Record<string, unknown>)
      : {};
  const late =
    obj.late && typeof obj.late === 'object' ? (obj.late as Record<string, unknown>) : {};

  return {
    leaveMaxScore: Math.max(0, num(obj.leaveMaxScore, d.leaveMaxScore)),
    lateMaxScore: Math.max(0, num(obj.lateMaxScore, d.lateMaxScore)),
    personalNotice: {
      goodDays: num(personal.goodDays, d.personalNotice.goodDays),
      midDays: num(personal.midDays, d.personalNotice.midDays),
      lowDays: num(personal.lowDays, d.personalNotice.lowDays),
      penaltyBelowGood: num(
        personal.penaltyBelowGood,
        d.personalNotice.penaltyBelowGood
      ),
      penaltyBelowMid: num(personal.penaltyBelowMid, d.personalNotice.penaltyBelowMid),
      penaltyBelowLow: num(personal.penaltyBelowLow, d.personalNotice.penaltyBelowLow),
    },
    sickNotice: {
      minHours: num(sick.minHours, d.sickNotice.minHours),
      penaltyBelowMin: num(sick.penaltyBelowMin, d.sickNotice.penaltyBelowMin),
    },
    vacationNotice: {
      goodDays: num(vacation.goodDays, d.vacationNotice.goodDays),
      midDays: num(vacation.midDays, d.vacationNotice.midDays),
      lowDays: num(vacation.lowDays, d.vacationNotice.lowDays),
      penaltyBelowGood: num(
        vacation.penaltyBelowGood,
        d.vacationNotice.penaltyBelowGood
      ),
      penaltyBelowMid: num(vacation.penaltyBelowMid, d.vacationNotice.penaltyBelowMid),
      penaltyBelowLow: num(vacation.penaltyBelowLow, d.vacationNotice.penaltyBelowLow),
    },
    late: {
      firstMinCount: num(late.firstMinCount, d.late.firstMinCount),
      firstMaxCount: num(late.firstMaxCount, d.late.firstMaxCount),
      firstMaxMinutes: num(late.firstMaxMinutes, d.late.firstMaxMinutes),
      firstPenalty: num(late.firstPenalty, d.late.firstPenalty),
      secondMaxCount: num(late.secondMaxCount, d.late.secondMaxCount),
      secondMaxMinutes: num(late.secondMaxMinutes, d.late.secondMaxMinutes),
      secondPenalty: num(late.secondPenalty, d.late.secondPenalty),
      severeCountOver: num(late.severeCountOver, d.late.severeCountOver),
      severeMinutesOver: num(late.severeMinutesOver, d.late.severeMinutesOver),
      severePenalty: num(late.severePenalty, d.late.severePenalty),
    },
  };
}

export function quarterBoundsForYear(year: number) {
  return [
    { key: 'Q1', label: 'ไตรมาส 1', startYmd: `${year}-01-01`, endYmd: `${year}-03-31` },
    { key: 'Q2', label: 'ไตรมาส 2', startYmd: `${year}-04-01`, endYmd: `${year}-06-30` },
    { key: 'Q3', label: 'ไตรมาส 3', startYmd: `${year}-07-01`, endYmd: `${year}-09-30` },
    { key: 'Q4', label: 'ไตรมาส 4', startYmd: `${year}-10-01`, endYmd: `${year}-12-31` },
  ];
}

function clampScore(score: number, max: number): number {
  return Math.max(0, Math.min(max, score));
}

function ymdToBangkokStartMs(ymd: string): number {
  return new Date(`${ymd}T00:00:00+07:00`).getTime();
}

function noticeHours(
  row: Pick<LeaveRequestRow, 'starts_on' | 'created_at'>,
  workStartByYmd: WorkStartByYmd
): number | null {
  if (!row.created_at) return null;
  const workStartIso = workStartByYmd[row.starts_on];
  const startMs = workStartIso
    ? new Date(workStartIso).getTime()
    : ymdToBangkokStartMs(row.starts_on);
  const createdMs = new Date(row.created_at).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(createdMs)) return null;
  return (startMs - createdMs) / 3600000;
}

function noticePenalty(
  noticeDays: number,
  rule: AttendanceKpiSettings['personalNotice'] | AttendanceKpiSettings['vacationNotice']
): number {
  if (noticeDays >= rule.goodDays) return 0;
  if (noticeDays >= rule.midDays) return rule.penaltyBelowGood;
  if (noticeDays >= rule.lowDays) return rule.penaltyBelowMid;
  return rule.penaltyBelowLow;
}

function rowInQuarter(row: LeaveRequestRow, startYmd: string, endYmd: string): boolean {
  return row.status === 'approved' && row.starts_on >= startYmd && row.starts_on <= endYmd;
}

export function computeAttendanceKpi(params: {
  year: number;
  settings: AttendanceKpiSettings;
  leaveRows: LeaveRequestRow[];
  lateRows: LateActualFromScheduleRow[];
  workStartByYmd?: WorkStartByYmd;
}): AttendanceKpiResult {
  const { year, settings, leaveRows, lateRows, workStartByYmd = {} } = params;
  const maxScore = settings.leaveMaxScore + settings.lateMaxScore;

  const quarters = quarterBoundsForYear(year).map((q) => {
    const leaveDeductions: AttendanceKpiDeduction[] = [];
    for (const row of leaveRows) {
      if (!rowInQuarter(row, q.startYmd, q.endYmd)) continue;
      const hours = noticeHours(row, workStartByYmd);
      if (hours == null) continue;
      if (row.leave_type === 'personal') {
        const days = hours / 24;
        const points = noticePenalty(days, settings.personalNotice);
        if (points > 0) {
          leaveDeductions.push({
            kind: 'leave',
            label: `ลากิจแจ้งล่วงหน้า ${Math.max(0, days).toFixed(1)} วัน`,
            points,
          });
        }
      } else if (row.leave_type === 'sick') {
        if (hours < settings.sickNotice.minHours) {
          leaveDeductions.push({
            kind: 'leave',
            label: `ลาป่วยแจ้งล่วงหน้า ${Math.max(0, hours).toFixed(1)} ชม.`,
            points: settings.sickNotice.penaltyBelowMin,
          });
        }
      } else if (row.leave_type === 'vacation') {
        const days = hours / 24;
        const points = noticePenalty(days, settings.vacationNotice);
        if (points > 0) {
          leaveDeductions.push({
            kind: 'leave',
            label: `ลาพักร้อนแจ้งล่วงหน้า ${Math.max(0, days).toFixed(1)} วัน`,
            points,
          });
        }
      }
    }

    const quarterLateRows = lateRows.filter(
      (row) => row.work_date >= q.startYmd && row.work_date <= q.endYmd
    );
    const lateCount = quarterLateRows.length;
    const lateMinutes = quarterLateRows.reduce(
      (sum, row) => sum + Math.max(0, Number(row.minutes_late) || 0),
      0
    );
    const lateDeductions: AttendanceKpiDeduction[] = [];
    const lateRule = settings.late;
    if (lateCount > lateRule.severeCountOver || lateMinutes > lateRule.severeMinutesOver) {
      lateDeductions.push({
        kind: 'late',
        label: `มาสาย ${lateCount} ครั้ง รวม ${lateMinutes} นาที`,
        points: lateRule.severePenalty,
      });
    } else if (lateCount > lateRule.firstMaxCount && lateCount <= lateRule.secondMaxCount) {
      lateDeductions.push({
        kind: 'late',
        label: `มาสาย ${lateCount} ครั้ง รวม ${lateMinutes} นาที`,
        points: lateRule.secondPenalty,
      });
    } else if (lateCount >= lateRule.firstMinCount && lateCount <= lateRule.firstMaxCount) {
      lateDeductions.push({
        kind: 'late',
        label: `มาสาย ${lateCount} ครั้ง รวม ${lateMinutes} นาที`,
        points: lateRule.firstPenalty,
      });
    }

    const leavePenalty = leaveDeductions.reduce((sum, d) => sum + d.points, 0);
    const latePenalty = lateDeductions.reduce((sum, d) => sum + d.points, 0);
    const leaveScore = clampScore(settings.leaveMaxScore - leavePenalty, settings.leaveMaxScore);
    const lateScore = clampScore(settings.lateMaxScore - latePenalty, settings.lateMaxScore);
    const totalScore = leaveScore + lateScore;
    return {
      ...q,
      leaveScore,
      lateScore,
      totalScore,
      maxScore,
      percent: maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0,
      leaveDeductions,
      lateDeductions,
      lateCount,
      lateMinutes,
    };
  });

  const yearScore = quarters.reduce((sum, q) => sum + q.totalScore, 0);
  const yearMaxScore = quarters.reduce((sum, q) => sum + q.maxScore, 0);
  return {
    year,
    quarters,
    yearScore,
    yearMaxScore,
    yearPercent: yearMaxScore > 0 ? Math.round((yearScore / yearMaxScore) * 100) : 0,
  };
}
