import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { NatureTheme } from '@/constants/Theme';
import {
  ATTENDANCE_KPI_SETTINGS_KEY,
  DEFAULT_ATTENDANCE_KPI_SETTINGS,
  computeAttendanceKpi,
  parseAttendanceKpiSettings,
  type AttendanceKpiSettings,
} from '@/lib/attendanceKpi';
import {
  type AssignmentWithShiftTimes,
  bangkokShiftStartMs,
  computeLateFromAttendanceData,
  payrollPeriodCheckInIsoRange,
} from '@/lib/computeLateFromAttendance';
import {
  LATE_MAX_MINUTES,
  LATE_MAX_PER_MONTH,
  PERSONAL_ANNUAL_DAYS,
  SICK_ANNUAL_DAYS,
  bangkokPayrollPeriodBounds,
  currentLateQuotaPeriodBounds,
  currentYearBangkok,
  eachCalendarYmdInclusive,
  formatPayrollCycleChipTh,
  formatPayrollPeriodRangeTh,
  listPayrollCycleKeysDescending,
  parsePayrollCycleKey,
  payrollCycleKeyFromBangkokDate,
  sumLeaveDaysInYear,
} from '@/lib/leaveLateRules';
import { supabase } from '@/lib/supabase';
import type { LeaveRequestRow, VacationGrantRow, WorkScheduleRow } from '@/lib/types';

type Props = {
  userId: string | null | undefined;
};

function formatWorkDateTh(ymd: string): string {
  const p = ymd.trim().split('-').map(Number);
  if (p.length !== 3 || p.some((n) => !Number.isFinite(n))) return ymd;
  const [yy, mo, dd] = p;
  const dt = new Date(Date.UTC(yy, mo - 1, dd));
  try {
    return new Intl.DateTimeFormat('th-TH', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'Asia/Bangkok',
    }).format(dt);
  } catch {
    return ymd;
  }
}

function formatLeaveDateRangeTh(startYmd: string, endYmd: string): string {
  if (startYmd === endYmd) return formatWorkDateTh(startYmd);
  return `${formatWorkDateTh(startYmd)} - ${formatWorkDateTh(endYmd)}`;
}

function leaveTypeLabelTh(type: LeaveRequestRow['leave_type']): string {
  if (type === 'sick') return 'ลาป่วย';
  if (type === 'personal') return 'ลากิจ';
  if (type === 'vacation') return 'ลาพักร้อน';
  return type;
}

function leaveStatusLabelTh(status: LeaveRequestRow['status']): string {
  if (status === 'approved') return 'อนุมัติแล้ว';
  if (status === 'rejected') return 'ปฏิเสธแล้ว';
  return 'รออนุมัติ';
}

function leaveStatusTone(status: LeaveRequestRow['status']): 'ok' | 'warn' | 'danger' {
  if (status === 'approved') return 'ok';
  if (status === 'rejected') return 'danger';
  return 'warn';
}

function leaveDaysCount(row: LeaveRequestRow): number {
  return eachCalendarYmdInclusive(row.starts_on, row.ends_on).length;
}

function formatCreatedAtTh(iso: string): string {
  try {
    return new Intl.DateTimeFormat('th-TH', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Bangkok',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function formatIsoClockTh(iso: string): string {
  try {
    return new Intl.DateTimeFormat('th-TH', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'Asia/Bangkok',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function formatSignedMinutesTh(n: number): string {
  if (n === 0) return '0 นาที';
  const abs = Math.abs(n);
  if (n > 0) return `+${abs} นาที`;
  return `-${abs} นาที`;
}

function normalizePgDateYmd(raw: string): string {
  const s = String(raw).trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : s;
}

function lateRequestMinutesByWorkDate(
  rows: { work_date: string; minutes_late: number }[]
): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    const d = normalizePgDateYmd(r.work_date);
    const add = Number(r.minutes_late);
    if (!Number.isFinite(add) || add <= 0) continue;
    m.set(d, (m.get(d) ?? 0) + add);
  }
  return m;
}

function legacyPlanStartIsoForDay(
  workYmd: string,
  schedules: WorkScheduleRow[]
): string | null {
  const noonMs = new Date(`${workYmd}T12:00:00+07:00`).getTime();
  let bestIso: string | null = null;
  let bestStart = Infinity;
  for (const schedule of schedules) {
    const startMs = new Date(schedule.start_at).getTime();
    const endMs = new Date(schedule.end_at).getTime();
    if (!(startMs <= noonMs && endMs >= noonMs)) continue;
    if (startMs < bestStart) {
      bestStart = startMs;
      bestIso = schedule.start_at;
    }
  }
  return bestIso;
}

function buildWorkStartByYmd(
  startYmd: string,
  endYmd: string,
  assignments: AssignmentWithShiftTimes[],
  legacySchedules: WorkScheduleRow[]
): Record<string, string> {
  const map: Record<string, string> = {};
  const assignedDays = new Set<string>();
  for (const assignment of assignments) {
    assignedDays.add(assignment.work_date);
    const shift = assignment.work_shifts;
    if (!shift) continue;
    map[assignment.work_date] = new Date(
      bangkokShiftStartMs(assignment.work_date, shift.start_time)
    ).toISOString();
  }
  for (const ymd of eachCalendarYmdInclusive(startYmd, endYmd)) {
    if (assignedDays.has(ymd)) continue;
    const legacyStartIso = legacyPlanStartIsoForDay(ymd, legacySchedules);
    if (legacyStartIso) map[ymd] = legacyStartIso;
  }
  return map;
}

function parseAssignmentRows(rows: unknown[] | null | undefined): AssignmentWithShiftTimes[] {
  const assignments: AssignmentWithShiftTimes[] = [];
  for (const row of rows ?? []) {
    const r = row as {
      id?: string;
      work_date?: string;
      work_shifts?: unknown;
    };
    let ws = r.work_shifts as AssignmentWithShiftTimes['work_shifts'] | null;
    if (Array.isArray(r.work_shifts)) {
      ws = (r.work_shifts[0] as AssignmentWithShiftTimes['work_shifts']) ?? null;
    }
    if (!r.id || !r.work_date) continue;
    assignments.push({
      id: String(r.id),
      work_date: String(r.work_date),
      work_shifts: ws,
    });
  }
  return assignments;
}

function barPct(used: number, cap: number): number {
  if (cap <= 0) return 0;
  return Math.min(100, Math.round((used / cap) * 1000) / 10);
}

export function EmployeeLeaveLateProfilePanel({ userId }: Props) {
  const [loading, setLoading] = useState(false);
  const [leaveRows, setLeaveRows] = useState<LeaveRequestRow[]>([]);
  const [leaveHistoryOpen, setLeaveHistoryOpen] = useState(false);
  const [vacationGrant, setVacationGrant] = useState<VacationGrantRow | null>(null);
  const [lateThisCycle, setLateThisCycle] = useState(0);
  const [lateMinutesThisCycle, setLateMinutesThisCycle] = useState(0);
  const [kpiSettings, setKpiSettings] = useState<AttendanceKpiSettings>(
    DEFAULT_ATTENDANCE_KPI_SETTINGS
  );
  const [kpiLateRows, setKpiLateRows] = useState<ReturnType<typeof computeLateFromAttendanceData>>(
    []
  );
  const [kpiWorkStartByYmd, setKpiWorkStartByYmd] = useState<Record<string, string>>({});
  const [latePayrollCycleKey, setLatePayrollCycleKey] = useState(() =>
    payrollCycleKeyFromBangkokDate()
  );
  const [latePayrollRows, setLatePayrollRows] = useState<
    ReturnType<typeof computeLateFromAttendanceData>
  >([]);

  const quotaY = currentYearBangkok();

  const load = useCallback(async () => {
    if (!userId) {
      setLeaveRows([]);
      setVacationGrant(null);
      setLateThisCycle(0);
      setLateMinutesThisCycle(0);
      setKpiLateRows([]);
      setKpiWorkStartByYmd({});
      return;
    }
    setLoading(true);
    try {
      const y = currentYearBangkok();
      const yStart = `${y}-01-01`;
      const yEnd = `${y}-12-31`;
      const { lo, hi } = currentLateQuotaPeriodBounds();
      const { fromIso: yearFromIso, toIso: yearToIso } = payrollPeriodCheckInIsoRange(
        yStart,
        yEnd
      );
      const [lr, vg, lateCt, kpiSettingRes, asnRes, legRes, logRes, lateYearRes] =
        await Promise.all([
          supabase
            .from('leave_requests')
            .select('*')
            .eq('user_id', userId)
            .lte('starts_on', yEnd)
            .gte('ends_on', yStart),
          supabase
            .from('vacation_grants')
            .select('*')
            .eq('user_id', userId)
            .eq('year', y)
            .maybeSingle(),
          supabase
            .from('late_requests')
            .select('minutes_late', { count: 'exact' })
            .eq('user_id', userId)
            .gte('work_date', lo)
            .lte('work_date', hi),
          supabase
            .from('app_settings')
            .select('value')
            .eq('key', ATTENDANCE_KPI_SETTINGS_KEY)
            .maybeSingle(),
          supabase
            .from('work_schedule_assignments')
            .select('id, work_date, work_shifts(name, start_time, end_time)')
            .eq('user_id', userId)
            .gte('work_date', yStart)
            .lte('work_date', yEnd),
          supabase
            .from('work_schedules')
            .select('id, user_id, start_at, end_at, title')
            .eq('user_id', userId)
            .lte('start_at', yearToIso)
            .gte('end_at', yearFromIso),
          supabase
            .from('attendance_logs')
            .select('created_at')
            .eq('user_id', userId)
            .eq('kind', 'check_in')
            .gte('created_at', yearFromIso)
            .lte('created_at', yearToIso),
          supabase
            .from('late_requests')
            .select('work_date, minutes_late')
            .eq('user_id', userId)
            .gte('work_date', yStart)
            .lte('work_date', yEnd),
        ]);

      setLeaveRows((lr.data as LeaveRequestRow[]) ?? []);
      setVacationGrant((vg.data as VacationGrantRow) ?? null);
      if (!kpiSettingRes.error) {
        setKpiSettings(parseAttendanceKpiSettings(kpiSettingRes.data?.value));
      }
      setLateThisCycle(lateCt.count ?? 0);
      setLateMinutesThisCycle(
        ((lateCt.data as { minutes_late: number }[]) ?? []).reduce((sum, r) => {
          const n = Number(r.minutes_late);
          return Number.isFinite(n) && n > 0 ? sum + n : sum;
        }, 0)
      );

      if (asnRes.error || legRes.error || logRes.error || lateYearRes.error) {
        setKpiLateRows([]);
        setKpiWorkStartByYmd({});
        return;
      }

      const assignments = parseAssignmentRows((asnRes.data as unknown[]) ?? []);
      const legacySchedules = (legRes.data as WorkScheduleRow[]) ?? [];
      const lateReqRows =
        (lateYearRes.data as { work_date: string; minutes_late: number }[]) ?? [];

      setKpiWorkStartByYmd(
        buildWorkStartByYmd(yStart, yEnd, assignments, legacySchedules)
      );
      setKpiLateRows(
        computeLateFromAttendanceData({
          startYmd: yStart,
          endYmd: yEnd,
          assignments,
          legacySchedules,
          checkIns: (logRes.data as { created_at: string }[]) ?? [],
          lateRequestMinutesByYmd: lateRequestMinutesByWorkDate(lateReqRows),
        })
      );
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadLatePayrollCycle = useCallback(async () => {
    if (!userId) {
      setLatePayrollRows([]);
      return;
    }
    const parsed = parsePayrollCycleKey(latePayrollCycleKey);
    if (!parsed) {
      setLatePayrollRows([]);
      return;
    }
    const { startYmd, endYmd } = bangkokPayrollPeriodBounds(parsed.y, parsed.m);
    const { fromIso, toIso } = payrollPeriodCheckInIsoRange(startYmd, endYmd);

    const [asnRes, legRes, logRes, lateRes] = await Promise.all([
      supabase
        .from('work_schedule_assignments')
        .select('id, work_date, work_shifts(name, start_time, end_time)')
        .eq('user_id', userId)
        .gte('work_date', startYmd)
        .lte('work_date', endYmd),
      supabase
        .from('work_schedules')
        .select('id, user_id, start_at, end_at, title')
        .eq('user_id', userId)
        .lte('start_at', toIso)
        .gte('end_at', fromIso),
      supabase
        .from('attendance_logs')
        .select('created_at')
        .eq('user_id', userId)
        .eq('kind', 'check_in')
        .gte('created_at', fromIso)
        .lte('created_at', toIso),
      supabase
        .from('late_requests')
        .select('work_date, minutes_late')
        .eq('user_id', userId)
        .gte('work_date', startYmd)
        .lte('work_date', endYmd),
    ]);

    if (asnRes.error || legRes.error || logRes.error || lateRes.error) {
      setLatePayrollRows([]);
      return;
    }

    setLatePayrollRows(
      computeLateFromAttendanceData({
        startYmd,
        endYmd,
        assignments: parseAssignmentRows((asnRes.data as unknown[]) ?? []),
        legacySchedules: (legRes.data as WorkScheduleRow[]) ?? [],
        checkIns: (logRes.data as { created_at: string }[]) ?? [],
        lateRequestMinutesByYmd: lateRequestMinutesByWorkDate(
          (lateRes.data as { work_date: string; minutes_late: number }[]) ?? []
        ),
      })
    );
  }, [latePayrollCycleKey, userId]);

  useEffect(() => {
    void loadLatePayrollCycle();
  }, [loadLatePayrollCycle]);

  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`employee_leave_late_profile_${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leave_requests' }, () => {
        void load();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'late_requests' }, () => {
        void load();
        void loadLatePayrollCycle();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance_logs' }, () => {
        void load();
        void loadLatePayrollCycle();
      })
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'work_schedule_assignments' },
        () => {
          void load();
          void loadLatePayrollCycle();
        }
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vacation_grants' }, () => {
        void load();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [load, loadLatePayrollCycle, userId]);

  const sickUsed = sumLeaveDaysInYear(leaveRows, quotaY, 'sick');
  const personalUsed = sumLeaveDaysInYear(leaveRows, quotaY, 'personal');
  const vacationUsed = sumLeaveDaysInYear(leaveRows, quotaY, 'vacation');
  const sickGrant = vacationGrant?.sick_days_granted ?? SICK_ANNUAL_DAYS;
  const personalGrant = vacationGrant?.personal_days_granted ?? PERSONAL_ANNUAL_DAYS;
  const vacGrant = vacationGrant?.days_granted ?? 0;
  const sickLeft = Math.max(0, sickGrant - sickUsed);
  const personalLeft = Math.max(0, personalGrant - personalUsed);
  const vacationLeft = Math.max(0, vacGrant - vacationUsed);
  const sickPct = barPct(sickUsed, sickGrant);
  const personalPct = barPct(personalUsed, personalGrant);
  const latePct = Math.max(
    barPct(lateThisCycle, LATE_MAX_PER_MONTH),
    barPct(lateMinutesThisCycle, LATE_MAX_MINUTES)
  );
  const vacationPct =
    vacGrant > 0 ? barPct(vacationUsed, vacGrant) : vacationUsed > 0 ? 100 : 0;

  const leaveHistoryRows = useMemo(
    () =>
      [...leaveRows].sort((a, b) => {
        const aTime = new Date(a.created_at || `${a.starts_on}T00:00:00+07:00`).getTime();
        const bTime = new Date(b.created_at || `${b.starts_on}T00:00:00+07:00`).getTime();
        return bTime - aTime;
      }),
    [leaveRows]
  );
  const leaveHistoryPreview = leaveHistoryRows.slice(0, 4);

  const attendanceKpi = useMemo(
    () =>
      computeAttendanceKpi({
        year: quotaY,
        settings: kpiSettings,
        leaveRows,
        lateRows: kpiLateRows,
        workStartByYmd: kpiWorkStartByYmd,
      }),
    [kpiLateRows, kpiSettings, kpiWorkStartByYmd, leaveRows, quotaY]
  );
  const currentQuarterIndex = Math.min(3, Math.max(0, Math.floor(new Date().getMonth() / 3)));
  const currentQuarterKpi =
    attendanceKpi.quarters[currentQuarterIndex] ?? attendanceKpi.quarters[0];
  const currentDeductions = [
    ...currentQuarterKpi.leaveDeductions,
    ...currentQuarterKpi.lateDeductions,
  ];
  const payrollCycleOptions = useMemo(() => listPayrollCycleKeysDescending(15), []);
  const latePayrollBounds = useMemo(() => {
    const p = parsePayrollCycleKey(latePayrollCycleKey);
    if (!p) return { startYmd: '', endYmd: '' };
    return bangkokPayrollPeriodBounds(p.y, p.m);
  }, [latePayrollCycleKey]);
  const latePayrollSummary = useMemo(
    () => ({
      count: latePayrollRows.length,
      minutes: latePayrollRows.reduce((sum, row) => sum + (Number(row.minutes_late) || 0), 0),
    }),
    [latePayrollRows]
  );

  return (
    <>
      <Text style={styles.sectionTitle}>ลา & เข้าสาย</Text>
      <Text style={styles.sectionSub}>
        สรุปโควตาปี {quotaY} · นับวันลาเฉพาะที่อนุมัติแล้ว · ขอเข้าสายจำกัดตามรอบ 26–25
      </Text>
      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator color={c.primary} />
          <Text style={styles.loadingText}>กำลังโหลดข้อมูลลาและ KPI...</Text>
        </View>
      ) : null}
      <View style={styles.leaveDashCard}>
        <View style={styles.leaveDashCardHeader}>
          <Text style={styles.leaveDashCardTitle}>สรุปการใช้สิทธิ</Text>
          <Text style={styles.leaveDashCardHint}>ปี {quotaY}</Text>
        </View>

        <View style={styles.quotaRow}>
          <View style={[styles.quotaAccent, { backgroundColor: c.lateNoticeBar }]} />
          <View style={styles.quotaMain}>
            <View style={styles.quotaTitleRow}>
              <Text style={styles.quotaLabel}>ขอเข้าสาย</Text>
              <Text style={styles.quotaValue}>
                {lateThisCycle} / {LATE_MAX_PER_MONTH} ครั้ง · {lateMinutesThisCycle} /{' '}
                {LATE_MAX_MINUTES} นาที
              </Text>
            </View>
            <Text style={styles.quotaSub}>รอบปัจจุบัน 26–25 (ยึดอย่างใดอย่างหนึ่งถึงก่อน)</Text>
            <View style={styles.barTrack}>
              <View
                style={[
                  styles.barFill,
                  {
                    width: `${latePct}%`,
                    backgroundColor: c.lateNoticeBar,
                  },
                ]}
              />
            </View>
          </View>
        </View>

        <View style={styles.leaveDashDivider} />

        <View style={styles.quotaRow}>
          <View style={[styles.quotaAccent, { backgroundColor: c.leaveSickBar }]} />
          <View style={styles.quotaMain}>
            <View style={styles.quotaTitleRow}>
              <Text style={styles.quotaLabel}>ลาป่วย</Text>
              <Text style={styles.quotaValue}>
                {sickUsed} / {sickGrant.toFixed(1)} วัน
              </Text>
            </View>
            <Text style={styles.quotaSub}>เหลือ {sickLeft.toFixed(1)} วัน</Text>
            <View style={styles.barTrack}>
              <View
                style={[
                  styles.barFill,
                  {
                    width: `${sickPct}%`,
                    backgroundColor: c.leaveSickBar,
                  },
                ]}
              />
            </View>
          </View>
        </View>

        <View style={styles.quotaRow}>
          <View style={[styles.quotaAccent, { backgroundColor: c.primary }]} />
          <View style={styles.quotaMain}>
            <View style={styles.quotaTitleRow}>
              <Text style={styles.quotaLabel}>ลากิจ</Text>
              <Text style={styles.quotaValue}>
                {personalUsed} / {personalGrant.toFixed(1)} วัน
              </Text>
            </View>
            <Text style={styles.quotaSub}>เหลือ {personalLeft.toFixed(1)} วัน</Text>
            <View style={styles.barTrack}>
              <View
                style={[
                  styles.barFill,
                  {
                    width: `${personalPct}%`,
                    backgroundColor: c.primary,
                  },
                ]}
              />
            </View>
            <Text style={styles.quotaPolicyNote}>
              แนว B: ลาติดกันเกิน 2 วันต้องมีเหตุผลและเอกสารเพิ่ม
            </Text>
          </View>
        </View>

        <View style={styles.quotaRow}>
          <View style={[styles.quotaAccent, { backgroundColor: c.accentWarm }]} />
          <View style={styles.quotaMain}>
            <View style={styles.quotaTitleRow}>
              <Text style={styles.quotaLabel}>พักร้อน</Text>
              <Text style={styles.quotaValue}>
                ใช้ {vacationUsed.toFixed(1)} / {vacGrant.toFixed(1)} วัน
              </Text>
            </View>
            <Text style={styles.quotaSub}>
              เหลือ {vacationLeft.toFixed(1)} วัน
              {vacGrant <= 0 ? ' · ยังไม่มีวันโควตาที่ได้รับ' : ''}
            </Text>
            {vacGrant > 0 ? (
              <View style={styles.barTrack}>
                <View
                  style={[
                    styles.barFill,
                    {
                      width: `${vacationPct}%`,
                      backgroundColor: c.accentWarm,
                    },
                  ]}
                />
              </View>
            ) : null}
          </View>
        </View>
      </View>

      <View style={styles.leaveHistoryCard}>
        <View style={styles.leaveHistoryHeader}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.leaveHistoryTitle}>ประวัติการลา</Text>
            <Text style={styles.leaveHistorySub}>
              แสดงคำขอลาทั้งปี {quotaY} รวมรายการรออนุมัติและปฏิเสธ
            </Text>
          </View>
          <Pressable
            style={[
              styles.leaveHistoryOpenBtn,
              leaveHistoryRows.length === 0 && styles.disabled,
            ]}
            disabled={leaveHistoryRows.length === 0}
            onPress={() => setLeaveHistoryOpen(true)}>
            <Text style={styles.leaveHistoryOpenBtnText}>ดูทั้งหมด</Text>
          </Pressable>
        </View>
        {leaveHistoryRows.length === 0 ? (
          <Text style={styles.leaveHistoryEmpty}>ยังไม่มีประวัติการลาในปีนี้</Text>
        ) : (
          leaveHistoryPreview.map((row) => <LeaveHistoryRow key={row.id} row={row} preview />)
        )}
        {leaveHistoryRows.length > leaveHistoryPreview.length ? (
          <Text style={styles.leaveHistoryMore}>
            และอีก {leaveHistoryRows.length - leaveHistoryPreview.length}{' '}
            รายการ กดดูทั้งหมดเพื่อดูประวัติครบ
          </Text>
        ) : null}
      </View>

      <View style={styles.kpiCard}>
        <View style={styles.kpiHeaderRow}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.kpiTitle}>KPI การลา / ขอเข้าสาย</Text>
            <Text style={styles.kpiSub}>
              คะแนนเต็ม {currentQuarterKpi.maxScore} คะแนนต่อไตรมาส · ภาพรวมปี {quotaY}
            </Text>
          </View>
          <View style={styles.kpiScoreBadge}>
            <Text style={styles.kpiScoreMain}>{currentQuarterKpi.totalScore.toFixed(1)}</Text>
            <Text style={styles.kpiScoreSub}>/ {currentQuarterKpi.maxScore}</Text>
          </View>
        </View>
        <View style={styles.kpiBarTrack}>
          <View
            style={[
              styles.kpiBarFill,
              { width: `${Math.max(0, Math.min(100, currentQuarterKpi.percent))}%` },
            ]}
          />
        </View>
        <Text style={styles.kpiMeta}>
          {currentQuarterKpi.label}: ลา {currentQuarterKpi.leaveScore.toFixed(1)} /{' '}
          {kpiSettings.leaveMaxScore} · สาย {currentQuarterKpi.lateScore.toFixed(1)} /{' '}
          {kpiSettings.lateMaxScore} · {currentQuarterKpi.percent}%
        </Text>
        <Text style={styles.kpiMeta}>
          ภาพรวมปี: {attendanceKpi.yearScore.toFixed(1)} / {attendanceKpi.yearMaxScore}{' '}
          คะแนน · {attendanceKpi.yearPercent}%
        </Text>
        <View style={styles.kpiQuarterGrid}>
          {attendanceKpi.quarters.map((q) => (
            <View key={q.key} style={styles.kpiQuarterChip}>
              <Text style={styles.kpiQuarterLabel}>{q.key}</Text>
              <Text style={styles.kpiQuarterScore}>
                {q.totalScore.toFixed(1)} / {q.maxScore}
              </Text>
            </View>
          ))}
        </View>
        {currentDeductions.length > 0 ? (
          <View style={styles.kpiDeductionsBox}>
            <Text style={styles.kpiDeductionsTitle}>รายการหักคะแนนไตรมาสนี้</Text>
            {currentDeductions.slice(0, 5).map((d, idx) => (
              <Text key={`${d.kind}-${idx}`} style={styles.kpiDeductionLine}>
                -{d.points} คะแนน · {d.label}
              </Text>
            ))}
          </View>
        ) : (
          <Text style={styles.kpiNoDeduction}>ยังไม่มีรายการหักคะแนนในไตรมาสนี้</Text>
        )}
      </View>

      <View style={styles.latePayrollBlock}>
        <Text style={styles.latePayrollTitle}>สรุปเวลามาสาย (รอบเดือน 26–25)</Text>
        <Text style={styles.latePayrollHint}>
          คำนวณจากเวลาเข้างานจริง (check-in แรกของวัน) เทียบเวลาเริ่มตามกะที่มอบหมายรายวัน
          หรือตารางงานแบบ legacy — เขต Asia/Bangkok
          {'\n'}
          ถ้ามีคำขอเข้าสายในวันนั้น จะหักนาทีสิทธิ์ออกจากเวลาเข้างานจริงก่อนตัดสินว่าสายหรือไม่
        </Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          nestedScrollEnabled
          style={styles.lateChipScroll}
          contentContainerStyle={styles.lateChipScrollContent}>
          {payrollCycleOptions.map((key) => {
            const on = key === latePayrollCycleKey;
            return (
              <Pressable
                key={key}
                style={[styles.lateChip, on && styles.lateChipOn]}
                onPress={() => setLatePayrollCycleKey(key)}>
                <Text style={[styles.lateChipText, on && styles.lateChipTextOn]}>
                  {formatPayrollCycleChipTh(key)}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
        {latePayrollBounds.startYmd ? (
          <Text style={styles.latePayrollRange}>
            {formatPayrollPeriodRangeTh(latePayrollBounds.startYmd, latePayrollBounds.endYmd)}
          </Text>
        ) : null}
        <Text style={styles.latePayrollSummaryMain}>
          รวมสายสุทธิ {latePayrollSummary.minutes} นาที · {latePayrollSummary.count} ครั้ง
        </Text>
        {latePayrollSummary.count === 0 ? (
          <Text style={[styles.muted, styles.latePayrollEmpty]}>
            ไม่มีวันที่มาสายในช่วงนี้ — ถ้าไม่มีมอบหมายกะรายวันหรือไม่มี check-in จะไม่แสดงรายการ
          </Text>
        ) : (
          latePayrollRows.map((r) => (
            <View key={r.id} style={styles.latePayrollRowCard}>
              <View style={styles.latePayrollRowHead}>
                <Text style={styles.latePayrollRowDate}>{formatWorkDateTh(r.work_date)}</Text>
                <Text style={styles.latePayrollRowMins}>{r.minutes_late} นาทีสุทธิ</Text>
              </View>
              <Text style={styles.latePayrollRowMeta}>
                {r.source === 'assignment' ? 'กะมอบหมาย' : 'ตารางงาน'} · {r.plan_label ?? '-'}
              </Text>
              <Text style={styles.latePayrollRowNote}>
                กำหนด {formatIsoClockTh(r.plan_start_at)} · เข้า {formatIsoClockTh(r.check_in_at)}
              </Text>
              <Text style={styles.latePayrollRowRights}>
                {r.late_request_minutes > 0
                  ? `สิทธิ์ขอมาสาย ${r.late_request_minutes} นาที · หลังหักสิทธิ์ ${formatIsoClockTh(r.adjusted_check_in_at)}`
                  : 'ไม่มีการขอมาสายในวันนี้'}
              </Text>
              <Text
                style={[
                  styles.latePayrollRowDelta,
                  r.rights_minus_actual_minutes > 0 && styles.latePayrollRowDeltaPos,
                  r.rights_minus_actual_minutes < 0 && styles.latePayrollRowDeltaNeg,
                ]}>
                สายจริง {r.actual_late_minutes} นาที · สิทธิ์ - สายจริง:{' '}
                {formatSignedMinutesTh(r.rights_minus_actual_minutes)}
              </Text>
            </View>
          ))
        )}
      </View>

      <Modal
        visible={leaveHistoryOpen}
        animationType="slide"
        transparent
        statusBarTranslucent
        onRequestClose={() => setLeaveHistoryOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>ประวัติการลา ปี {quotaY}</Text>
            <Text style={styles.leaveHistoryModalSub}>
              รวมคำขอลาทุกสถานะ เรียงตามวันที่ส่งคำขอล่าสุด
            </Text>
            <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator>
              {leaveHistoryRows.length === 0 ? (
                <Text style={styles.leaveHistoryEmpty}>ยังไม่มีประวัติการลาในปีนี้</Text>
              ) : (
                leaveHistoryRows.map((row) => (
                  <LeaveHistoryRow key={`modal-${row.id}`} row={row} />
                ))
              )}
            </ScrollView>
            <Pressable style={styles.modalClose} onPress={() => setLeaveHistoryOpen(false)}>
              <Text style={styles.modalCloseText}>ปิด</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

function LeaveHistoryRow({ row, preview = false }: { row: LeaveRequestRow; preview?: boolean }) {
  const tone = leaveStatusTone(row.status);
  return (
    <View style={styles.leaveHistoryRow}>
      <View
        style={[
          styles.leaveHistoryAccent,
          tone === 'ok'
            ? styles.leaveHistoryAccentOk
            : tone === 'danger'
              ? styles.leaveHistoryAccentDanger
              : styles.leaveHistoryAccentWarn,
        ]}
      />
      <View style={styles.leaveHistoryBody}>
        <View style={styles.leaveHistoryTopLine}>
          <Text style={styles.leaveHistoryType}>{leaveTypeLabelTh(row.leave_type)}</Text>
          <Text
            style={[
              styles.leaveHistoryStatus,
              tone === 'ok'
                ? styles.leaveHistoryStatusOk
                : tone === 'danger'
                  ? styles.leaveHistoryStatusDanger
                  : styles.leaveHistoryStatusWarn,
            ]}>
            {leaveStatusLabelTh(row.status)}
          </Text>
        </View>
        <Text style={styles.leaveHistoryDate}>
          {formatLeaveDateRangeTh(row.starts_on, row.ends_on)} · {leaveDaysCount(row)} วัน
        </Text>
        <Text style={styles.leaveHistoryReason} numberOfLines={preview ? 2 : undefined}>
          {row.reason?.trim() || row.supplementary_note?.trim() || 'ไม่ระบุเหตุผล'}
        </Text>
        <Text style={styles.leaveHistoryCreated}>
          ส่งคำขอ {formatCreatedAtTh(row.created_at)}
        </Text>
        {row.medical_certificate_url || row.supplementary_document_url ? (
          <Text style={styles.leaveHistoryAttach}>มีเอกสารแนบ</Text>
        ) : null}
      </View>
    </View>
  );
}

const c = NatureTheme.colors;
const r = NatureTheme.radius;

const styles = StyleSheet.create({
  sectionTitle: {
    marginTop: 20,
    fontSize: 17,
    fontWeight: '700',
    color: c.text,
  },
  sectionSub: { fontSize: 12, color: c.textMuted, marginTop: 4, marginBottom: 10 },
  loadingBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    borderRadius: r.sm,
    backgroundColor: c.surfaceMuted,
    marginBottom: 8,
  },
  loadingText: { color: c.textMuted, fontSize: 12 },
  leaveDashCard: {
    marginTop: 10,
    marginBottom: 6,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: r.lg,
    backgroundColor: c.surfaceElevated,
    borderWidth: 1,
    borderColor: c.borderSoft,
    gap: 0,
  },
  leaveDashCardHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 14,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: c.borderSoft,
  },
  leaveDashCardTitle: { fontSize: 16, fontWeight: '800', color: c.text },
  leaveDashCardHint: { fontSize: 12, fontWeight: '600', color: c.textMuted },
  quotaRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 10,
    paddingVertical: 12,
  },
  quotaAccent: {
    width: 4,
    borderRadius: 2,
    alignSelf: 'stretch',
    minHeight: 44,
  },
  quotaMain: { flex: 1, minWidth: 0 },
  quotaTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  quotaLabel: { fontSize: 14, fontWeight: '700', color: c.text },
  quotaValue: { fontSize: 13, fontWeight: '700', color: c.textSecondary },
  quotaSub: {
    marginTop: 4,
    fontSize: 11,
    color: c.textMuted,
  },
  quotaPolicyNote: {
    marginTop: 8,
    fontSize: 11,
    lineHeight: 16,
    color: c.textMuted,
    fontStyle: 'italic',
  },
  barTrack: {
    marginTop: 10,
    height: 8,
    borderRadius: 4,
    backgroundColor: c.surfaceMuted,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 4,
    minWidth: 0,
  },
  leaveDashDivider: {
    height: 1,
    backgroundColor: c.borderSoft,
    marginVertical: 2,
  },
  leaveHistoryCard: {
    marginTop: 12,
    padding: 12,
    borderRadius: r.lg,
    backgroundColor: c.surfaceElevated,
    borderWidth: 1,
    borderColor: c.borderSoft,
  },
  leaveHistoryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  leaveHistoryTitle: { fontSize: 16, fontWeight: '800', color: c.text },
  leaveHistorySub: { marginTop: 3, fontSize: 12, color: c.textMuted, lineHeight: 17 },
  leaveHistoryOpenBtn: {
    borderRadius: r.sm,
    backgroundColor: c.primaryLight,
    borderWidth: 1,
    borderColor: c.primaryMuted,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  leaveHistoryOpenBtnText: { color: c.primaryDark, fontSize: 12, fontWeight: '800' },
  leaveHistoryEmpty: {
    padding: 12,
    borderRadius: r.sm,
    backgroundColor: c.surfaceMuted,
    color: c.textMuted,
    fontSize: 12,
    textAlign: 'center',
  },
  leaveHistoryRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
    padding: 10,
    borderRadius: r.md,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.borderSoft,
  },
  leaveHistoryAccent: { width: 4, borderRadius: 2 },
  leaveHistoryAccentOk: { backgroundColor: c.checkIn },
  leaveHistoryAccentWarn: { backgroundColor: c.accentWarm },
  leaveHistoryAccentDanger: { backgroundColor: c.error },
  leaveHistoryBody: { flex: 1, minWidth: 0 },
  leaveHistoryTopLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  leaveHistoryType: { color: c.text, fontSize: 14, fontWeight: '800' },
  leaveHistoryStatus: {
    borderRadius: 999,
    paddingVertical: 3,
    paddingHorizontal: 8,
    fontSize: 11,
    fontWeight: '800',
    overflow: 'hidden',
  },
  leaveHistoryStatusOk: { color: c.checkIn, backgroundColor: c.primaryLight },
  leaveHistoryStatusWarn: { color: c.warningTitle, backgroundColor: c.warningBg },
  leaveHistoryStatusDanger: { color: c.error, backgroundColor: c.errorBg },
  leaveHistoryDate: { marginTop: 5, color: c.textSecondary, fontSize: 12, fontWeight: '700' },
  leaveHistoryReason: { marginTop: 5, color: c.text, fontSize: 12, lineHeight: 18 },
  leaveHistoryCreated: { marginTop: 5, color: c.textMuted, fontSize: 11 },
  leaveHistoryAttach: { marginTop: 5, color: c.primaryDark, fontSize: 11, fontWeight: '700' },
  leaveHistoryMore: { marginTop: 10, color: c.textMuted, fontSize: 12, fontStyle: 'italic' },
  leaveHistoryModalSub: { marginTop: -4, marginBottom: 10, color: c.textMuted, fontSize: 12 },
  kpiCard: {
    marginTop: 14,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: r.md,
    backgroundColor: c.surfaceElevated,
    borderWidth: 1,
    borderColor: c.borderSoft,
  },
  kpiHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 10,
  },
  kpiTitle: { fontSize: 16, fontWeight: '800', color: c.text },
  kpiSub: { marginTop: 3, fontSize: 12, color: c.textMuted, lineHeight: 17 },
  kpiScoreBadge: {
    minWidth: 74,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: r.md,
    backgroundColor: c.primaryLight,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: c.primary,
  },
  kpiScoreMain: { fontSize: 20, fontWeight: '900', color: c.primaryDark },
  kpiScoreSub: { fontSize: 11, color: c.textSecondary, fontWeight: '700' },
  kpiBarTrack: {
    height: 8,
    borderRadius: 999,
    backgroundColor: c.surfaceMuted,
    overflow: 'hidden',
    marginBottom: 8,
  },
  kpiBarFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: c.primary,
  },
  kpiMeta: { fontSize: 12, color: c.textSecondary, lineHeight: 18 },
  kpiQuarterGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  kpiQuarterChip: {
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: r.sm,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.borderSoft,
  },
  kpiQuarterLabel: { fontSize: 11, color: c.textMuted, fontWeight: '700' },
  kpiQuarterScore: { marginTop: 2, fontSize: 12, color: c.text, fontWeight: '800' },
  kpiDeductionsBox: {
    marginTop: 12,
    padding: 10,
    borderRadius: r.sm,
    backgroundColor: c.warningBg,
    borderWidth: 1,
    borderColor: c.warningBorder,
  },
  kpiDeductionsTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: c.warningTitle,
    marginBottom: 4,
  },
  kpiDeductionLine: { fontSize: 12, color: c.warningBody, lineHeight: 18 },
  kpiNoDeduction: {
    marginTop: 10,
    fontSize: 12,
    color: c.primaryDark,
    fontWeight: '700',
  },
  latePayrollBlock: {
    marginTop: 14,
    marginBottom: 8,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: r.lg,
    backgroundColor: c.surfaceElevated,
    borderWidth: 1,
    borderColor: c.borderSoft,
  },
  latePayrollTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: c.text,
    marginBottom: 6,
  },
  latePayrollHint: {
    fontSize: 12,
    color: c.textMuted,
    lineHeight: 18,
    marginBottom: 10,
  },
  lateChipScroll: { marginBottom: 8 },
  lateChipScrollContent: { flexDirection: 'row', flexWrap: 'nowrap', gap: 8, paddingVertical: 2 },
  lateChip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.surface,
  },
  lateChipOn: {
    borderColor: c.lateNoticeBar,
    backgroundColor: c.lateNoticeBg,
  },
  lateChipText: { fontSize: 12, fontWeight: '700', color: c.textSecondary },
  lateChipTextOn: { color: c.lateNoticeBar },
  latePayrollRange: {
    fontSize: 13,
    fontWeight: '700',
    color: c.text,
    marginBottom: 10,
  },
  latePayrollSummaryMain: {
    fontSize: 15,
    fontWeight: '800',
    color: c.lateNoticeBar,
    marginBottom: 10,
  },
  latePayrollEmpty: { marginBottom: 4 },
  latePayrollRowCard: {
    marginTop: 8,
    padding: 12,
    borderRadius: r.md,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderLeftWidth: 4,
    borderLeftColor: c.lateNoticeBar,
    borderColor: c.borderSoft,
  },
  latePayrollRowHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 4,
  },
  latePayrollRowDate: { fontSize: 14, fontWeight: '700', color: c.text, flex: 1, minWidth: 0 },
  latePayrollRowMins: { fontSize: 14, fontWeight: '800', color: c.lateNoticeBar },
  latePayrollRowMeta: {
    fontSize: 12,
    fontWeight: '600',
    color: c.textMuted,
    marginBottom: 4,
  },
  latePayrollRowNote: { fontSize: 13, color: c.textSecondary, lineHeight: 20 },
  latePayrollRowRights: {
    fontSize: 13,
    color: c.text,
    lineHeight: 20,
    marginTop: 6,
    fontWeight: '600',
  },
  latePayrollRowDelta: {
    fontSize: 13,
    lineHeight: 20,
    marginTop: 2,
    color: c.textSecondary,
    fontWeight: '600',
  },
  latePayrollRowDeltaPos: { color: c.accentWarm },
  latePayrollRowDeltaNeg: { color: c.lateNoticeBar },
  muted: { fontSize: 14, color: c.textMuted, lineHeight: 20 },
  disabled: { opacity: 0.6 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: c.overlay,
    justifyContent: 'center',
    padding: 16,
  },
  modalCard: {
    backgroundColor: c.surface,
    borderRadius: r.xl,
    maxHeight: '85%',
    padding: 16,
    borderWidth: 1,
    borderColor: c.borderSoft,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', marginBottom: 12, color: c.text },
  modalScroll: { maxHeight: 400 },
  modalClose: {
    marginTop: 12,
    backgroundColor: c.surfaceMuted,
    padding: 12,
    borderRadius: r.sm,
    alignItems: 'center',
  },
  modalCloseText: { fontWeight: '700', color: c.textSecondary },
});
