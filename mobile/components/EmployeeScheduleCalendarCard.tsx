import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { TaskDetailModal } from '@/components/TaskDetailModal';
import type { AppTheme } from '@/constants/Theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { isAdmin, isManagerOrAdmin, useAuth, useRole } from '@/contexts/AuthContext';
import { useCuteToast } from '@/contexts/CuteToastContext';
import { leaveTypeLabelTh } from '@/lib/leaveAttendanceChat';
import {
  companyHolidayMapByDate,
  fetchCompanyHolidayDates,
} from '@/lib/companyHolidays';
import { mapBranchInformationRows } from '@/lib/mapBranchInformation';
import {
  buildAssignmentByUserDate,
  buildHolidayByUserDate,
  resolvedScheduleDayStatusForUser,
} from '@/lib/scheduleDayResolution';
import { priorityColor } from '@/lib/taskHelpers';
import { supabase } from '@/lib/supabase';
import type {
  Branch,
  CompanyHolidayDateRow,
  EmployeeHolidayDateRow,
  LeaveRequestType,
  TaskPriority,
} from '@/lib/types';

type Row = {
  ymd: string;
  title: string;
  startText: string;
  endText: string;
  source: 'shift' | 'legacy';
  allowedBranchId?: number | null;
  allowedBranchName?: string | null;
};

type Cell = {
  ymd: string | null;
  rows: Row[];
  markerSource: 'shift' | 'legacy' | 'memo' | null;
  companyHoliday: CompanyHolidayDateRow | null;
  employeeHoliday: boolean;
  approvedLeave: ApprovedLeave | null;
};

type HighlightDay = {
  ymd: string;
  rows: Row[];
  hasApprovedLeave: boolean;
  hasEmployeeHoliday: boolean;
  hasCompanyHoliday: boolean;
  hasMemo: boolean;
};

type ApprovedLeave = {
  id: string;
  leave_type: LeaveRequestType;
  starts_on: string;
  ends_on: string;
  reason: string | null;
};

type CalendarChecklistItem = {
  id: string;
  label: string;
  done: boolean;
};

type LiveWorkTask = {
  id: string;
  title: string;
  status: string;
  priority?: string | null;
  due_at?: string | null;
  created_at?: string | null;
};

function ymdFromDate(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function ymdToDate(ymd: string): Date {
  return new Date(`${ymd}T12:00:00+07:00`);
}

function ymdFromParts(year: number, month: number, day: number): string {
  const two = (n: number) => String(n).padStart(2, '0');
  return `${year}-${two(month)}-${two(day)}`;
}

function ymdPartsInBangkok(d: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const read = (type: 'year' | 'month' | 'day') =>
    Number(parts.find((p) => p.type === type)?.value ?? '0');
  return { year: read('year'), month: read('month'), day: read('day') };
}

function listYmdRange(startYmd: string, endYmd: string): string[] {
  const out: string[] = [];
  const d = ymdToDate(startYmd);
  const end = ymdToDate(endYmd).getTime();
  while (d.getTime() <= end) {
    out.push(ymdFromDate(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

function addMonthsLocal(d: Date, delta: number): Date {
  const next = new Date(d);
  next.setDate(1);
  next.setMonth(next.getMonth() + delta);
  return next;
}

function approvedLeaveForYmd(
  leaves: ApprovedLeave[],
  ymd: string
): ApprovedLeave | null {
  for (const row of leaves) {
    if (ymd >= row.starts_on && ymd <= row.ends_on) return row;
  }
  return null;
}

function taskStatusLabel(status: string): string {
  if (status === 'in_progress') return 'กำลังทำ';
  if (status === 'pending') return 'รอดำเนินการ';
  return status;
}

export function EmployeeScheduleCalendarCard({
  userId,
  title = 'ปฏิทินตารางงานของพนักงาน',
  sub = 'มุมมองรายเดือน · แตะวันที่เพื่อดูรายละเอียด',
  autoOpenFirstHighlight = false,
}: {
  userId: string;
  title?: string;
  /** คำอธิบายใต้หัวข้อ (เช่น บอกขอบเขตการมองเห็นเมื่อเปิดจากแชท) */
  sub?: string;
  /** เปิด popup รายวันอัตโนมัติเมื่อเดือนนั้นมีตารางหรือโน้ต */
  autoOpenFirstHighlight?: boolean;
}) {
  const toast = useCuteToast();
  const { session } = useAuth();
  const role = useRole();
  const manager = isManagerOrAdmin(role);
  const admin = isAdmin(role);
  const { theme } = useAppTheme();
  const c = theme.colors;
  const styles = useMemo(() => createEmployeeScheduleCalendarStyles(theme), [theme]);
  const [anchorDate, setAnchorDate] = useState<Date>(() => new Date());
  const [rows, setRows] = useState<Row[]>([]);
  const [approvedLeaves, setApprovedLeaves] = useState<ApprovedLeave[]>([]);
  const [companyHolidayRows, setCompanyHolidayRows] = useState<CompanyHolidayDateRow[]>([]);
  const [resolvedHolidayYmds, setResolvedHolidayYmds] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(false);
  const [selectedYmd, setSelectedYmd] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailRows, setDetailRows] = useState<Row[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [memoYmdSet, setMemoYmdSet] = useState<Set<string>>(() => new Set());
  const [dayNote, setDayNote] = useState('');
  const [dayChecklist, setDayChecklist] = useState<CalendarChecklistItem[]>([]);
  const [dayNewItemText, setDayNewItemText] = useState('');
  const [dayMemoLoading, setDayMemoLoading] = useState(false);
  const [dayMemoSaving, setDayMemoSaving] = useState(false);
  const [canEditNotes, setCanEditNotes] = useState(false);
  const [liveWorkTasks, setLiveWorkTasks] = useState<LiveWorkTask[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const autoOpenedKeyRef = useRef<string | null>(null);
  const modalOpacity = useRef(new Animated.Value(0)).current;
  const modalSlideY = useRef(new Animated.Value(22)).current;
  const livePulse = useRef(new Animated.Value(1)).current;

  const period = useMemo(() => {
    const { year, month } = ymdPartsInBangkok(anchorDate);
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    const firstThis = ymdFromParts(year, month, 1);
    const firstNext = ymdFromParts(nextYear, nextMonth, 1);
    const lastThis = ymdFromDate(new Date(`${firstNext}T12:00:00+07:00`));
    const d = ymdToDate(lastThis);
    d.setDate(d.getDate() - 1);
    return { startYmd: firstThis, endYmd: ymdFromDate(d) };
  }, [anchorDate]);

  const rowsByYmd = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const r of rows) {
      const arr = map.get(r.ymd) ?? [];
      arr.push(r);
      map.set(r.ymd, arr);
    }
    return map;
  }, [rows]);

  const approvedLeavesByYmd = useMemo(() => {
    const map = new Map<string, ApprovedLeave[]>();
    for (const leave of approvedLeaves) {
      for (const ymd of listYmdRange(leave.starts_on, leave.ends_on)) {
        if (ymd < period.startYmd || ymd > period.endYmd) continue;
        const arr = map.get(ymd) ?? [];
        arr.push(leave);
        map.set(ymd, arr);
      }
    }
    return map;
  }, [approvedLeaves, period.endYmd, period.startYmd]);

  const companyHolidayByDate = useMemo(
    () => companyHolidayMapByDate(companyHolidayRows),
    [companyHolidayRows]
  );

  const workDaysCount = useMemo(() => new Set(rows.map((r) => r.ymd)).size, [rows]);

  const employeeHolidayDaysCount = useMemo(() => {
    let count = 0;
    for (const ymd of listYmdRange(period.startYmd, period.endYmd)) {
      if (resolvedHolidayYmds.has(ymd)) count += 1;
    }
    return count;
  }, [period.endYmd, period.startYmd, resolvedHolidayYmds]);

  const gridCells = useMemo(() => {
    const first = ymdToDate(period.startYmd);
    const firstDowSun0 = first.getDay();
    const lead = (firstDowSun0 + 6) % 7;
    const dates = listYmdRange(period.startYmd, period.endYmd);
    const cells: Cell[] = [];
    for (let i = 0; i < lead; i += 1) {
      cells.push({
        ymd: null,
        rows: [],
        markerSource: null,
        companyHoliday: null,
        employeeHoliday: false,
        approvedLeave: null,
      });
    }
    for (const ymd of dates) {
      const dayRows = rowsByYmd.get(ymd) ?? [];
      const hasMemo = memoYmdSet.has(ymd);
      const approvedLeave = approvedLeaveForYmd(approvedLeaves, ymd);
      const employeeHoliday = resolvedHolidayYmds.has(ymd);
      const markerSource =
        approvedLeave || employeeHoliday
          ? null
          : dayRows.find((r) => r.source === 'shift')
            ? 'shift'
            : dayRows.length > 0
              ? 'legacy'
              : hasMemo
                ? 'memo'
                : null;
      cells.push({
        ymd,
        rows: dayRows,
        markerSource,
        companyHoliday: companyHolidayByDate.get(ymd) ?? null,
        employeeHoliday,
        approvedLeave,
      });
    }
    while (cells.length % 7 !== 0) {
      cells.push({
        ymd: null,
        rows: [],
        markerSource: null,
        companyHoliday: null,
        employeeHoliday: false,
        approvedLeave: null,
      });
    }
    return cells;
  }, [
    approvedLeaves,
    companyHolidayByDate,
    memoYmdSet,
    period.endYmd,
    period.startYmd,
    resolvedHolidayYmds,
    rowsByYmd,
  ]);

  const highlightDays = useMemo<HighlightDay[]>(
    () =>
      listYmdRange(period.startYmd, period.endYmd)
        .map((ymd) => ({
          ymd,
          rows: rowsByYmd.get(ymd) ?? [],
          hasApprovedLeave: approvedLeavesByYmd.has(ymd),
          hasEmployeeHoliday: resolvedHolidayYmds.has(ymd),
          hasCompanyHoliday: companyHolidayByDate.has(ymd),
          hasMemo: memoYmdSet.has(ymd),
        }))
        .filter(
          (d) =>
            d.rows.length > 0 ||
            d.hasApprovedLeave ||
            d.hasEmployeeHoliday ||
            d.hasCompanyHoliday ||
            d.hasMemo
        ),
    [
      approvedLeavesByYmd,
      companyHolidayByDate,
      memoYmdSet,
      period.endYmd,
      period.startYmd,
      resolvedHolidayYmds,
      rowsByYmd,
    ]
  );

  function openDayPopup(ymd: string, dayRows: Row[]) {
    setSelectedYmd(ymd);
    setDetailRows(dayRows);
    setDetailOpen(true);
  }

  useEffect(() => {
    if (!autoOpenFirstHighlight || loading) return;
    if (highlightDays.length === 0 && liveWorkTasks.length === 0) return;
    const key = `${userId}:${period.startYmd}:${period.endYmd}`;
    if (autoOpenedKeyRef.current === key) return;
    autoOpenedKeyRef.current = key;
    const today = ymdFromDate(new Date());
    const upcoming = highlightDays.find((d) => d.ymd >= today) ?? highlightDays[0] ?? {
      ymd: today,
      rows: [],
    };
    openDayPopup(upcoming.ymd, upcoming.rows);
  }, [
    autoOpenFirstHighlight,
    highlightDays,
    liveWorkTasks.length,
    loading,
    period.endYmd,
    period.startYmd,
    userId,
  ]);

  useEffect(() => {
    if (!detailOpen) return;
    modalOpacity.setValue(0);
    modalSlideY.setValue(22);
    Animated.parallel([
      Animated.timing(modalOpacity, {
        toValue: 1,
        duration: 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.spring(modalSlideY, {
        toValue: 0,
        friction: 8,
        tension: 70,
        useNativeDriver: true,
      }),
    ]).start();
  }, [detailOpen, modalOpacity, modalSlideY]);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(livePulse, {
          toValue: 1.08,
          duration: 850,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(livePulse, {
          toValue: 1,
          duration: 850,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [livePulse]);

  useEffect(() => {
    let alive = true;
    const viewer = session?.user?.id;
    if (!viewer || !userId) {
      setCanEditNotes(false);
      return () => {
        alive = false;
      };
    }
    if (viewer === userId) {
      setCanEditNotes(true);
      return () => {
        alive = false;
      };
    }
    if (isAdmin(role)) {
      setCanEditNotes(true);
      return () => {
        alive = false;
      };
    }
    if (!isManagerOrAdmin(role)) {
      setCanEditNotes(false);
      return () => {
        alive = false;
      };
    }
    (async () => {
      const [{ data: sc }, { data: rep }] = await Promise.all([
        supabase
          .from('manager_scopes')
          .select('can_manage_schedule')
          .eq('manager_id', viewer)
          .maybeSingle(),
        supabase
          .from('manager_direct_reports')
          .select('subordinate_id')
          .eq('manager_id', viewer)
          .eq('subordinate_id', userId)
          .maybeSingle(),
      ]);
      if (!alive) return;
      const canSch = !!(sc as { can_manage_schedule?: boolean } | null)?.can_manage_schedule;
      setCanEditNotes(canSch && !!rep);
    })();
    return () => {
      alive = false;
    };
  }, [session?.user?.id, userId, role]);

  const loadCalendar = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const [branchRes, assignmentRes, legacyRes, memoRes, leaveRes, empHolRes, companyHolRes, assigneeRes, directTaskRes] =
        await Promise.all([
        supabase.from('branch_information').select('*').order('branch_name'),
        supabase
          .from('work_schedule_assignments')
          .select('work_date, shift_id, allowed_branch_id, created_at')
          .eq('user_id', userId)
          .gte('work_date', period.startYmd)
          .lte('work_date', period.endYmd)
          .order('work_date', { ascending: true }),
        supabase
          .from('work_schedules')
          .select('start_at, end_at, title')
          .eq('user_id', userId)
          .lte('start_at', new Date(`${period.endYmd}T23:59:59+07:00`).toISOString())
          .gte('end_at', new Date(`${period.startYmd}T00:00:00+07:00`).toISOString())
          .order('start_at', { ascending: true }),
        supabase
          .from('attendance_calendar_notes')
          .select('work_date, note, checklist')
          .eq('user_id', userId)
          .gte('work_date', period.startYmd)
          .lte('work_date', period.endYmd),
        supabase
          .from('leave_requests')
          .select('id, leave_type, starts_on, ends_on, reason')
          .eq('user_id', userId)
          .eq('status', 'approved')
          .lte('starts_on', period.endYmd)
          .gte('ends_on', period.startYmd)
          .order('starts_on', { ascending: true }),
        supabase
          .from('employee_holiday_dates')
          .select('id, user_id, holiday_date, created_at')
          .eq('user_id', userId)
          .gte('holiday_date', period.startYmd)
          .lte('holiday_date', period.endYmd),
        fetchCompanyHolidayDates({ startYmd: period.startYmd, endYmd: period.endYmd }).catch(
          () => [] as CompanyHolidayDateRow[]
        ),
        supabase
          .from('task_assignees')
          .select('task_id')
          .eq('user_id', userId),
        supabase
          .from('tasks')
          .select('id,title,status,priority,due_at,created_at')
          .eq('assigned_to', userId)
          .in('status', ['pending', 'in_progress'])
          .order('created_at', { ascending: false })
          .limit(20),
      ]);
      const branchRows = mapBranchInformationRows(
        (branchRes.data as Record<string, unknown>[]) ?? []
      );
      setBranches(branchRows);

      if (memoRes.error) {
        setMemoYmdSet(new Set());
      } else {
        const memoRows = (memoRes.data ?? []) as Array<{
          work_date: string;
          note?: string | null;
          checklist?: unknown;
        }>;
        const nextMemo = new Set<string>();
        for (const m of memoRows) {
          const clen = Array.isArray(m.checklist) ? m.checklist.length : 0;
          if ((m.note ?? '').trim() || clen > 0) nextMemo.add(m.work_date);
        }
        setMemoYmdSet(nextMemo);
      }

      if (leaveRes.error) {
        setApprovedLeaves([]);
      } else {
        setApprovedLeaves(((leaveRes.data ?? []) as ApprovedLeave[]) ?? []);
      }
      setCompanyHolidayRows(companyHolRes);

      const approvedLeavesList = leaveRes.error
        ? []
        : (((leaveRes.data ?? []) as ApprovedLeave[]) ?? []);
      const employeeHolidayRows = ((empHolRes.data ?? []) as EmployeeHolidayDateRow[]) ?? [];
      const holidayByUserDate = buildHolidayByUserDate(employeeHolidayRows);

      const assignments = (assignmentRes.data ?? []) as Array<{
        work_date: string;
        shift_id: string;
        allowed_branch_id?: number | null;
        created_at?: string;
      }>;
      const assignmentByUserDate = buildAssignmentByUserDate(
        assignments.map((row) => ({
          user_id: userId,
          work_date: row.work_date,
          created_at: row.created_at ?? '',
        }))
      );
      const nextResolvedHolidayYmds = new Set<string>();
      for (const row of employeeHolidayRows) {
        const status = resolvedScheduleDayStatusForUser(
          userId,
          row.holiday_date,
          holidayByUserDate,
          assignmentByUserDate
        );
        if (status === 'holiday') nextResolvedHolidayYmds.add(row.holiday_date);
      }
      setResolvedHolidayYmds(nextResolvedHolidayYmds);

      const dayShowsWork = (ymd: string) => {
        if (approvedLeaveForYmd(approvedLeavesList, ymd)) return false;
        const status = resolvedScheduleDayStatusForUser(
          userId,
          ymd,
          holidayByUserDate,
          assignmentByUserDate
        );
        return status !== 'holiday';
      };
      const shiftIds = [...new Set(assignments.map((a) => a.shift_id).filter(Boolean))];
      let shiftById = new Map<string, { name: string; start_time: string; end_time: string }>();
      if (shiftIds.length > 0) {
        const shiftsRes = await supabase
          .from('work_shifts')
          .select('id,name,start_time,end_time')
          .in('id', shiftIds);
        shiftById = new Map(
          ((shiftsRes.data ?? []) as Array<Record<string, unknown>>).map((s) => [
            String(s.id),
            {
              name: String(s.name ?? 'กะงาน'),
              start_time: String(s.start_time ?? '00:00:00'),
              end_time: String(s.end_time ?? '00:00:00'),
            },
          ])
        );
      }

      const branchNameById = new Map<number, string>();
      for (const b of branchRows) {
        branchNameById.set(b.id, b.branch_name || b.branch_code || `สาขา ${b.id}`);
      }
      const dailyShiftMap = new Map<string, Row>();
      for (const row of assignments) {
        const shift = shiftById.get(row.shift_id);
        if (!shift) continue;
        dailyShiftMap.set(row.work_date, {
          ymd: row.work_date,
          title: shift.name || 'กะงาน',
          startText: shift.start_time.slice(0, 5),
          endText: shift.end_time.slice(0, 5),
          source: 'shift',
          allowedBranchId: row.allowed_branch_id ?? null,
          allowedBranchName:
            row.allowed_branch_id != null
              ? branchNameById.get(row.allowed_branch_id) ?? null
              : null,
        });
      }

      const legacyRows = ((legacyRes.data ?? []) as Array<Record<string, unknown>>).map((r) => ({
        startYmd: ymdFromDate(new Date(String(r.start_at))),
        endYmd: ymdFromDate(new Date(String(r.end_at))),
        title: String(r.title ?? 'กะงาน'),
        startText: new Date(String(r.start_at)).toLocaleTimeString('th-TH', {
          hour: '2-digit',
          minute: '2-digit',
        }),
        endText: new Date(String(r.end_at)).toLocaleTimeString('th-TH', {
          hour: '2-digit',
          minute: '2-digit',
        }),
      }));

      const out: Row[] = [];
      for (const ymd of listYmdRange(period.startYmd, period.endYmd)) {
        if (!dayShowsWork(ymd)) continue;
        const shift = dailyShiftMap.get(ymd);
        if (shift) {
          out.push(shift);
          continue;
        }
        const legacy = legacyRows.find((r) => ymd >= r.startYmd && ymd <= r.endYmd);
        if (legacy) {
          out.push({
            ymd,
            title: legacy.title,
            startText: legacy.startText,
            endText: legacy.endText,
            source: 'legacy',
          });
        }
      }
      setRows(out);

      const linkedTaskIds = [
        ...new Set(
          ((assigneeRes.data ?? []) as { task_id?: string }[])
            .map((r) => r.task_id)
            .filter((v): v is string => !!v)
        ),
      ];
      const linkedTaskRes = linkedTaskIds.length
        ? await supabase
            .from('tasks')
            .select('id,title,status,priority,due_at,created_at')
            .in('id', linkedTaskIds)
            .in('status', ['pending', 'in_progress'])
            .order('created_at', { ascending: false })
            .limit(20)
        : { data: [] as unknown[] };
      const taskMap = new Map<string, LiveWorkTask>();
      for (const t of [
        ...(((linkedTaskRes.data ?? []) as unknown[]) as LiveWorkTask[]),
        ...(((directTaskRes.data ?? []) as unknown[]) as LiveWorkTask[]),
      ]) {
        taskMap.set(t.id, t);
      }
      setLiveWorkTasks(
        [...taskMap.values()].sort((a, b) => {
          if (a.status !== b.status) return a.status === 'in_progress' ? -1 : 1;
          return new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime();
        })
      );
    } finally {
      setLoading(false);
    }
  }, [period.endYmd, period.startYmd, userId]);

  useEffect(() => {
    void loadCalendar();
  }, [loadCalendar]);

  const loadDayMemo = useCallback(
    async (ymd: string) => {
      if (!userId) return;
      setDayMemoLoading(true);
      try {
        const { data, error } = await supabase
          .from('attendance_calendar_notes')
          .select('note, checklist, updated_at')
          .eq('user_id', userId)
          .eq('work_date', ymd)
          .order('updated_at', { ascending: false })
          .limit(1);
        if (error) throw error;
        const row =
          (data as Array<{ note?: string | null; checklist?: unknown }> | null)?.[0] ?? null;
        setDayNote(row?.note ?? '');
        const rawList = Array.isArray(row?.checklist) ? row?.checklist : [];
        const list: CalendarChecklistItem[] = rawList
          .map((it) => {
            const obj = it as { id?: unknown; label?: unknown; done?: unknown };
            const label = typeof obj.label === 'string' ? obj.label.trim() : '';
            if (!label) return null;
            return {
              id:
                typeof obj.id === 'string' && obj.id.trim()
                  ? obj.id
                  : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              label,
              done: Boolean(obj.done),
            };
          })
          .filter((v): v is CalendarChecklistItem => !!v);
        setDayChecklist(list);
      } catch (e) {
        toast.error(
          'โหลดโน้ตปฏิทินไม่สำเร็จ',
          e instanceof Error ? e.message : String(e)
        );
        setDayNote('');
        setDayChecklist([]);
      } finally {
        setDayMemoLoading(false);
      }
    },
    [toast, userId]
  );

  async function saveDayMemo(ymd: string) {
    if (!userId || !canEditNotes) return;
    setDayMemoSaving(true);
    const noteTrim = dayNote.trim();
    const checklistPayload = dayChecklist.map((it) => ({
      id: it.id,
      label: it.label.trim(),
      done: it.done,
    }));
    const { error } = await supabase
      .from('attendance_calendar_notes')
      .upsert(
        {
          user_id: userId,
          work_date: ymd,
          note: noteTrim || null,
          checklist: checklistPayload,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,work_date' }
      )
      .select('note, checklist, work_date')
      .single();
    setDayMemoSaving(false);
    if (error) {
      toast.error('บันทึกข้อมูลไม่สำเร็จ', error.message);
      return;
    }
    toast.success('บันทึกแล้ว', 'อัปเดตโน้ต/เช็กลิสต์ของวันนี้เรียบร้อย');
    const hasMemo = Boolean(noteTrim) || checklistPayload.length > 0;
    setMemoYmdSet((prev) => {
      const next = new Set(prev);
      if (hasMemo) next.add(ymd);
      else next.delete(ymd);
      return next;
    });
    await loadDayMemo(ymd);
  }

  useEffect(() => {
    if (!detailOpen || !selectedYmd) return;
    setDayNewItemText('');
    void loadDayMemo(selectedYmd);
  }, [detailOpen, selectedYmd, loadDayMemo]);

  const selectedApprovedLeaves = selectedYmd ? (approvedLeavesByYmd.get(selectedYmd) ?? []) : [];
  const selectedHasApprovedLeave = selectedApprovedLeaves.length > 0;
  const selectedCompanyHoliday = selectedYmd
    ? companyHolidayByDate.get(selectedYmd) ?? null
    : null;
  const selectedEmployeeHoliday = !!(
    selectedYmd && resolvedHolidayYmds.has(selectedYmd) && !selectedHasApprovedLeave
  );
  const approvedLeaveDayCount = approvedLeavesByYmd.size;

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.sub}>{sub}</Text>
      <View style={styles.monthNavRow}>
        <Pressable style={styles.monthNavBtn} onPress={() => setAnchorDate((p) => addMonthsLocal(p, -1))}>
          <Text style={styles.monthNavBtnText}>{'< เดือนก่อน'}</Text>
        </Pressable>
        <Text style={styles.monthNavLabel}>
          {anchorDate.toLocaleDateString('th-TH', { month: 'long', year: 'numeric' })}
        </Text>
        <Pressable style={styles.monthNavBtn} onPress={() => setAnchorDate((p) => addMonthsLocal(p, 1))}>
          <Text style={styles.monthNavBtnText}>{'เดือนถัดไป >'}</Text>
        </Pressable>
      </View>
      {loading ? (
        <ActivityIndicator color={c.primary} style={{ marginVertical: 12 }} />
      ) : (
        <>
          {highlightDays.length > 0 ||
          liveWorkTasks.length > 0 ||
          employeeHolidayDaysCount > 0 ||
          approvedLeaveDayCount > 0 ? (
            <View style={styles.highlightCard}>
              <View style={styles.highlightCopy}>
                <Text style={styles.highlightTitle}>
                  มีตารางงาน {workDaysCount} วัน · วันหยุด {employeeHolidayDaysCount} วัน · ลา{' '}
                  {approvedLeaveDayCount} วัน · Live Work {liveWorkTasks.length} งาน
                </Text>
                <Text style={styles.highlightSub}>
                  แตะวันที่ในปฏิทินเพื่อดูตารางงาน วันหยุดบริษัท/ส่วนตัว และการลาที่อนุมัติแล้ว
                </Text>
              </View>
              <Pressable
                style={styles.highlightBtn}
                onPress={() => {
                  const today = ymdFromDate(new Date());
                  const upcoming =
                    highlightDays.find((d) => d.ymd >= today) ??
                    highlightDays[0] ?? { ymd: today, rows: [] };
                  openDayPopup(upcoming.ymd, upcoming.rows);
                }}>
                <Text style={styles.highlightBtnText}>เปิดอีกครั้ง</Text>
              </Pressable>
            </View>
          ) : null}
          <View style={styles.weekHeader}>
            {['จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส', 'อา'].map((d) => (
              <Text key={d} style={styles.weekHeaderText}>
                {d}
              </Text>
            ))}
          </View>
          <View style={styles.grid}>
            {gridCells.map((cell, idx) => (
              <Pressable
                key={`${cell.ymd ?? 'blank'}-${idx}`}
                disabled={!cell.ymd}
                style={[styles.cell, cell.ymd && selectedYmd === cell.ymd && styles.cellSelected]}
                onPress={() => {
                  if (!cell.ymd) return;
                  openDayPopup(cell.ymd, cell.rows);
                }}>
                <Text style={[styles.dayNumber, !cell.ymd && styles.dayNumberMuted]}>
                  {cell.ymd ? String(Number(cell.ymd.slice(8, 10))) : ''}
                </Text>
                {cell.companyHoliday ? (
                  <Text style={styles.calendarCompanyHolidayText} numberOfLines={1}>
                    {cell.companyHoliday.title}
                  </Text>
                ) : null}
                {cell.approvedLeave ? (
                  <Text style={styles.calendarLeaveText} numberOfLines={1}>
                    {leaveTypeLabelTh(cell.approvedLeave.leave_type)}
                  </Text>
                ) : cell.employeeHoliday ? (
                  <Text style={styles.calendarEmployeeHolidayText} numberOfLines={1}>
                    วันหยุด
                  </Text>
                ) : null}
                {cell.markerSource ? (
                  <View
                    style={[
                      styles.dot,
                      cell.markerSource === 'shift'
                        ? styles.dotShift
                        : cell.markerSource === 'legacy'
                          ? styles.dotLegacy
                          : styles.dotMemo,
                    ]}
                  />
                ) : null}
                {cell.markerSource && cell.rows.length > 0 ? (
                  <Text style={styles.calendarMiniLabel}>มีงาน</Text>
                ) : null}
              </Pressable>
            ))}
          </View>
        </>
      )}

      <Modal
        visible={detailOpen}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setDetailOpen(false)}>
        <View style={styles.detailOverlayWrap}>
          <Pressable style={styles.detailBackdrop} onPress={() => setDetailOpen(false)} />
          <Animated.View
            style={[
              styles.detailCard,
              { opacity: modalOpacity, transform: [{ translateY: modalSlideY }] },
            ]}>
            <Pressable onPress={() => {}}>
              <View style={styles.popupHero}>
                <View style={styles.popupHeroCopy}>
                  <Text style={styles.popupKicker}>Schedule · Notes · Live Work</Text>
                  <Text style={styles.detailTitle}>
                    {selectedYmd
                      ? selectedHasApprovedLeave
                        ? `สถานะการลาวันที่ ${selectedYmd}`
                        : selectedEmployeeHoliday
                          ? `วันหยุดวันที่ ${selectedYmd}`
                          : `ตารางงานวันที่ ${selectedYmd}`
                      : 'ตารางงาน'}
                  </Text>
                  <Text style={styles.detailSub}>
                    {selectedHasApprovedLeave
                      ? 'วันนี้มีการลาที่ได้รับการอนุมัติแล้ว'
                      : selectedEmployeeHoliday
                        ? 'วันนี้เป็นวันหยุดตามตารางงาน'
                        : selectedCompanyHoliday
                          ? `วันหยุดบริษัท: ${selectedCompanyHoliday.title}`
                          : detailRows.length > 0 && selectedYmd && memoYmdSet.has(selectedYmd)
                            ? 'วันนี้มีทั้งตารางงานและโน้ต/เช็กลิสต์'
                            : detailRows.length > 0
                              ? 'รายละเอียดตารางงานที่มอบหมายในวันดังกล่าว'
                              : selectedYmd && memoYmdSet.has(selectedYmd)
                                ? 'วันนี้มีโน้ต/เช็กลิสต์ที่บันทึกไว้'
                                : liveWorkTasks.length > 0
                                  ? 'วันนี้ยังไม่มีตารางงาน แต่มีงานที่กำลังดำเนินการ'
                                  : 'วันนี้ยังไม่มีตารางงาน แต่สามารถจดโน้ต/เช็กลิสต์ได้'}
                  </Text>
                </View>
                <Animated.View
                  style={[styles.liveBadge, { transform: [{ scale: livePulse }] }]}>
                  <Text style={styles.liveBadgeNum}>{liveWorkTasks.length}</Text>
                  <Text style={styles.liveBadgeText}>Live</Text>
                </Animated.View>
              </View>
            <ScrollView style={{ maxHeight: 420 }} keyboardShouldPersistTaps="handled">
              <View style={styles.liveWorkPanel}>
                <View style={styles.liveWorkPanelHead}>
                  <View>
                    <Text style={styles.liveWorkEyebrow}>Live Work</Text>
                    <Text style={styles.liveWorkTitle}>งานที่กำลังทำตอนนี้</Text>
                  </View>
                  <View style={styles.liveWorkCountPill}>
                    <Text style={styles.liveWorkCountText}>{liveWorkTasks.length} งาน</Text>
                  </View>
                </View>
                {liveWorkTasks.length === 0 ? (
                  <Text style={styles.liveWorkEmpty}>ยังไม่มีงานกำลังทำหรือรอดำเนินการ</Text>
                ) : (
                  liveWorkTasks.slice(0, 4).map((task) => (
                    <Pressable
                      key={task.id}
                      style={({ pressed }) => [
                        styles.liveWorkRow,
                        pressed && styles.liveWorkRowPressed,
                      ]}
                      onPress={() => setSelectedTaskId(task.id)}>
                      <View
                        style={[
                          styles.liveWorkPriority,
                          {
                            backgroundColor: priorityColor(
                              (task.priority as TaskPriority) || 'normal'
                            ),
                          },
                        ]}
                      />
                      <View style={styles.liveWorkBody}>
                        <Text style={styles.liveWorkTaskTitle} numberOfLines={1}>
                          {task.title}
                        </Text>
                        <Text style={styles.liveWorkTaskMeta} numberOfLines={1}>
                          {taskStatusLabel(task.status)}
                          {task.due_at
                            ? ` · กำหนด ${new Date(task.due_at).toLocaleDateString('th-TH')}`
                            : ''}
                        </Text>
                        <Text style={styles.liveWorkOpenHint}>แตะเพื่อดูรายละเอียดงาน</Text>
                      </View>
                    </Pressable>
                  ))
                )}
              </View>
              {selectedCompanyHoliday ? (
                <View style={styles.companyHolidayBanner}>
                  <Text style={styles.companyHolidayBannerLabel}>วันหยุดประจำปีบริษัท</Text>
                  <Text style={styles.companyHolidayBannerTitle}>
                    {selectedCompanyHoliday.title}
                  </Text>
                  {selectedCompanyHoliday.description?.trim() ? (
                    <Text style={styles.companyHolidayBannerDesc}>
                      {selectedCompanyHoliday.description.trim()}
                    </Text>
                  ) : null}
                </View>
              ) : null}
              {selectedEmployeeHoliday ? (
                <View style={styles.employeeHolidayBanner}>
                  <Text style={styles.employeeHolidayBannerLabel}>วันหยุด</Text>
                  <Text style={styles.employeeHolidayBannerTitle}>
                    วันนี้เป็นวันหยุดตามตารางงาน
                  </Text>
                </View>
              ) : null}
              {selectedHasApprovedLeave ? (
                <View style={styles.leaveStatusPanel}>
                  <View style={styles.leaveStatusHeader}>
                    <View style={styles.leaveStatusIcon}>
                      <FontAwesome name="calendar-check-o" size={18} color={c.leaveSickBar} />
                    </View>
                    <View style={styles.leaveStatusCopy}>
                      <Text style={styles.leaveStatusTitle}>วันนี้ลาอนุมัติแล้ว</Text>
                      <Text style={styles.leaveStatusSub}>
                        แสดงสถานะการลาแทนตารางเวลาเข้างานของวันนี้
                      </Text>
                    </View>
                  </View>
                  {selectedApprovedLeaves.map((leave) => (
                    <View key={leave.id} style={styles.leaveStatusRow}>
                      <Text style={styles.leaveStatusType}>{leaveTypeLabelTh(leave.leave_type)}</Text>
                      <Text style={styles.leaveStatusMeta}>
                        ช่วงลา {leave.starts_on} - {leave.ends_on} · อนุมัติแล้ว
                      </Text>
                      {leave.reason ? (
                        <Text style={styles.leaveStatusReason} numberOfLines={3}>
                          เหตุผล: {leave.reason}
                        </Text>
                      ) : null}
                    </View>
                  ))}
                </View>
              ) : detailRows.length > 0 ? (
                detailRows.map((row, idx) => (
                  <View key={`${row.ymd}-${row.source}-${idx}`} style={styles.detailRow}>
                    <Text style={styles.detailRowTitle}>{row.title}</Text>
                    <Text style={styles.detailRowMeta}>
                      เวลา {row.startText} - {row.endText}
                    </Text>
                    <Text style={styles.detailRowMeta}>
                      สาขาที่เข้าได้:{' '}
                      {row.allowedBranchId != null
                        ? row.allowedBranchName || `#${row.allowedBranchId}`
                        : 'ไม่จำกัด'}
                    </Text>
                  </View>
                ))
              ) : (
                <Text style={styles.empty}>ยังไม่มีข้อมูลตารางงาน</Text>
              )}
              <View style={styles.dayMemoCard}>
                <Text style={styles.dayMemoTitle}>บันทึกงานของวัน (คล้ายกิจกรรม)</Text>
                {!canEditNotes ? (
                  <Text style={styles.readOnlyHint}>ดูได้อย่างเดียว — เฉพาะพนักงานหรือผู้จัดการที่มีสิทธิ์จัดตารางจึงแก้ไขได้</Text>
                ) : null}
                {dayMemoLoading ? (
                  <ActivityIndicator color={c.primary} style={{ marginVertical: 12 }} />
                ) : (
                  <>
                    <TextInput
                      style={styles.dayMemoInput}
                      value={dayNote}
                      onChangeText={setDayNote}
                      placeholder="เพิ่มโน้ตของวันนี้..."
                      placeholderTextColor={c.textMuted}
                      multiline
                      editable={canEditNotes}
                    />
                    <Text style={styles.dayMemoSectionTitle}>เช็กลิสต์</Text>
                    {dayChecklist.length === 0 ? (
                      <Text style={styles.dayMemoEmpty}>ยังไม่มีรายการเช็กลิสต์</Text>
                    ) : (
                      dayChecklist.map((item) => (
                        <View key={item.id} style={styles.dayChecklistRow}>
                          <Pressable
                            style={styles.dayChecklistCheck}
                            disabled={!canEditNotes}
                            onPress={() =>
                              setDayChecklist((prev) =>
                                prev.map((it) =>
                                  it.id === item.id ? { ...it, done: !it.done } : it
                                )
                              )
                            }>
                            <FontAwesome
                              name={item.done ? 'check-square-o' : 'square-o'}
                              size={18}
                              color={
                                item.done ? c.checkIn : c.textMuted
                              }
                            />
                          </Pressable>
                          <Text
                            style={[styles.dayChecklistLabel, item.done && styles.dayChecklistLabelDone]}>
                            {item.label}
                          </Text>
                          <Pressable
                            style={styles.dayChecklistDeleteBtn}
                            disabled={!canEditNotes}
                            onPress={() =>
                              setDayChecklist((prev) => prev.filter((it) => it.id !== item.id))
                            }>
                            <FontAwesome name="trash-o" size={16} color={c.error} />
                          </Pressable>
                        </View>
                      ))
                    )}
                    {canEditNotes ? (
                      <View style={styles.dayChecklistAddRow}>
                        <TextInput
                          style={styles.dayChecklistAddInput}
                          value={dayNewItemText}
                          onChangeText={setDayNewItemText}
                          placeholder="เพิ่มรายการเช็กลิสต์"
                          placeholderTextColor={c.textMuted}
                        />
                        <Pressable
                          style={styles.dayChecklistAddBtn}
                          onPress={() => {
                            const next = dayNewItemText.trim();
                            if (!next) return;
                            setDayChecklist((prev) => [
                              ...prev,
                              {
                                id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                                label: next,
                                done: false,
                              },
                            ]);
                            setDayNewItemText('');
                          }}>
                          <Text style={styles.dayChecklistAddBtnText}>เพิ่ม</Text>
                        </Pressable>
                      </View>
                    ) : null}
                  </>
                )}
              </View>
            </ScrollView>
            {canEditNotes && selectedYmd ? (
              <Pressable
                style={[styles.saveMemoBtn, dayMemoSaving && styles.saveMemoBtnDisabled]}
                disabled={dayMemoSaving || dayMemoLoading}
                onPress={() => void saveDayMemo(selectedYmd)}>
                <Text style={styles.saveMemoBtnText}>
                  {dayMemoSaving ? 'กำลังบันทึก...' : 'บันทึกโน้ต/เช็กลิสต์'}
                </Text>
              </Pressable>
            ) : null}
            <Pressable style={styles.closeBtn} onPress={() => setDetailOpen(false)}>
              <Text style={styles.closeBtnText}>ปิด</Text>
            </Pressable>
            </Pressable>
          </Animated.View>
        </View>
      </Modal>
      <TaskDetailModal
        visible={selectedTaskId != null}
        taskId={selectedTaskId}
        userId={session?.user?.id ?? userId}
        onClose={() => setSelectedTaskId(null)}
        onChanged={loadCalendar}
        manager={manager}
        admin={admin}
      />
    </View>
  );
}

function createEmployeeScheduleCalendarStyles(theme: AppTheme) {
  const c = theme.colors;
  const r = theme.radius;

  return StyleSheet.create({
  wrap: {
    marginTop: 14,
    borderWidth: 1,
    borderColor: c.borderSoft,
    borderRadius: r.md,
    backgroundColor: c.surface,
    padding: 10,
  },
  title: { fontSize: 15, fontWeight: '700', color: c.text },
  sub: { fontSize: 12, color: c.textMuted, marginTop: 4, marginBottom: 8 },
  monthNavRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  monthNavBtn: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: r.sm,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.surfaceElevated,
  },
  monthNavBtnText: { fontSize: 12, color: c.primaryDark, fontWeight: '700' },
  monthNavLabel: { flex: 1, textAlign: 'center', fontSize: 13, color: c.text, fontWeight: '700' },
  highlightCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: c.primaryMuted,
    backgroundColor: c.primaryLight,
    borderRadius: r.sm,
    padding: 10,
    marginBottom: 8,
  },
  highlightCopy: { flex: 1, minWidth: 0 },
  highlightTitle: { color: c.primaryDark, fontSize: 12, fontWeight: '800' },
  highlightSub: { color: c.textSecondary, fontSize: 11, marginTop: 3, lineHeight: 15 },
  highlightBtn: {
    borderRadius: r.sm,
    backgroundColor: c.primary,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  highlightBtnText: { color: c.onAccent, fontSize: 11, fontWeight: '800' },
  weekHeader: { flexDirection: 'row', marginBottom: 5 },
  weekHeaderText: { flex: 1, textAlign: 'center', fontSize: 11, color: c.textMuted, fontWeight: '700' },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    borderWidth: 1,
    borderColor: c.borderSoft,
    borderRadius: r.sm,
    overflow: 'hidden',
  },
  cell: {
    width: '14.2857%',
    aspectRatio: 1,
    borderWidth: 0.5,
    borderColor: c.borderSoft,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.surfaceMuted,
  },
  cellSelected: { backgroundColor: c.primaryLight, borderColor: c.primaryMuted },
  dayNumber: { fontSize: 12, color: c.text, fontWeight: '600' },
  dayNumberMuted: { color: c.textMuted, opacity: 0.45 },
  dot: { marginTop: 4, width: 6, height: 6, borderRadius: 999 },
  dotLeave: { backgroundColor: c.warningTitle },
  dotShift: { backgroundColor: c.primaryDark },
  dotLegacy: { backgroundColor: c.accentWarm },
  dotMemo: { backgroundColor: c.checkIn },
  calendarCompanyHolidayText: {
    marginTop: 2,
    fontSize: 7,
    fontWeight: '900',
    color: '#DC2626',
    textAlign: 'center',
  },
  calendarEmployeeHolidayText: {
    marginTop: 2,
    fontSize: 7,
    fontWeight: '900',
    color: '#DC2626',
    textAlign: 'center',
  },
  calendarLeaveText: {
    marginTop: 2,
    fontSize: 7,
    fontWeight: '900',
    color: c.leaveSickBar,
    textAlign: 'center',
  },
  calendarMiniLabel: {
    marginTop: 2,
    fontSize: 7,
    fontWeight: '800',
    color: c.primaryDark,
    textAlign: 'center',
  },
  companyHolidayBanner: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
  },
  companyHolidayBannerLabel: {
    color: '#DC2626',
    fontSize: 12,
    fontWeight: '900',
    marginBottom: 4,
  },
  companyHolidayBannerTitle: {
    color: '#991B1B',
    fontSize: 16,
    fontWeight: '900',
  },
  companyHolidayBannerDesc: {
    color: c.textMuted,
    fontSize: 13,
    marginTop: 6,
    lineHeight: 18,
  },
  employeeHolidayBanner: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
  },
  employeeHolidayBannerLabel: {
    color: '#DC2626',
    fontSize: 12,
    fontWeight: '900',
    marginBottom: 4,
  },
  employeeHolidayBannerTitle: {
    color: '#991B1B',
    fontSize: 15,
    fontWeight: '900',
  },
  detailOverlayWrap: {
    flex: 1,
    zIndex: 900000,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  detailBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: c.overlay },
  detailCard: {
    backgroundColor: c.surfaceElevated,
    borderRadius: r.lg,
    borderWidth: 1,
    borderColor: c.borderSoft,
    padding: 12,
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  popupHero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: r.md,
    backgroundColor: c.primaryLight,
    borderWidth: 1,
    borderColor: c.primaryMuted,
    padding: 12,
    marginBottom: 10,
  },
  popupHeroCopy: { flex: 1, minWidth: 0 },
  popupKicker: {
    color: c.primaryDark,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginBottom: 3,
  },
  liveBadge: {
    width: 58,
    height: 58,
    borderRadius: 18,
    backgroundColor: c.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  liveBadgeNum: { color: c.onAccent, fontSize: 20, fontWeight: '900', lineHeight: 22 },
  liveBadgeText: { color: c.onAccent, fontSize: 10, opacity: 0.88, fontWeight: '800' },
  detailTitle: { fontSize: 16, fontWeight: '800', color: c.text, marginBottom: 4 },
  detailSub: { fontSize: 12, color: c.textMuted, marginBottom: 8 },
  liveWorkPanel: {
    borderRadius: r.md,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.borderSoft,
    padding: 12,
    marginBottom: 10,
  },
  liveWorkPanelHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 8,
  },
  liveWorkEyebrow: {
    color: c.primaryDark,
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  liveWorkTitle: { color: c.text, fontSize: 15, fontWeight: '900', marginTop: 2 },
  liveWorkCountPill: {
    borderRadius: 999,
    backgroundColor: c.primaryLight,
    borderWidth: 1,
    borderColor: c.primaryMuted,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  liveWorkCountText: { color: c.primaryDark, fontSize: 11, fontWeight: '800' },
  liveWorkEmpty: {
    color: c.textMuted,
    fontSize: 12,
    backgroundColor: c.surfaceMuted,
    borderRadius: r.sm,
    padding: 10,
  },
  liveWorkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderRadius: r.sm,
    backgroundColor: c.surfaceMuted,
    padding: 9,
    marginTop: 7,
  },
  liveWorkRowPressed: { opacity: 0.78, transform: [{ scale: 0.99 }] },
  liveWorkPriority: { width: 4, height: 30, borderRadius: 2 },
  liveWorkBody: { flex: 1, minWidth: 0 },
  liveWorkTaskTitle: { color: c.text, fontSize: 13, fontWeight: '800' },
  liveWorkTaskMeta: { color: c.textMuted, fontSize: 11, marginTop: 2 },
  liveWorkOpenHint: { color: c.primaryDark, fontSize: 10, fontWeight: '800', marginTop: 4 },
  detailRow: {
    borderWidth: 1,
    borderColor: c.borderSoft,
    borderRadius: r.sm,
    backgroundColor: c.surfaceMuted,
    padding: 10,
    marginBottom: 8,
  },
  detailRowTitle: { fontSize: 14, fontWeight: '700', color: c.text },
  detailRowMeta: { marginTop: 4, fontSize: 12, color: c.textSecondary },
  leaveStatusPanel: {
    borderWidth: 1,
    borderColor: c.leaveSickBar,
    borderRadius: r.md,
    backgroundColor: c.leaveSickBg,
    padding: 12,
    marginBottom: 10,
  },
  leaveStatusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  leaveStatusIcon: {
    width: 36,
    height: 36,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.surfaceElevated,
    borderWidth: 1,
    borderColor: c.leaveSickBar,
  },
  leaveStatusCopy: { flex: 1, minWidth: 0 },
  leaveStatusTitle: {
    color: c.leaveSickBar,
    fontSize: 14,
    fontWeight: '900',
  },
  leaveStatusSub: {
    color: c.textSecondary,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },
  leaveStatusRow: {
    borderTopWidth: 1,
    borderTopColor: c.leaveSickBar,
    paddingTop: 9,
    marginTop: 8,
  },
  leaveStatusType: {
    color: c.leaveSickBar,
    fontSize: 13,
    fontWeight: '900',
  },
  leaveStatusMeta: {
    color: c.textSecondary,
    fontSize: 12,
    marginTop: 3,
  },
  leaveStatusReason: {
    color: c.textSecondary,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 4,
  },
  empty: { color: c.textMuted, fontSize: 12, textAlign: 'center', paddingVertical: 16 },
  closeBtn: {
    marginTop: 8,
    alignItems: 'center',
    borderRadius: r.sm,
    backgroundColor: c.primary,
    paddingVertical: 10,
  },
  closeBtnText: { color: c.onAccent, fontWeight: '700', fontSize: 14 },
  readOnlyHint: { fontSize: 11, color: c.textMuted, marginBottom: 8 },
  dayMemoCard: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: c.borderSoft,
    backgroundColor: c.surface,
    borderRadius: r.md,
    padding: 12,
  },
  dayMemoTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: c.text,
    marginBottom: 8,
  },
  dayMemoInput: {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: r.sm,
    backgroundColor: c.surfaceElevated,
    color: c.text,
    minHeight: 72,
    textAlignVertical: 'top',
    padding: 10,
  },
  dayMemoSectionTitle: {
    marginTop: 10,
    marginBottom: 6,
    fontSize: 12,
    fontWeight: '700',
    color: c.textSecondary,
  },
  dayMemoEmpty: {
    fontSize: 12,
    color: c.textMuted,
    marginBottom: 6,
  },
  dayChecklistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: c.borderSoft,
  },
  dayChecklistCheck: {
    width: 24,
    alignItems: 'center',
  },
  dayChecklistLabel: {
    flex: 1,
    fontSize: 13,
    color: c.text,
  },
  dayChecklistLabelDone: {
    textDecorationLine: 'line-through',
    color: c.textMuted,
  },
  dayChecklistDeleteBtn: {
    width: 26,
    alignItems: 'center',
  },
  dayChecklistAddRow: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dayChecklistAddInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: r.sm,
    backgroundColor: c.surfaceElevated,
    color: c.text,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  dayChecklistAddBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: r.sm,
    backgroundColor: c.primaryLight,
    borderWidth: 1,
    borderColor: c.primaryMuted,
  },
  dayChecklistAddBtnText: {
    color: c.primaryDark,
    fontWeight: '700',
    fontSize: 13,
  },
  saveMemoBtn: {
    marginTop: 8,
    alignItems: 'center',
    borderRadius: r.sm,
    backgroundColor: c.surfaceElevated,
    borderWidth: 1,
    borderColor: c.border,
    paddingVertical: 10,
  },
  saveMemoBtnDisabled: { opacity: 0.55 },
  saveMemoBtnText: { color: c.text, fontWeight: '700', fontSize: 14 },
  });
}
