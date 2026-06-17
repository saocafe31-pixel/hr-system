import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Polyline, Text as SvgText } from 'react-native-svg';

import type { AppTheme } from '@/constants/Theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import {
  computeLateFromAttendanceData,
  payrollPeriodCheckInIsoRange,
  type AssignmentWithShiftTimes,
  type LateActualFromScheduleRow,
} from '@/lib/computeLateFromAttendance';
import { supabase } from '@/lib/supabase';
import type { WorkScheduleRow } from '@/lib/types';

const ANALYTICS_ALL_MONTHS_KEY = 'all';
const ANALYTICS_PAGE_SIZE = 1000;

type LateRankSortMode = 'count' | 'minutes';
type RankingViewMode = 'late' | 'sick';

type AnalyticsLateRow = LateActualFromScheduleRow & { user_id: string };

type WorkAnalyticsData = {
  wellbeingRows: Array<{ user_id: string; score: number; created_at: string }>;
  lateRows: AnalyticsLateRow[];
  sickLeaveRows: Array<{
    user_id: string;
    starts_on: string;
    ends_on: string;
    status: string;
    leave_type: string;
  }>;
};

type ChartPoint = {
  key: string;
  dateKey?: string;
  label: string;
  value: number;
  sub?: string;
};

type MetricLine = {
  key: string;
  label: string;
  color: string;
  points: ChartPoint[];
  maxValue?: number;
  valueSuffix?: string;
};

type AnalyticsMonthOption = {
  key: string;
  label: string;
  rangeLabel: string;
};

type RankRow = {
  userId: string;
  name: string;
  count: number;
  minutes?: number;
  days?: number;
};

type WorkAnalyticsPanelProps = {
  visibleUserIds?: string[];
  employeeNameByProfile?: Map<string, string>;
};

type SupabasePagedResult<T> = {
  data: T[] | null;
  error: { message: string } | null;
};

function ymdOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

function monthKeyOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function attendancePeriodFromMonthKey(monthKey: string): { from: string; to: string } {
  const [yy, mm] = monthKey.split('-');
  const y = Number(yy);
  const m = Number(mm);
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) {
    return attendancePeriodFromMonthKey(monthKeyOf(new Date()));
  }
  const to = new Date(y, m - 1, 25);
  const from = new Date(y, m - 2, 26);
  return { from: ymdOf(from), to: ymdOf(to) };
}

function formatMonthOptionLabel(monthKey: string): string {
  const [yy, mm] = monthKey.split('-');
  const y = Number(yy);
  const m = Number(mm);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return monthKey;
  return new Intl.DateTimeFormat('th-TH-u-ca-gregory-nu-latn', {
    month: 'long',
    year: 'numeric',
  }).format(new Date(y, m - 1, 1));
}

function analyticsMonthOptions(count = 15): AnalyticsMonthOption[] {
  const out: AnalyticsMonthOption[] = [];
  const base = new Date();
  for (let i = 0; i < count; i += 1) {
    const d = new Date(base.getFullYear(), base.getMonth() - i, 1);
    const key = monthKeyOf(d);
    const period = attendancePeriodFromMonthKey(key);
    out.push({
      key,
      label: formatMonthOptionLabel(key),
      rangeLabel: `${period.from} - ${period.to}`,
    });
  }
  return out;
}

function ymdToBangkokDate(ymd: string): Date {
  return new Date(`${ymd}T12:00:00+07:00`);
}

function enumerateYmdRange(from: string, to: string): string[] {
  const out: string[] = [];
  const d = ymdToBangkokDate(from);
  const end = ymdToBangkokDate(to).getTime();
  while (d.getTime() <= end) {
    out.push(ymdOf(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

function countInclusiveDays(from: string, to: string): number {
  const start = ymdToBangkokDate(from).getTime();
  const end = ymdToBangkokDate(to).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
  return Math.floor((end - start) / 86_400_000) + 1;
}

function overlapInclusiveDays(
  startsOn: string,
  endsOn: string,
  periodFrom: string,
  periodTo: string
): number {
  const start = startsOn > periodFrom ? startsOn : periodFrom;
  const end = endsOn < periodTo ? endsOn : periodTo;
  return countInclusiveDays(start, end);
}

function bangkokYmdFromIso(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

function todayBangkokYmd(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function shortThaiDayLabel(ymd: string): string {
  return new Intl.DateTimeFormat('th-TH', {
    day: 'numeric',
    month: 'short',
  }).format(ymdToBangkokDate(ymd));
}

function formatDurationMinutes(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes));
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  if (h > 0 && m > 0) return `${h} ชม. ${m} นาที`;
  if (h > 0) return `${h} ชม.`;
  return `${m} นาที`;
}

function lateRequestMinutesByWorkDate(
  rows: Array<{ work_date: string; minutes_late: number }>
): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    const ymd = String(row.work_date).slice(0, 10);
    const minutes = Number(row.minutes_late);
    if (!ymd || !Number.isFinite(minutes) || minutes <= 0) continue;
    map.set(ymd, (map.get(ymd) ?? 0) + minutes);
  }
  return map;
}

function parseAssignmentRowsWithUser(rows: unknown[]): Array<AssignmentWithShiftTimes & { user_id: string }> {
  const parsed: Array<AssignmentWithShiftTimes & { user_id: string }> = [];
  for (const row of rows) {
    const rrow = row as {
      id?: string;
      user_id?: string;
      work_date?: string;
      work_shifts?: unknown;
    };
    let ws = rrow.work_shifts as AssignmentWithShiftTimes['work_shifts'] | null;
    if (Array.isArray(rrow.work_shifts)) {
      ws = (rrow.work_shifts[0] as AssignmentWithShiftTimes['work_shifts']) ?? null;
    }
    if (!rrow.id || !rrow.user_id || !rrow.work_date) continue;
    parsed.push({
      id: String(rrow.id),
      user_id: String(rrow.user_id),
      work_date: String(rrow.work_date),
      work_shifts: ws,
    });
  }
  return parsed;
}

async function fetchAllPaged<T>(
  makeQuery: (from: number, to: number) => PromiseLike<SupabasePagedResult<T>>
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += ANALYTICS_PAGE_SIZE) {
    const to = from + ANALYTICS_PAGE_SIZE - 1;
    const { data, error } = await makeQuery(from, to);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < ANALYTICS_PAGE_SIZE) break;
  }
  return all;
}

function MultiMetricLineChart({
  lines,
  styles,
  colors,
}: {
  lines: MetricLine[];
  styles: ReturnType<typeof createWorkAnalyticsStyles>;
  colors: AppTheme['colors'];
}) {
  const scrollRef = useRef<ScrollView>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const points = lines[0]?.points ?? [];
  const dayWidth = 46;
  const chartH = 182;
  const topPad = 18;
  const bottomPad = 42;
  const leftPad = 10;
  const rightPad = 18;
  const chartW = Math.max(dayWidth * 7 + leftPad + rightPad, points.length * dayWidth + leftPad + rightPad);
  const plotH = chartH - topPad - bottomPad;
  const currentYmd = todayBangkokYmd();
  const latestCurrentIndex = Math.max(
    0,
    points.reduce((latest, point, index) => {
      const dateKey = point.dateKey ?? '';
      if (!dateKey || dateKey > currentYmd) return latest;
      return index;
    }, points.length > 0 ? 0 : -1)
  );
  const activePoint = activeIndex != null ? points[activeIndex] : null;
  const activeValues =
    activeIndex != null
      ? lines.map((line) => ({
          ...line,
          point: line.points[activeIndex],
        }))
      : [];

  useEffect(() => {
    const timer = setTimeout(() => {
      const x = Math.max(0, (latestCurrentIndex - 6) * dayWidth);
      scrollRef.current?.scrollTo({ x, animated: false });
    }, 0);
    return () => clearTimeout(timer);
  }, [chartW, latestCurrentIndex]);

  const xOf = (index: number) => leftPad + index * dayWidth + dayWidth / 2;
  const maxForLine = (line: MetricLine) =>
    line.maxValue ?? Math.max(1, ...line.points.map((p) => p.value));
  const yOf = (value: number, max: number) => {
    if (max <= 0) return topPad + plotH;
    const normalized = Math.max(0, Math.min(1, value / max));
    return topPad + (1 - normalized) * plotH;
  };

  return (
    <View style={styles.lineChartCard}>
      <View style={styles.lineChartLegendRow}>
        {lines.map((line) => (
          <View key={line.key} style={styles.lineChartLegendItem}>
            <View style={[styles.lineChartLegendDot, { backgroundColor: line.color }]} />
            <Text style={styles.lineChartLegendText}>{line.label}</Text>
          </View>
        ))}
      </View>
      {activePoint ? (
        <View style={styles.lineChartTooltip}>
          <Text style={styles.lineChartTooltipTitle}>{activePoint.label}</Text>
          <View style={styles.lineChartTooltipRows}>
            {activeValues.map(({ key, label, color, point, valueSuffix }) => (
              <View key={`tip-${key}`} style={styles.lineChartTooltipItem}>
                <View style={[styles.lineChartLegendDot, { backgroundColor: color }]} />
                <Text style={styles.lineChartTooltipText}>
                  {label}:{' '}
                  {point?.value != null
                    ? point.value.toFixed(point.value % 1 ? 1 : 0)
                    : '0'}
                  {valueSuffix ?? ''}
                  {point?.sub ? ` · ${point.sub}` : ''}
                </Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}
      <View style={styles.lineChartViewport}>
        <ScrollView
          ref={scrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.lineChartScrollContent}>
          <View style={[styles.lineChartCanvasWrap, { width: chartW, height: chartH }]}>
          <Svg width={chartW} height={chartH}>
          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
            const y = topPad + ratio * plotH;
            return (
              <Line
                key={`grid-${ratio}`}
                x1={leftPad}
                x2={chartW - rightPad}
                y1={y}
                y2={y}
                stroke={colors.borderSoft}
                strokeWidth={1}
              />
            );
          })}
          {activeIndex != null ? (
            <Line
              x1={xOf(activeIndex)}
              x2={xOf(activeIndex)}
              y1={topPad}
              y2={chartH - bottomPad + 8}
              stroke={colors.textMuted}
              strokeWidth={1}
              strokeDasharray="4 4"
            />
          ) : null}
          {points.map((point, index) => (
            <SvgText
              key={`label-${point.key}`}
              x={xOf(index)}
              y={chartH - 18}
              fill={colors.textMuted}
              fontSize={10}
              textAnchor="middle">
              {point.label}
            </SvgText>
          ))}
          {lines.map((line) => {
            const max = maxForLine(line);
            const pathPoints = line.points
              .map((point, index) => `${xOf(index)},${yOf(point.value, max)}`)
              .join(' ');
            return (
              <Polyline
                key={`line-${line.key}`}
                points={pathPoints}
                fill="none"
                stroke={line.color}
                strokeWidth={3}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            );
          })}
          {lines.flatMap((line) => {
            const max = maxForLine(line);
            return line.points.map((point, index) => {
              const hasValue = point.value > 0;
              return (
                <Circle
                  key={`dot-${line.key}-${point.key}`}
                  cx={xOf(index)}
                  cy={yOf(point.value, max)}
                  r={hasValue ? 3.2 : 2}
                  fill={hasValue ? line.color : colors.surfaceMuted}
                  stroke={line.color}
                  strokeWidth={hasValue ? 0 : 1}
                />
              );
            });
          })}
          </Svg>
          {points.map((point, index) => (
            <Pressable
              key={`hit-${point.key}`}
              style={[
                styles.lineChartHitZone,
                { left: xOf(index) - dayWidth / 2, width: dayWidth, height: chartH },
              ]}
              onHoverIn={() => setActiveIndex(index)}
              onPressIn={() => setActiveIndex(index)}
              onPress={() => setActiveIndex(index)}
            />
          ))}
          </View>
        </ScrollView>
      </View>
      <Text style={styles.lineChartHint}>
        เปิดที่ 7 วันล่าสุดถึงวันปัจจุบัน เลื่อนซ้ายเพื่อดูย้อนหลัง และแตะ/ชี้ที่จุดเพื่อดูค่า
      </Text>
    </View>
  );
}

export function WorkAnalyticsPanel({
  visibleUserIds,
  employeeNameByProfile,
}: WorkAnalyticsPanelProps) {
  const { theme } = useAppTheme();
  const c = theme.colors;
  const styles = useMemo(() => createWorkAnalyticsStyles(theme), [theme]);
  const [analyticsMonthFilter, setAnalyticsMonthFilter] = useState(monthKeyOf(new Date()));
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);
  const [lateRankSortMode, setLateRankSortMode] = useState<LateRankSortMode>('count');
  const [rankingViewMode, setRankingViewMode] = useState<RankingViewMode>('late');
  const [workAnalytics, setWorkAnalytics] = useState<WorkAnalyticsData>({
    wellbeingRows: [],
    lateRows: [],
    sickLeaveRows: [],
  });
  const [profileNameById, setProfileNameById] = useState<Map<string, string>>(
    () => new Map()
  );

  const analyticsMonthChoices = useMemo(() => analyticsMonthOptions(18), []);
  const analyticsPeriod = useMemo(() => {
    if (analyticsMonthFilter !== ANALYTICS_ALL_MONTHS_KEY) {
      return attendancePeriodFromMonthKey(analyticsMonthFilter);
    }
    const newest = analyticsMonthChoices[0];
    const oldest = analyticsMonthChoices[analyticsMonthChoices.length - 1];
    if (!newest || !oldest) return attendancePeriodFromMonthKey(monthKeyOf(new Date()));
    return {
      from: attendancePeriodFromMonthKey(oldest.key).from,
      to: attendancePeriodFromMonthKey(newest.key).to,
    };
  }, [analyticsMonthChoices, analyticsMonthFilter]);
  const allowedUserIdSet = useMemo(() => {
    if (!visibleUserIds) return null;
    return new Set(visibleUserIds.filter(Boolean));
  }, [visibleUserIds]);

  const loadWorkAnalytics = useCallback(async () => {
    if (allowedUserIdSet && allowedUserIdSet.size === 0) {
      setWorkAnalytics({ wellbeingRows: [], lateRows: [], sickLeaveRows: [] });
      return;
    }

    const { fromIso, toIso } = payrollPeriodCheckInIsoRange(
      analyticsPeriod.from,
      analyticsPeriod.to
    );
    setAnalyticsLoading(true);
    setAnalyticsError(null);
    try {
      const [
        wellbeingRowsRaw,
        assignmentRowsRaw,
        legacyScheduleRowsRaw,
        checkInRowsRaw,
        lateRequestRowsRaw,
        sickLeaveRowsRaw,
        profileRowsRaw,
      ] = await Promise.all([
        fetchAllPaged<{ user_id: string; score: number; created_at: string }>((from, to) =>
          supabase
            .from('wellbeing_checkins')
            .select('user_id, score, created_at')
            .gte('created_at', fromIso)
            .lte('created_at', toIso)
            .order('created_at', { ascending: true })
            .range(from, to)
        ),
        fetchAllPaged<unknown>((from, to) =>
          supabase
            .from('work_schedule_assignments')
            .select('id, user_id, work_date, work_shifts(name, start_time, end_time)')
            .gte('work_date', analyticsPeriod.from)
            .lte('work_date', analyticsPeriod.to)
            .order('work_date', { ascending: true })
            .range(from, to)
        ),
        fetchAllPaged<WorkScheduleRow>((from, to) =>
          supabase
            .from('work_schedules')
            .select('id, user_id, start_at, end_at, title, created_by')
            .lte('start_at', toIso)
            .gte('end_at', fromIso)
            .order('start_at', { ascending: true })
            .range(from, to)
        ),
        fetchAllPaged<{ user_id: string; created_at: string }>((from, to) =>
          supabase
            .from('attendance_logs')
            .select('user_id, created_at')
            .eq('kind', 'check_in')
            .gte('created_at', fromIso)
            .lte('created_at', toIso)
            .order('created_at', { ascending: true })
            .range(from, to)
        ),
        fetchAllPaged<{ user_id: string; work_date: string; minutes_late: number }>((from, to) =>
          supabase
            .from('late_requests')
            .select('user_id, work_date, minutes_late')
            .gte('work_date', analyticsPeriod.from)
            .lte('work_date', analyticsPeriod.to)
            .order('work_date', { ascending: true })
            .range(from, to)
        ),
        fetchAllPaged<WorkAnalyticsData['sickLeaveRows'][number]>((from, to) =>
          supabase
            .from('leave_requests')
            .select('user_id, leave_type, starts_on, ends_on, status')
            .eq('leave_type', 'sick')
            .eq('status', 'approved')
            .lte('starts_on', analyticsPeriod.to)
            .gte('ends_on', analyticsPeriod.from)
            .order('starts_on', { ascending: true })
            .range(from, to)
        ),
        fetchAllPaged<{
          id: string;
          full_name: string | null;
          email: string | null;
          employee_code: string | null;
        }>((from, to) =>
          supabase
            .from('profiles')
            .select('id, full_name, email, employee_code')
            .order('id', { ascending: true })
            .range(from, to)
        ),
      ]);

      const isAllowed = (userId: string) => !allowedUserIdSet || allowedUserIdSet.has(userId);
      const assignments = parseAssignmentRowsWithUser(assignmentRowsRaw).filter(
        (row) => isAllowed(row.user_id)
      );
      const legacySchedules = legacyScheduleRowsRaw.filter((row) =>
        isAllowed(row.user_id)
      );
      const checkIns = checkInRowsRaw.filter((row) => isAllowed(row.user_id));
      const lateRequests = lateRequestRowsRaw.filter((row) => isAllowed(row.user_id));
      const sickLeaveRows = sickLeaveRowsRaw.filter((row) => isAllowed(row.user_id));

      const userIds = Array.from(
        new Set([
          ...assignments.map((row) => row.user_id),
          ...legacySchedules.map((row) => row.user_id),
          ...checkIns.map((row) => row.user_id),
        ])
      ).filter(Boolean);
      const lateRows: AnalyticsLateRow[] = [];
      for (const userId of userIds) {
        const userLateRequests = lateRequests.filter((row) => row.user_id === userId);
        const computed = computeLateFromAttendanceData({
          startYmd: analyticsPeriod.from,
          endYmd: analyticsPeriod.to,
          assignments: assignments.filter((row) => row.user_id === userId),
          legacySchedules: legacySchedules.filter((row) => row.user_id === userId),
          checkIns: checkIns
            .filter((row) => row.user_id === userId)
            .map((row) => ({ created_at: row.created_at })),
          lateRequestMinutesByYmd: lateRequestMinutesByWorkDate(userLateRequests),
        });
        lateRows.push(...computed.map((row) => ({ ...row, user_id: userId })));
      }
      setWorkAnalytics({
        wellbeingRows: wellbeingRowsRaw.filter(
          (row) => isAllowed(row.user_id)
        ),
        lateRows,
        sickLeaveRows,
      });
      const nextNames = new Map<string, string>();
      for (const profile of profileRowsRaw) {
        nextNames.set(
          profile.id,
          profile.full_name?.trim() ||
            profile.email?.trim() ||
            profile.employee_code?.trim() ||
            profile.id.slice(0, 8)
        );
      }
      setProfileNameById(nextNames);
    } catch (e) {
      setAnalyticsError(e instanceof Error ? e.message : String(e));
      setWorkAnalytics({ wellbeingRows: [], lateRows: [], sickLeaveRows: [] });
    } finally {
      setAnalyticsLoading(false);
    }
  }, [allowedUserIdSet, analyticsPeriod.from, analyticsPeriod.to]);

  useEffect(() => {
    void loadWorkAnalytics();
  }, [loadWorkAnalytics]);

  const workAnalyticsSummary = useMemo(() => {
    const todayYmd = todayBangkokYmd();
    const chartPeriodTo =
      analyticsPeriod.from <= todayYmd && analyticsPeriod.to > todayYmd
        ? todayYmd
        : analyticsPeriod.to;
    const days = enumerateYmdRange(analyticsPeriod.from, chartPeriodTo);
    const wellbeingBuckets = new Map<string, { sum: number; count: number }>();
    for (const row of workAnalytics.wellbeingRows) {
      const ymd = bangkokYmdFromIso(row.created_at);
      const bucket = wellbeingBuckets.get(ymd) ?? { sum: 0, count: 0 };
      bucket.sum += Number(row.score) || 0;
      bucket.count += 1;
      wellbeingBuckets.set(ymd, bucket);
    }
    const wellbeingPoints = days.map((ymd) => {
      const bucket = wellbeingBuckets.get(ymd);
      const value = bucket && bucket.count > 0 ? bucket.sum / bucket.count : 0;
      return {
        key: `wellbeing-${ymd}`,
        dateKey: ymd,
        label: shortThaiDayLabel(ymd),
        value: Math.round(value * 10) / 10,
      };
    });
    const wellbeingValues = wellbeingPoints.map((p) => p.value).filter((v) => v > 0);
    const wellbeingAverage =
      wellbeingValues.length > 0
        ? wellbeingValues.reduce((sum, v) => sum + v, 0) / wellbeingValues.length
        : 0;

    const lateBuckets = new Map<string, { count: number; minutes: number }>();
    const lateRank = new Map<string, { count: number; minutes: number }>();
    for (const row of workAnalytics.lateRows) {
      const minutes = Number(row.minutes_late) || 0;
      const daily = lateBuckets.get(row.work_date) ?? { count: 0, minutes: 0 };
      daily.count += 1;
      daily.minutes += minutes;
      lateBuckets.set(row.work_date, daily);
      const ranked = lateRank.get(row.user_id) ?? { count: 0, minutes: 0 };
      ranked.count += 1;
      ranked.minutes += minutes;
      lateRank.set(row.user_id, ranked);
    }
    const latePoints = days.map((ymd) => {
      const bucket = lateBuckets.get(ymd);
      return {
        key: `late-${ymd}`,
        dateKey: ymd,
        label: shortThaiDayLabel(ymd),
        value: bucket?.minutes ?? 0,
        sub: bucket?.count ? `${bucket.count} ครั้ง` : undefined,
      };
    });
    const lateActiveDays = latePoints.filter((p) => p.value > 0);
    const lateTotalMinutes = workAnalytics.lateRows.reduce(
      (sum, row) => sum + (Number(row.minutes_late) || 0),
      0
    );
    const lateTotalCount = workAnalytics.lateRows.length;
    const lateAverageMinutes = lateTotalCount > 0 ? lateTotalMinutes / lateTotalCount : 0;
    const lateMaxDay = lateActiveDays.reduce(
      (best, row) => (!best || row.value > best.value ? row : best),
      null as ChartPoint | null
    );
    const lateMinDay = lateActiveDays.reduce(
      (best, row) => (!best || row.value < best.value ? row : best),
      null as ChartPoint | null
    );
    const topLateEmployees: RankRow[] = [...lateRank.entries()]
      .map(([userId, value]) => ({
        userId,
        name: employeeNameByProfile?.get(userId) ?? profileNameById.get(userId) ?? userId.slice(0, 8),
        count: value.count,
        minutes: value.minutes,
      }))
      .sort((a, b) =>
        lateRankSortMode === 'minutes'
          ? (b.minutes ?? 0) - (a.minutes ?? 0) || b.count - a.count
          : b.count - a.count || (b.minutes ?? 0) - (a.minutes ?? 0)
      )
      .slice(0, 10);

    const sickDaily = new Map<string, number>();
    const sickRank = new Map<string, { count: number; days: number }>();
    for (const row of workAnalytics.sickLeaveRows) {
      const daysCount = overlapInclusiveDays(
        row.starts_on,
        row.ends_on,
        analyticsPeriod.from,
        analyticsPeriod.to
      );
      if (daysCount <= 0) continue;
      const ranked = sickRank.get(row.user_id) ?? { count: 0, days: 0 };
      ranked.count += 1;
      ranked.days += daysCount;
      sickRank.set(row.user_id, ranked);
      for (const ymd of enumerateYmdRange(
        row.starts_on > analyticsPeriod.from ? row.starts_on : analyticsPeriod.from,
        row.ends_on < analyticsPeriod.to ? row.ends_on : analyticsPeriod.to
      )) {
        sickDaily.set(ymd, (sickDaily.get(ymd) ?? 0) + 1);
      }
    }
    const sickLeavePoints = days.map((ymd) => ({
      key: `sick-${ymd}`,
      dateKey: ymd,
      label: shortThaiDayLabel(ymd),
      value: sickDaily.get(ymd) ?? 0,
    }));
    const topSickLeaveEmployees: RankRow[] = [...sickRank.entries()]
      .map(([userId, value]) => ({
        userId,
        name: employeeNameByProfile?.get(userId) ?? profileNameById.get(userId) ?? userId.slice(0, 8),
        count: value.count,
        days: value.days,
      }))
      .sort((a, b) => b.count - a.count || (b.days ?? 0) - (a.days ?? 0))
      .slice(0, 10);

    return {
      wellbeingPoints,
      wellbeingAverage,
      latePoints,
      lateTotalCount,
      lateTotalMinutes,
      lateAverageMinutes,
      lateMaxDay,
      lateMinDay,
      topLateEmployees,
      sickLeavePoints,
      sickLeaveRequestCount: workAnalytics.sickLeaveRows.length,
      sickLeaveTotalDays: [...sickRank.values()].reduce((sum, row) => sum + row.days, 0),
      topSickLeaveEmployees,
    };
  }, [
    analyticsPeriod.from,
    analyticsPeriod.to,
    employeeNameByProfile,
    lateRankSortMode,
    profileNameById,
    workAnalytics.lateRows,
    workAnalytics.sickLeaveRows,
    workAnalytics.wellbeingRows,
  ]);

  return (
    <View style={styles.analyticsPanel}>
      <View style={styles.analyticsHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.analyticsTitle}>กราฟสรุปข้อมูลการทำงาน</Text>
          <Text style={styles.muted}>
            สุขภาพใจรายวัน, แนวโน้มมาสายสุทธิ และอันดับลาป่วย/มาสายบ่อยในรอบที่เลือก
          </Text>
        </View>
        <Pressable
          style={[styles.btnSecondary, analyticsLoading && styles.disabledSoft]}
          onPress={() => void loadWorkAnalytics()}
          disabled={analyticsLoading}>
          <Text style={styles.btnSecondaryText}>
            {analyticsLoading ? 'กำลังโหลด...' : 'รีเฟรช'}
          </Text>
        </Pressable>
      </View>
      <Text style={styles.label}>เลือกเดือนรอบสรุป 26-25</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.analyticsMonthRow}>
        <Pressable
          style={[
            styles.analyticsMonthChip,
            analyticsMonthFilter === ANALYTICS_ALL_MONTHS_KEY && styles.analyticsMonthChipOn,
          ]}
          onPress={() => setAnalyticsMonthFilter(ANALYTICS_ALL_MONTHS_KEY)}>
          <Text
            style={[
              styles.analyticsMonthChipText,
              analyticsMonthFilter === ANALYTICS_ALL_MONTHS_KEY &&
                styles.analyticsMonthChipTextOn,
            ]}>
            ทั้งหมด
          </Text>
          <Text
            style={[
              styles.analyticsMonthChipSub,
              analyticsMonthFilter === ANALYTICS_ALL_MONTHS_KEY &&
                styles.analyticsMonthChipSubOn,
            ]}>
            ทุกเดือนที่แสดง
          </Text>
        </Pressable>
        {analyticsMonthChoices.map((option) => {
          const on = analyticsMonthFilter === option.key;
          return (
            <Pressable
              key={option.key}
              style={[styles.analyticsMonthChip, on && styles.analyticsMonthChipOn]}
              onPress={() => setAnalyticsMonthFilter(option.key)}>
              <Text
                style={[
                  styles.analyticsMonthChipText,
                  on && styles.analyticsMonthChipTextOn,
                ]}>
                {option.label}
              </Text>
              <Text
                style={[
                  styles.analyticsMonthChipSub,
                  on && styles.analyticsMonthChipSubOn,
                ]}>
                {option.rangeLabel}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <Text style={styles.muted}>
        ช่วงวันที่: {analyticsPeriod.from} ถึง {analyticsPeriod.to}
      </Text>
      {analyticsError ? (
        <Text style={styles.errorText}>โหลดกราฟไม่สำเร็จ: {analyticsError}</Text>
      ) : null}

      <View style={styles.analyticsStatGrid}>
        <View style={[styles.analyticsStatCard, styles.analyticsStatCardWellbeing]}>
          <View style={styles.analyticsStatHeaderRow}>
            <View style={[styles.analyticsStatIconBubble, styles.analyticsStatIconWellbeing]}>
              <FontAwesome name="heart" size={13} color={c.checkIn} />
            </View>
            <Text style={styles.analyticsStatLabel}>สุขภาพใจเฉลี่ย</Text>
          </View>
          <Text style={styles.analyticsStatValue}>
            {workAnalyticsSummary.wellbeingAverage > 0
              ? `${workAnalyticsSummary.wellbeingAverage.toFixed(2)} / 5`
              : '-'}
          </Text>
        </View>
        <View style={[styles.analyticsStatCard, styles.analyticsStatCardSick]}>
          <View style={styles.analyticsStatHeaderRow}>
            <View style={[styles.analyticsStatIconBubble, styles.analyticsStatIconSick]}>
              <FontAwesome name="medkit" size={13} color={c.leaveSickBar} />
            </View>
            <Text style={styles.analyticsStatLabel}>ลาป่วยรวม</Text>
          </View>
          <Text style={styles.analyticsStatValue}>
            {workAnalyticsSummary.sickLeaveRequestCount} คำขอ
          </Text>
          <Text style={styles.analyticsStatSub}>{workAnalyticsSummary.sickLeaveTotalDays} วัน</Text>
        </View>
        <View style={[styles.analyticsStatCard, styles.analyticsStatCardLate]}>
          <View style={styles.analyticsStatHeaderRow}>
            <View style={[styles.analyticsStatIconBubble, styles.analyticsStatIconLate]}>
              <FontAwesome name="clock-o" size={14} color={c.lateNoticeBar} />
            </View>
            <Text style={styles.analyticsStatLabel}>มาสายสุทธิรวม</Text>
          </View>
          <Text style={styles.analyticsStatValue}>
            {workAnalyticsSummary.lateTotalCount} ครั้ง
          </Text>
          <Text style={styles.analyticsStatSub}>
            {formatDurationMinutes(workAnalyticsSummary.lateTotalMinutes)}
          </Text>
        </View>
        <View style={[styles.analyticsStatCard, styles.analyticsStatCardLate]}>
          <View style={styles.analyticsStatHeaderRow}>
            <View style={[styles.analyticsStatIconBubble, styles.analyticsStatIconLate]}>
              <FontAwesome name="tachometer" size={13} color={c.lateNoticeBar} />
            </View>
            <Text style={styles.analyticsStatLabel}>เฉลี่ยต่อครั้ง</Text>
          </View>
          <Text style={styles.analyticsStatValue}>
            {workAnalyticsSummary.lateAverageMinutes > 0
              ? formatDurationMinutes(workAnalyticsSummary.lateAverageMinutes)
              : '-'}
          </Text>
        </View>
      </View>

      <Text style={styles.analyticsSectionTitle}>กราฟเส้นสรุปรายวัน</Text>
      <Text style={styles.muted}>
        มาสายสูงสุด:{' '}
        {workAnalyticsSummary.lateMaxDay
          ? `${workAnalyticsSummary.lateMaxDay.label} · ${formatDurationMinutes(workAnalyticsSummary.lateMaxDay.value)}`
          : '-'}{' '}
        · ต่ำสุด:{' '}
        {workAnalyticsSummary.lateMinDay
          ? `${workAnalyticsSummary.lateMinDay.label} · ${formatDurationMinutes(workAnalyticsSummary.lateMinDay.value)}`
          : '-'}
      </Text>
      <MultiMetricLineChart
        styles={styles}
        colors={c}
        lines={[
          {
            key: 'wellbeing',
            label: 'สุขภาพใจ',
            color: c.checkIn,
            points: workAnalyticsSummary.wellbeingPoints,
            maxValue: 5,
          },
          {
            key: 'late',
            label: 'มาสายสุทธิ',
            color: c.lateNoticeBar,
            points: workAnalyticsSummary.latePoints,
            valueSuffix: 'น.',
          },
          {
            key: 'sick',
            label: 'ลาป่วย',
            color: c.leaveSickBar,
            points: workAnalyticsSummary.sickLeavePoints,
            valueSuffix: 'คน',
          },
        ]}
      />

      <View style={styles.analyticsRankCard}>
        <View style={styles.analyticsRankHeaderRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.analyticsRankTitle}>จัดอันดับพนักงาน 10 อันดับ</Text>
            <Text style={styles.analyticsRankHint}>
              สลับดูพนักงานมาสายหรือพนักงานลาป่วยในรอบที่เลือก
            </Text>
          </View>
        </View>

        <View style={styles.analyticsSortRow}>
          {(
            [
              { key: 'late', label: 'พนักงานมาสาย', icon: 'clock-o' },
              { key: 'sick', label: 'พนักงานลาป่วย', icon: 'medkit' },
            ] as const
          ).map((option) => {
            const on = rankingViewMode === option.key;
            return (
              <Pressable
                key={option.key}
                style={[
                  styles.analyticsSortChip,
                  on &&
                    (option.key === 'late'
                      ? styles.analyticsSortChipOn
                      : styles.analyticsSortChipSickOn),
                ]}
                onPress={() => setRankingViewMode(option.key)}>
                <FontAwesome
                  name={option.icon}
                  size={11}
                  color={
                    on
                      ? option.key === 'late'
                        ? c.lateNoticeBar
                        : c.leaveSickBar
                      : c.textMuted
                  }
                />
                <Text
                  style={[
                    styles.analyticsSortChipText,
                    on &&
                      (option.key === 'late'
                        ? styles.analyticsSortChipTextOn
                        : styles.analyticsSortChipTextSickOn),
                  ]}>
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.analyticsRankList}>
          {rankingViewMode === 'late' ? (
            <>
              <View style={styles.analyticsSortRow}>
                {(
                  [
                    { key: 'count', label: 'จำนวนครั้ง' },
                    { key: 'minutes', label: 'นาทีรวม' },
                  ] as const
                ).map((option) => {
                  const on = lateRankSortMode === option.key;
                  return (
                    <Pressable
                      key={option.key}
                      style={[styles.analyticsSortChip, on && styles.analyticsSortChipOn]}
                      onPress={() => setLateRankSortMode(option.key)}>
                      <Text
                        style={[
                          styles.analyticsSortChipText,
                          on && styles.analyticsSortChipTextOn,
                        ]}>
                        {option.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              {workAnalyticsSummary.topLateEmployees.length === 0 ? (
                <Text style={styles.muted}>ยังไม่มีข้อมูลการเข้าสายในช่วงนี้</Text>
              ) : (
                workAnalyticsSummary.topLateEmployees.map((row, index) => (
                  <View key={row.userId} style={styles.analyticsRankRow}>
                    <Text style={styles.analyticsRankNo}>#{index + 1}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.analyticsRankName} numberOfLines={1}>
                        {row.name}
                      </Text>
                      <Text style={styles.analyticsRankMeta}>
                        {row.count} ครั้ง · {formatDurationMinutes(row.minutes ?? 0)}
                      </Text>
                    </View>
                  </View>
                ))
              )}
            </>
          ) : (
            <>
              {workAnalyticsSummary.topSickLeaveEmployees.length === 0 ? (
                <Text style={styles.muted}>ยังไม่มีข้อมูลลาป่วยในช่วงนี้</Text>
              ) : (
                workAnalyticsSummary.topSickLeaveEmployees.map((row, index) => (
                  <View key={row.userId} style={styles.analyticsRankRow}>
                    <Text style={styles.analyticsRankNo}>#{index + 1}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.analyticsRankName} numberOfLines={1}>
                        {row.name}
                      </Text>
                      <Text style={styles.analyticsRankMeta}>
                        {row.count} คำขอ · {row.days ?? 0} วัน
                      </Text>
                    </View>
                  </View>
                ))
              )}
            </>
          )}
        </View>
      </View>
    </View>
  );
}

function createWorkAnalyticsStyles(theme: AppTheme) {
  const c = theme.colors;
  const r = theme.radius;
  const sectionAccent =
    c.canvas === '#F8FAF1'
      ? { borderLeftWidth: 4, borderLeftColor: c.primaryMuted, paddingLeft: 10 }
      : {};

  return StyleSheet.create({
  analyticsPanel: {
    marginBottom: 18,
    padding: 14,
    borderRadius: r.md,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.borderSoft,
  },
  analyticsHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 8,
  },
  analyticsTitle: {
    fontSize: 16,
    fontWeight: '900',
    color: c.text,
    marginBottom: 4,
  },
  muted: {
    color: c.textMuted,
    fontSize: 12,
    lineHeight: 18,
  },
  label: {
    fontSize: 12,
    fontWeight: '800',
    color: c.textSecondary,
    marginTop: 8,
    marginBottom: 6,
  },
  btnSecondary: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: r.sm,
    backgroundColor: c.surfaceElevated,
    borderWidth: 1,
    borderColor: c.border,
  },
  btnSecondaryText: { color: c.primaryDark, fontWeight: '800', fontSize: 12 },
  disabledSoft: { opacity: 0.55 },
  errorText: {
    color: c.error,
    marginTop: 8,
    fontSize: 12,
    fontWeight: '700',
  },
  analyticsMonthRow: {
    flexDirection: 'row',
    gap: 8,
    paddingBottom: 8,
    marginBottom: 2,
  },
  analyticsMonthChip: {
    minWidth: 148,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: r.md,
    backgroundColor: c.surfaceMuted,
    borderWidth: 1,
    borderColor: c.borderSoft,
  },
  analyticsMonthChipOn: {
    backgroundColor: c.primaryLight,
    borderColor: c.primary,
  },
  analyticsMonthChipText: { color: c.textSecondary, fontWeight: '800', fontSize: 13 },
  analyticsMonthChipTextOn: { color: c.primaryDark },
  analyticsMonthChipSub: { color: c.textMuted, fontSize: 10, marginTop: 3 },
  analyticsMonthChipSubOn: { color: c.text },
  analyticsStatGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
    marginTop: 10,
  },
  analyticsStatCard: {
    flexGrow: 1,
    flexBasis: '48%',
    minWidth: 142,
    padding: 12,
    borderRadius: r.sm,
    backgroundColor: c.surfaceElevated,
    borderWidth: 1,
    borderColor: c.borderSoft,
    borderLeftWidth: 4,
  },
  analyticsStatCardWellbeing: { borderLeftColor: c.checkIn },
  analyticsStatCardLate: { borderLeftColor: c.lateNoticeBar },
  analyticsStatCardSick: { borderLeftColor: c.leaveSickBar },
  analyticsStatHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginBottom: 6,
  },
  analyticsStatIconBubble: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  analyticsStatIconWellbeing: {
    backgroundColor: 'rgba(166, 184, 116, 0.16)',
    borderColor: 'rgba(166, 184, 116, 0.38)',
  },
  analyticsStatIconLate: {
    backgroundColor: c.lateNoticeBg,
    borderColor: 'rgba(224, 138, 79, 0.42)',
  },
  analyticsStatIconSick: {
    backgroundColor: c.leaveSickBg,
    borderColor: 'rgba(155, 134, 196, 0.42)',
  },
  analyticsStatLabel: { fontSize: 11, color: c.textMuted, fontWeight: '700', flexShrink: 1 },
  analyticsStatValue: { fontSize: 18, color: c.primaryDark, fontWeight: '900', marginTop: 2 },
  analyticsStatSub: { fontSize: 11, color: c.textSecondary, marginTop: 2 },
  analyticsSectionTitle: {
    marginTop: 14,
    marginBottom: 8,
    fontSize: 14,
    fontWeight: '800',
    color: c.text,
    ...sectionAccent,
  },
  lineChartCard: {
    marginTop: 8,
    paddingVertical: 10,
    borderRadius: r.sm,
    backgroundColor: c.surfaceElevated,
    borderWidth: 1,
    borderColor: c.borderSoft,
    overflow: 'hidden',
  },
  lineChartLegendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    paddingHorizontal: 10,
    marginBottom: 6,
  },
  lineChartLegendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  lineChartLegendDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
  },
  lineChartLegendText: {
    color: c.textSecondary,
    fontSize: 11,
    fontWeight: '800',
  },
  lineChartTooltip: {
    marginHorizontal: 10,
    marginBottom: 8,
    padding: 9,
    borderRadius: r.sm,
    backgroundColor: c.surfaceMuted,
    borderWidth: 1,
    borderColor: c.borderSoft,
  },
  lineChartTooltipTitle: {
    color: c.primaryDark,
    fontSize: 12,
    fontWeight: '900',
    marginBottom: 6,
  },
  lineChartTooltipRows: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  lineChartTooltipItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  lineChartTooltipText: {
    color: c.textSecondary,
    fontSize: 11,
    fontWeight: '700',
  },
  lineChartViewport: {
    width: '100%',
    maxWidth: 350,
    alignSelf: 'flex-start',
  },
  lineChartCanvasWrap: {
    position: 'relative',
  },
  lineChartHitZone: {
    position: 'absolute',
    top: 0,
  },
  lineChartScrollContent: {
    paddingHorizontal: 4,
  },
  lineChartHint: {
    paddingHorizontal: 10,
    marginTop: 4,
    color: c.textMuted,
    fontSize: 10,
  },
  analyticsChartRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingVertical: 6,
    paddingRight: 8,
  },
  analyticsBarCol: {
    width: 42,
    alignItems: 'center',
  },
  analyticsBarTrack: {
    height: 112,
    width: 30,
    justifyContent: 'flex-end',
    alignItems: 'stretch',
    backgroundColor: c.surfaceMuted,
    borderRadius: 8,
    overflow: 'hidden',
  },
  analyticsBarFill: {
    width: '100%',
    backgroundColor: c.primaryMuted,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
  },
  analyticsBarLabel: {
    marginTop: 5,
    fontSize: 10,
    color: c.textMuted,
    textAlign: 'center',
    minHeight: 26,
  },
  analyticsBarValue: {
    fontSize: 10,
    color: c.textSecondary,
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
  },
  analyticsBarSub: {
    fontSize: 9,
    color: c.textMuted,
    textAlign: 'center',
  },
  analyticsRankGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 14,
  },
  analyticsRankCard: {
    alignSelf: 'stretch',
    width: '100%',
    flexGrow: 0,
    flexShrink: 0,
    minWidth: 280,
    marginTop: 14,
    marginBottom: 16,
    padding: 10,
    borderRadius: r.sm,
    backgroundColor: c.surfaceElevated,
    borderWidth: 1,
    borderColor: c.borderSoft,
  },
  analyticsRankList: {
    alignSelf: 'stretch',
    width: '100%',
    flexGrow: 0,
    flexShrink: 0,
  },
  analyticsRankHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 8,
  },
  analyticsRankTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: c.text,
    marginBottom: 3,
  },
  analyticsRankHint: { fontSize: 11, color: c.textMuted, lineHeight: 16 },
  analyticsSortRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 8,
  },
  analyticsSortChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 6,
    paddingHorizontal: 9,
    borderRadius: 999,
    backgroundColor: c.surfaceMuted,
    borderWidth: 1,
    borderColor: c.borderSoft,
  },
  analyticsSortChipOn: {
    backgroundColor: c.lateNoticeBg,
    borderColor: c.lateNoticeBar,
  },
  analyticsSortChipSickOn: {
    backgroundColor: c.leaveSickBg,
    borderColor: c.leaveSickBar,
  },
  analyticsSortChipText: { fontSize: 11, color: c.textMuted, fontWeight: '800' },
  analyticsSortChipTextOn: { color: c.lateNoticeBar },
  analyticsSortChipTextSickOn: { color: c.leaveSickBar },
  analyticsRankRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: c.borderSoft,
  },
  analyticsRankNo: {
    width: 34,
    fontSize: 12,
    fontWeight: '900',
    color: c.primaryDark,
  },
  analyticsRankName: { fontSize: 13, color: c.text, fontWeight: '700' },
  analyticsRankMeta: { fontSize: 11, color: c.textMuted, marginTop: 2 },
  });
}
