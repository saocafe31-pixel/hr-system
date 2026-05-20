import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ActivityIndicator,
  InteractionManager,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';

import { DatePickerField } from '@/components/DatePickerField';
import { FriendlyConfirmModal } from '@/components/FriendlyNoticeModal';
import { FriendlyNoticeModal } from '@/components/FriendlyNoticeModal';
import { TaskProgressBar } from '@/components/TaskProgressBar';
import type { FriendlyNoticeVariant } from '@/components/FriendlyNoticeModal';
import { SelfTaskModal } from '@/components/SelfTaskModal';
import { TaskDetailModal } from '@/components/TaskDetailModal';
import { UserAvatar } from '@/components/UserAvatar';
import { isAdmin, isManagerOrAdmin, useAuth, useRole } from '@/contexts/AuthContext';
import { useTaskNotifications } from '@/contexts/TaskNotificationsContext';
import { NatureTheme } from '@/constants/Theme';
import { emitTaskStatusChanged } from '@/lib/appSignals';
import {
  checklistAllDone,
  checklistProgress,
  compareTasksByPriorityThenCreated,
  dateToBangkokYmd,
  dateYmdToIsoBangkokEnd,
  dateYmdToIsoBangkokStart,
  notifyTaskStakeholders,
  canEditTaskStatus,
  priorityColor,
  priorityLabel,
  taskCompletedAtMs,
  taskDoneIsOnTime,
  taskHasDeliverableAttachment,
  taskParticipantUserIds,
  taskPrimaryUserIds,
  taskUserIsPrimaryResponsible,
  TASK_PRIORITY_OPTIONS,
  TASK_STATUS_TH,
  userIncludedInMainTaskList,
} from '@/lib/taskHelpers';
import {
  assignDisplayHeadline,
  assigneeLabelFromPicklist,
  assignMatchesSearch,
  normalizeAssignPickRows,
  type AssignPickRow,
} from '@/lib/taskAssignPicklist';
import { humanizeSupabaseError, supabase } from '@/lib/supabase';
import type { TaskPriority, TaskRow } from '@/lib/types';

const STATUSES = ['pending', 'in_progress', 'done', 'cancelled'] as const;

type TaskCreatedRangePreset = '7d' | '30d' | '90d' | 'month' | 'all' | 'custom';

function bangkokYmdAddDays(ymd: string, deltaDays: number): string {
  const d = new Date(`${ymd}T12:00:00+07:00`);
  d.setDate(d.getDate() + deltaDays);
  return dateToBangkokYmd(d);
}

/** ช่วงวันที่สร้างงาน (created_at) ตามเขต Asia/Bangkok — ใช้กรอง query */
function taskCreatedRangeBounds(
  preset: TaskCreatedRangePreset,
  customFrom: Date | null,
  customTo: Date | null
): { start: string | null; end: string | null } {
  const todayYmd = dateToBangkokYmd(new Date());
  const endIso = dateYmdToIsoBangkokEnd(todayYmd);
  if (preset === 'all') return { start: null, end: null };
  if (preset === 'custom') {
    if (!customFrom || !customTo) return { start: null, end: null };
    const a = dateToBangkokYmd(customFrom);
    const b = dateToBangkokYmd(customTo);
    const fromYmd = a <= b ? a : b;
    const toYmd = a <= b ? b : a;
    const s = dateYmdToIsoBangkokStart(fromYmd);
    const e = dateYmdToIsoBangkokEnd(toYmd);
    return { start: s, end: e };
  }
  if (preset === 'month') {
    const [yStr, mStr] = todayYmd.split('-');
    const firstYmd = `${yStr}-${mStr}-01`;
    return {
      start: dateYmdToIsoBangkokStart(firstYmd),
      end: endIso,
    };
  }
  const span =
    preset === '7d' ? 7 : preset === '30d' ? 30 : 90;
  const startYmd = bangkokYmdAddDays(todayYmd, -(span - 1));
  return {
    start: dateYmdToIsoBangkokStart(startYmd),
    end: endIso,
  };
}

type ChecklistDraftLine = { id: string; text: string };
type PresentationTemplate = {
  id: 'exec' | 'team' | 'problem';
  title: string;
  sections: string[];
};

let mgrChecklistLineSeq = 0;
function newMgrChecklistLineId() {
  mgrChecklistLineSeq += 1;
  return `mgr-cl-${mgrChecklistLineSeq}-${Date.now()}`;
}

function normalizeTask(raw: Record<string, unknown>): TaskRow {
  return {
    ...(raw as unknown as TaskRow),
    priority: (raw.priority as TaskPriority) || 'normal',
    start_at: (raw.start_at as string) ?? null,
  };
}

function shortThaiDate(d: Date): string {
  return d.toLocaleDateString('th-TH', {
    day: '2-digit',
    month: '2-digit',
  });
}

const PRESENTATION_TEMPLATES: PresentationTemplate[] = [
  {
    id: 'exec',
    title: 'ผู้บริหาร (Executive Summary)',
    sections: [
      'ภาพรวมตัวชี้วัดผลการปฏิบัติงาน (KPI)',
      'สถานะความคืบหน้าตามประเภทงานและความเสี่ยง',
      'ประเด็นที่ต้องติดตามและมาตรการเชิงรุก',
      'ทิศทางและแผนการดำเนินงานในช่วงถัดไป',
    ],
  },
  {
    id: 'team',
    title: 'อัปเดตทีม (Team Weekly)',
    sections: [
      'สรุปผลงานที่ปิดครบตามรอบ',
      'งานที่อยู่ระหว่างดำเนินการและผู้รับผิดชอบ',
      'กำหนดเวลา (เดดไลน์) รายวัน / รายสัปดาห์ / รายเดือน',
      'ข้อเสนอการสนับสนุนหรือทรัพยากรที่จำเป็น',
    ],
  },
  {
    id: 'problem',
    title: 'ติดตามปัญหา (Issue Follow-up)',
    sections: [
      'รายการงานที่ล่าช้าหรือเสี่ยงต่อกำหนด',
      'วิเคราะห์สาเหตุเชิงโครงสร้าง',
      'แผนแก้ไขและผู้รับผิดชอบ',
      'กำหนดเวลาใหม่และจุดติดตามถัดไป',
    ],
  },
];

export default function TasksScreen() {
  const { session } = useAuth();
  const router = useRouter();
  const params = useLocalSearchParams<{
    focusAssigneeId?: string | string[];
    focusAssigneeName?: string | string[];
  }>();
  const role = useRole();
  const manager = isManagerOrAdmin(role);
  const admin = isAdmin(role);
  const uid = session?.user?.id;
  const { pendingOpenTaskId, clearPendingOpenTask } = useTaskNotifications();
  const focusedAssigneeId = useMemo(() => {
    const raw = params.focusAssigneeId;
    return Array.isArray(raw) ? raw[0] : raw;
  }, [params.focusAssigneeId]);
  const focusedAssigneeName = useMemo(() => {
    const raw = params.focusAssigneeName;
    return Array.isArray(raw) ? raw[0] : raw;
  }, [params.focusAssigneeName]);
  const assigneeFocusMode = Boolean(manager && focusedAssigneeId);
  const focusedScopeLabel = useMemo(() => {
    if (assigneeFocusMode) return `งานของ ${focusedAssigneeName || 'พนักงาน'}`;
    return 'งานของฉัน';
  }, [assigneeFocusMode, focusedAssigneeName]);

  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [assignOptions, setAssignOptions] = useState<AssignPickRow[]>([]);
  const [assignAvatarByProfileId, setAssignAvatarByProfileId] = useState<
    Record<string, string | null>
  >({});
  const [loading, setLoading] = useState(true);
  const [managerModalOpen, setManagerModalOpen] = useState(false);
  const [selfModalOpen, setSelfModalOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{
    variant: FriendlyNoticeVariant;
    title: string;
    message?: string;
    autoDismissMs?: number;
  } | null>(null);

  const [title, setTitle] = useState('');
  /** ผู้ร่วมงานทั้งหมด (รวมผู้รับผิดชอบหลัก) */
  const [selectedAssigneeIds, setSelectedAssigneeIds] = useState<string[]>([]);
  /** ผู้รับผิดชอบหลัก — เลือกได้หลายคน = รับผิดชอบร่วมกัน */
  const [primaryAssigneeIds, setPrimaryAssigneeIds] = useState<string[]>([]);
  const [desc, setDesc] = useState('');
  const [orderDate, setOrderDate] = useState<Date | null>(null);
  const [dueDate, setDueDate] = useState<Date | null>(null);
  const [checklistLines, setChecklistLines] = useState<ChecklistDraftLine[]>([
    { id: newMgrChecklistLineId(), text: '' },
  ]);
  const [assignPriority, setAssignPriority] = useState<TaskPriority>('normal');
  const [mgrSaving, setMgrSaving] = useState(false);
  const [assigneeSearch, setAssigneeSearch] = useState('');
  const [rangeDays, setRangeDays] = useState<7 | 30 | 90>(7);
  const [presentationOpen, setPresentationOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<PresentationTemplate['id']>(
    'exec'
  );
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'active' | 'pending' | 'in_progress' | 'done' | 'cancelled' | 'overdue'
  >('all');
  /** ยืนยันปิดงานเมื่อเช็คลิสต์ยังไม่ครบ — ติ๊กครบแล้วปิดงาน */
  const [doneChecklistGate, setDoneChecklistGate] = useState<string | null>(null);
  const [deadlineFilter, setDeadlineFilter] = useState<'all' | 'today' | 'week' | 'month'>(
    'all'
  );
  /** กรองงานตามวันที่ได้รับงาน (created_at) — ค่าเริ่ม 30 วันล่าสุด */
  const [taskCreatedRangePreset, setTaskCreatedRangePreset] =
    useState<TaskCreatedRangePreset>('30d');
  const [taskCreatedCustomFrom, setTaskCreatedCustomFrom] = useState<Date | null>(null);
  const [taskCreatedCustomTo, setTaskCreatedCustomTo] = useState<Date | null>(null);
  const [taskSearchQuery, setTaskSearchQuery] = useState('');
  const [deleteTaskId, setDeleteTaskId] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxWaitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingReloadRef = useRef(false);
  const mainScrollRef = useRef<ScrollView>(null);
  const taskListYRef = useRef(0);

  const { width: winW } = useWindowDimensions();
  const ui = useMemo(() => {
    const scale =
      winW < 330 ? 0.76 : winW < 360 ? 0.8 : winW < 400 ? 0.86 : winW < 440 ? 0.92 : 1;
    /** ปุ่มเมนูแถบบน — สเกลแรงกว่า เพื่อลดการตกบรรทัดเมื่อจอแคบ */
    const toolbarScale =
      winW < 320
        ? 0.66
        : winW < 360
          ? 0.72
          : winW < 400
            ? 0.78
            : winW < 440
              ? 0.85
              : winW < 480
                ? 0.92
                : 1;
    return {
      scale,
      fs: (n: number) => Math.max(10, Math.round(n * scale)),
      /** ขนาดตัวอักษรปุ่มแถบบน (เลขฐาน ~13) */
      toolbarFs: (n: number) => Math.max(9, Math.round(n * toolbarScale)),
      kpiMinW: winW < 340 ? 100 : winW < 380 ? 114 : 132,
      kpiRateLabelFs: winW < 400 ? 10 : 11,
      barLabelW: Math.min(88, Math.round(winW * 0.22)),
      toolbarPadV: winW < 360 ? 7 : winW < 400 ? 8 : 11,
      toolbarPadH: winW < 360 ? 4 : winW < 400 ? 6 : 8,
      toolbarGap: winW < 400 ? 5 : 8,
      toolbarPadOuter: winW < 360 ? 6 : 10,
    };
  }, [winW]);

  const filteredAssignOptions = useMemo(() => {
    return assignOptions.filter((row) => assignMatchesSearch(row, assigneeSearch));
  }, [assignOptions, assigneeSearch]);
  const primaryAmongSelected = useMemo(
    () => primaryAssigneeIds.filter((id) => selectedAssigneeIds.includes(id)),
    [primaryAssigneeIds, selectedAssigneeIds]
  );
  const sortedTasks = useMemo(
    () =>
      [...tasks]
        .filter((t) => uid && userIncludedInMainTaskList(t, uid))
        .filter((t) => {
          if (!assigneeFocusMode || !focusedAssigneeId) return true;
          const participantIds = taskParticipantUserIds(t);
          return (
            t.assigned_to === focusedAssigneeId ||
            participantIds.includes(focusedAssigneeId)
          );
        })
        .sort(compareTasksByPriorityThenCreated),
    [tasks, uid, assigneeFocusMode, focusedAssigneeId]
  );
  const dateWindows = useMemo(() => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 1);
    const day = now.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() + mondayOffset);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return { now, todayStart, todayEnd, weekStart, weekEnd, monthStart, monthEnd };
  }, []);
  const filteredTasks = useMemo(() => {
    const matchesStatus = (t: TaskRow) => {
      const dueTs = t.due_at ? new Date(t.due_at).getTime() : null;
      const isOverdue =
        dueTs != null &&
        dueTs < dateWindows.now.getTime() &&
        t.status !== 'done' &&
        t.status !== 'cancelled';
      if (statusFilter !== 'all') {
        if (statusFilter === 'overdue') {
          if (!isOverdue) return false;
        } else if (statusFilter === 'active') {
          if (t.status !== 'pending' && t.status !== 'in_progress') return false;
        } else if (t.status !== statusFilter) {
          return false;
        }
      }
      return true;
    };

    const matchesDeadline = (t: TaskRow) => {
      if (deadlineFilter === 'all') return true;
      if (!t.due_at) return false;
      const due = new Date(t.due_at);
      if (deadlineFilter === 'today') {
        return due >= dateWindows.todayStart && due < dateWindows.todayEnd;
      }
      if (deadlineFilter === 'week') {
        return due >= dateWindows.weekStart && due < dateWindows.weekEnd;
      }
      if (deadlineFilter === 'month') {
        return due >= dateWindows.monthStart && due < dateWindows.monthEnd;
      }
      return true;
    };

    const sq = taskSearchQuery.trim().toLowerCase();
    const matchesSearch = (t: TaskRow) => {
      if (!sq) return true;
      const hay = `${t.title ?? ''} ${t.description ?? ''}`.toLowerCase();
      return hay.includes(sq);
    };

    const isOngoing = (t: TaskRow) =>
      t.status === 'pending' || t.status === 'in_progress';

    const base = sortedTasks.filter(
      (t) => matchesStatus(t) && matchesDeadline(t) && matchesSearch(t)
    );

    const allowOngoingBypassDeadline =
      deadlineFilter !== 'all' &&
      (statusFilter === 'all' ||
        statusFilter === 'active' ||
        statusFilter === 'pending' ||
        statusFilter === 'in_progress');

    if (!allowOngoingBypassDeadline) {
      return base;
    }

    const baseIds = new Set(base.map((t) => t.id));
    const extra = sortedTasks.filter(
      (t) =>
        isOngoing(t) &&
        !baseIds.has(t.id) &&
        matchesStatus(t) &&
        matchesSearch(t) &&
        !matchesDeadline(t)
    );

    if (extra.length === 0) return base;
    return [...base, ...extra].sort(compareTasksByPriorityThenCreated);
  }, [sortedTasks, statusFilter, deadlineFilter, dateWindows, taskSearchQuery]);
  /** สถานะงานทั้งหมดในมุมมอง (ไม่จำกัดช่วงวันที่สร้าง — ใช้เฉพาะการ์ด Task Status) */
  const taskStatusSnapshot = useMemo(() => {
    const total = sortedTasks.length;
    const byStatus = {
      pending: 0,
      in_progress: 0,
      done: 0,
      cancelled: 0,
    } as Record<(typeof STATUSES)[number], number>;
    for (const t of sortedTasks) {
      const k = t.status as (typeof STATUSES)[number];
      if (byStatus[k] != null) byStatus[k] += 1;
    }
    return { total, byStatus };
  }, [sortedTasks]);
  const scopedTasksForSummary = useMemo(() => {
    const now = Date.now();
    const minTs = now - rangeDays * 24 * 60 * 60 * 1000;
    return sortedTasks.filter(
      (t) => new Date(t.created_at).getTime() >= minTs
    );
  }, [sortedTasks, rangeDays]);
  const dashboard = useMemo(() => {
    const total = scopedTasksForSummary.length;
    const byStatus = {
      pending: 0,
      in_progress: 0,
      done: 0,
      cancelled: 0,
    } as Record<(typeof STATUSES)[number], number>;
    const byPriority: Record<TaskPriority, number> = {
      urgent: 0,
      high: 0,
      medium: 0,
      normal: 0,
    };
    let overdue = 0;
    let onTime = 0;
    let overdueQuality = 0;
    const now = Date.now();
    for (const t of scopedTasksForSummary) {
      if (byStatus[t.status as (typeof STATUSES)[number]] != null) {
        byStatus[t.status as (typeof STATUSES)[number]] += 1;
      }
      const pr = (t.priority ?? 'normal') as TaskPriority;
      if (byPriority[pr] != null) byPriority[pr] += 1;
      const dueTs = t.due_at ? new Date(t.due_at).getTime() : null;
      const isDone = t.status === 'done';
      if (dueTs && t.status !== 'done' && t.status !== 'cancelled' && dueTs < now) {
        overdue += 1;
      }
      if (isDone) {
        if (taskDoneIsOnTime(t)) onTime += 1;
        else overdueQuality += 1;
      } else if (dueTs && dueTs < now) {
        overdueQuality += 1;
      }
    }
    const completionRate =
      total > 0 ? Math.round((byStatus.done / Math.max(total, 1)) * 100) : 0;
    const openCount = byStatus.pending + byStatus.in_progress;

    let doneOnTime = 0;
    let doneLate = 0;
    for (const t of scopedTasksForSummary) {
      if (t.status !== 'done') continue;
      if (taskDoneIsOnTime(t)) doneOnTime += 1;
      else doneLate += 1;
    }
    const doneTotal = byStatus.done;
    const onTimeOfDonePct =
      doneTotal > 0 ? Math.round((doneOnTime / doneTotal) * 100) : 0;
    const lateDonePct = doneTotal > 0 ? Math.round((doneLate / doneTotal) * 100) : 0;
    const cancelledPct =
      total > 0 ? Math.round((byStatus.cancelled / total) * 100) : 0;

    /**
     * อัตราความสำเร็จแบบฐาน 100% — ตัวหาร = เฉพาะงานที่ยังมีผล (ไม่รวมยกเลิก)
     * หักตาม (ปิดหลังกำหนด + ค้างเกินกำหนด) / จำนวนงานที่ยังมีผล
     */
    const totalForSuccessRate = Math.max(
      0,
      byStatus.pending + byStatus.in_progress + byStatus.done
    );
    const badForSuccess = doneLate + overdue;
    const successRateBase100 =
      totalForSuccessRate === 0
        ? 100
        : Math.max(
            0,
            Math.min(
              100,
              Math.round(100 - (badForSuccess / totalForSuccessRate) * 100)
            )
          );
    const deductLatePctOfTotal =
      totalForSuccessRate > 0
        ? Math.round((doneLate / totalForSuccessRate) * 100)
        : 0;
    const deductOpenOverduePctOfTotal =
      totalForSuccessRate > 0
        ? Math.round((overdue / totalForSuccessRate) * 100)
        : 0;

    const last7 = Array.from({ length: 7 }).map((_, idx) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - idx));
      const key = d.toDateString();
      return { key, label: shortThaiDate(d), created: 0, done: 0 };
    });
    const trendMap: Record<string, { created: number; done: number }> = {};
    for (const b of last7) trendMap[b.key] = { created: 0, done: 0 };
    for (const t of scopedTasksForSummary) {
      const createdKey = new Date(t.created_at).toDateString();
      if (trendMap[createdKey]) trendMap[createdKey].created += 1;
      if (t.status === 'done') {
        const ms = taskCompletedAtMs(t);
        if (ms != null) {
          const doneKey = new Date(ms).toDateString();
          if (trendMap[doneKey]) trendMap[doneKey].done += 1;
        }
      }
    }
    const trend = last7.map((b) => ({
      ...b,
      created: trendMap[b.key]?.created ?? 0,
      done: trendMap[b.key]?.done ?? 0,
    }));
    const maxTrend = Math.max(
      1,
      ...trend.map((d) => Math.max(d.created, d.done))
    );
    return {
      total,
      overdue,
      onTime,
      overdueQuality,
      openCount,
      completionRate,
      byStatus,
      byPriority,
      trend,
      maxStatus: Math.max(1, ...Object.values(byStatus)),
      maxPriority: Math.max(1, ...Object.values(byPriority)),
      maxTrend,
      onTimeRate:
        onTime + overdueQuality > 0
          ? Math.round((onTime / (onTime + overdueQuality)) * 100)
          : 0,
      doneOnTime,
      doneLate,
      onTimeOfDonePct,
      lateDonePct,
      cancelledPct,
      /** จำนวนงานปิดแล้วในช่วง — ใช้เป็นตัวหารอัตราทัน/ล่าช้า */
      doneTotalForRates: doneTotal,
      badForSuccess,
      successRateBase100,
      deductLatePctOfTotal,
      deductOpenOverduePctOfTotal,
      /** งานที่ยังมีผล (ไม่รวมยกเลิก) — ใช้เป็นฐาน 100% สำหรับอัตราความสำเร็จ */
      totalForSuccessRate,
    };
  }, [scopedTasksForSummary]);
  const deadlineSummary = useMemo(() => {
    const summary = {
      today: { total: 0, done: 0 },
      week: { total: 0, done: 0 },
      month: { total: 0, done: 0 },
    };
    for (const t of sortedTasks) {
      if (!t.due_at) continue;
      const due = new Date(t.due_at);
      const done = t.status === 'done';
      const inToday = due >= dateWindows.todayStart && due < dateWindows.todayEnd;
      const inWeek = due >= dateWindows.weekStart && due < dateWindows.weekEnd;
      const inMonth = due >= dateWindows.monthStart && due < dateWindows.monthEnd;
      if (inToday) {
        summary.today.total += 1;
        if (done) summary.today.done += 1;
      }
      if (inWeek) {
        summary.week.total += 1;
        if (done) summary.week.done += 1;
      }
      if (inMonth) {
        summary.month.total += 1;
        if (done) summary.month.done += 1;
      }
    }
    const pct = (done: number, total: number) =>
      total > 0 ? Math.round((done / total) * 100) : 0;
    return {
      today: { ...summary.today, pct: pct(summary.today.done, summary.today.total) },
      week: { ...summary.week, pct: pct(summary.week.done, summary.week.total) },
      month: { ...summary.month, pct: pct(summary.month.done, summary.month.total) },
      performancePct:
        Math.round(dashboard.completionRate * 0.6 + dashboard.onTimeRate * 0.4),
    };
  }, [sortedTasks, dashboard.completionRate, dashboard.onTimeRate, dateWindows]);
  const priorityDonut = useMemo(() => {
    const active = scopedTasksForSummary.filter(
      (t) => t.status !== 'done' && t.status !== 'cancelled'
    );
    const byPriority: Record<TaskPriority, number> = {
      urgent: 0,
      high: 0,
      medium: 0,
      normal: 0,
    };
    for (const t of active) byPriority[(t.priority ?? 'normal') as TaskPriority] += 1;
    const total = Object.values(byPriority).reduce((a, b) => a + b, 0);
    return { byPriority, total };
  }, [scopedTasksForSummary]);
  const presentationDraft = useMemo(() => {
    const tpl =
      PRESENTATION_TEMPLATES.find((t) => t.id === selectedTemplate) ??
      PRESENTATION_TEMPLATES[0];
    const heading = `รายงานสรุปผลการปฏิบัติงาน (${focusedScopeLabel}) — ช่วงวิเคราะห์ ${rangeDays} วันที่ผ่านมา`;

    const checklistNarrative = (() => {
      const blocks: string[] = [];
      let n = 0;
      for (const task of scopedTasksForSummary) {
        const raw = task.task_checklist_items ?? [];
        const items = [...raw]
          .sort((a, b) => a.sort_order - b.sort_order)
          .filter((i) => i.label?.trim());
        if (items.length === 0) continue;
        n += 1;
        if (n > 10) break;
        const lines = items.slice(0, 14).map(
          (i) =>
            `    ${i.done ? '☑' : '☐'} ${i.label.trim()}`
        );
        blocks.push(`〔หัวข้อที่ ${n}〕 ${task.title}\n${lines.join('\n')}`);
      }
      if (blocks.length === 0) {
        return [
          'ส่วนที่ 2 — รายการตรวจสอบ (เช็คลิสต์)',
          'ไม่พบรายการเช็คลิสต์ในชุดงานช่วงที่เลือก',
        ].join('\n');
      }
      return [
        'ส่วนที่ 2 — รายการตรวจสอบประกอบการรายงาน (ดึงจากเช็คลิสต์จริงในระบบ)',
        ...blocks,
      ].join('\n\n');
    })();

    const lines = [
      heading,
      '',
      'ส่วนที่ 1 — ตัวเลขสรุปเชิงปริมาณ',
      `- จำนวนงานในช่วง: ${dashboard.total} งาน | งานที่ยังมีผล (ไม่รวมยกเลิก): ${dashboard.totalForSuccessRate} งาน | งานที่ยังดำเนินการ: ${dashboard.openCount} งาน | อัตราปิดงานตามจำนวน: ${dashboard.completionRate}%`,
      `- อัตราความสำเร็จ (ฐาน 100% จากงานที่ยังมีผลเท่านั้น): ${dashboard.successRateBase100}% — หักรวม ${dashboard.badForSuccess} งาน (ปิดหลังกำหนด ${dashboard.doneLate} + ค้างเกินกำหนด ${dashboard.overdue}) โดยปิดหลังกำหนดนับจากวันที่ทำงานเสร็จเทียบกำหนดส่ง`,
      `- สัดส่วนที่หักจากฐาน: ปิดล่าช้า −${dashboard.deductLatePctOfTotal}% | ค้างเกินกำหนด −${dashboard.deductOpenOverduePctOfTotal}% | อัตรายกเลิกจากทั้งหมดในช่วง: ${dashboard.cancelledPct}%`,
      `- ดัชนี On-time / Overdue (ภาพรวม): เสร็จทัน ${dashboard.onTime} | เกินกำหนด ${dashboard.overdueQuality} | อัตราตรงเวลา ${dashboard.onTimeRate}%`,
      `- Deadline วันนี้ ${deadlineSummary.today.done}/${deadlineSummary.today.total} (${deadlineSummary.today.pct}%)`,
      `- Deadline สัปดาห์นี้ ${deadlineSummary.week.done}/${deadlineSummary.week.total} (${deadlineSummary.week.pct}%)`,
      `- Deadline เดือนนี้ ${deadlineSummary.month.done}/${deadlineSummary.month.total} (${deadlineSummary.month.pct}%)`,
      '',
      checklistNarrative,
      '',
      `ส่วนที่ 3 — โครงรายงานแนะนำ: ${tpl.title}`,
      ...tpl.sections.map((s, i) => `${i + 1}. ${s}`),
    ];
    return lines.join('\n');
  }, [selectedTemplate, rangeDays, dashboard, deadlineSummary, scopedTasksForSummary, focusedScopeLabel]);

  const load = useCallback(async () => {
    const bounds = taskCreatedRangeBounds(
      taskCreatedRangePreset,
      taskCreatedCustomFrom,
      taskCreatedCustomTo
    );
    let q = supabase
      .from('tasks')
      .select(
        `
        *,
        task_assignees (*),
        task_checklist_items (*),
        task_attachments (*)
      `
      )
      .order('created_at', { ascending: false });
    if (bounds.start) q = q.gte('created_at', bounds.start);
    if (bounds.end) q = q.lte('created_at', bounds.end);
    const { data, error } = await q;
    if (error) {
      setNotice({
        variant: 'error',
        title: 'โหลดงานไม่สำเร็จ',
        message: error.message,
      });
      return;
    }
    const rows = ((data as Record<string, unknown>[]) ?? []).map(normalizeTask);
    setTasks(rows);

    if (!manager) {
      setAssignOptions([]);
      setAssignAvatarByProfileId({});
      return;
    }

    let subordinateFilter: Set<string> | null = null;
    if (!admin && session?.user?.id) {
      const { data: reps } = await supabase
        .from('manager_direct_reports')
        .select('subordinate_id')
        .eq('manager_id', session.user.id);
      const ids =
        (reps as { subordinate_id?: string }[] | null)
          ?.map((r) => r.subordinate_id)
          .filter((x): x is string => !!x) ?? [];
      subordinateFilter = new Set(ids);
    }

    const { data: rpcData, error: rpcErr } = await supabase.rpc('task_assign_picklist');
    let nextAssign: AssignPickRow[] = [];

    if (!rpcErr && rpcData != null) {
      nextAssign = normalizeAssignPickRows(rpcData);
      if (subordinateFilter) {
        nextAssign = nextAssign.filter((r) => subordinateFilter.has(r.profile_id));
      }
    } else if (subordinateFilter) {
      const ids = [...subordinateFilter];
      if (ids.length === 0) {
        nextAssign = [];
      } else {
        const { data: pe } = await supabase
          .from('profiles')
          .select('id, email, full_name, role, branch_id, employee_code, phone, employee_id')
          .in('id', ids);
        const plist = (pe as {
          id: string;
          email: string | null;
          full_name: string | null;
          employee_id?: string | null;
        }[]) ?? [];
        nextAssign = plist.map((p) => ({
          profile_id: p.id,
          account_email: p.email,
          hr_user_id: null,
          full_name: p.full_name,
          employee_id: p.employee_id ?? null,
          hr_name: null,
          hr_surname: null,
          hr_nickname: null,
        }));
      }
    } else {
      const { data: pe } = await supabase
        .from('profiles')
        .select('id, email, full_name, role, branch_id, employee_code, phone, employee_id')
        .eq('role', 'employee');
      const plist = (pe as {
        id: string;
        email: string | null;
        full_name: string | null;
        employee_id?: string | null;
      }[]) ?? [];
      nextAssign = plist.map((p) => ({
        profile_id: p.id,
        account_email: p.email,
        hr_user_id: null,
        full_name: p.full_name,
        employee_id: p.employee_id ?? null,
        hr_name: null,
        hr_surname: null,
        hr_nickname: null,
      }));
    }

    const profileIds = [...new Set(nextAssign.map((r) => r.profile_id))];
    const avMap: Record<string, string | null> = {};
    if (profileIds.length > 0) {
      const { data: avRows } = await supabase
        .from('profiles')
        .select('id, avatar_url')
        .in('id', profileIds);
      for (const row of (avRows as { id: string; avatar_url: string | null }[]) ?? []) {
        avMap[row.id] = row.avatar_url ?? null;
      }
    }

    setAssignOptions(nextAssign);
    setAssignAvatarByProfileId(avMap);
  }, [
    manager,
    admin,
    session?.user?.id,
    taskCreatedRangePreset,
    taskCreatedCustomFrom,
    taskCreatedCustomTo,
  ]);

  const flushReload = useCallback(() => {
    if (reloadTimerRef.current) {
      clearTimeout(reloadTimerRef.current);
      reloadTimerRef.current = null;
    }
    if (maxWaitTimerRef.current) {
      clearTimeout(maxWaitTimerRef.current);
      maxWaitTimerRef.current = null;
    }
    if (!pendingReloadRef.current) return;
    pendingReloadRef.current = false;
    void load();
  }, [load]);

  const scheduleReload = useCallback(() => {
    pendingReloadRef.current = true;
    if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
    reloadTimerRef.current = setTimeout(() => {
      reloadTimerRef.current = null;
      flushReload();
    }, 400);
    if (!maxWaitTimerRef.current) {
      maxWaitTimerRef.current = setTimeout(() => {
        maxWaitTimerRef.current = null;
        flushReload();
      }, 2000);
    }
  }, [flushReload]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      await load();
      if (alive) setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [load]);

  useEffect(() => {
    const id = setInterval(() => {
      scheduleReload();
    }, 60_000);
    return () => clearInterval(id);
  }, [scheduleReload]);

  useEffect(() => {
    return () => {
      if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
      if (maxWaitTimerRef.current) clearTimeout(maxWaitTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel(`tasks_live_${uid ?? 'guest'}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tasks' },
        scheduleReload
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'task_checklist_items' },
        scheduleReload
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'task_assignees' },
        scheduleReload
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [scheduleReload, uid]);

  useEffect(() => {
    if (!pendingOpenTaskId) return;
    setDetailId(pendingOpenTaskId);
    clearPendingOpenTask();
  }, [pendingOpenTaskId, clearPendingOpenTask]);

  const scrollToTaskList = useCallback(() => {
    InteractionManager.runAfterInteractions(() => {
      requestAnimationFrame(() => {
        const y = taskListYRef.current;
        mainScrollRef.current?.scrollTo({
          y: Math.max(0, y - 8),
          animated: true,
        });
      });
    });
  }, []);

  const applyTaskStatusUpdate = useCallback(
    async (id: string, status: string) => {
      const patch: Record<string, unknown> = { status };
      if (status === 'done') {
        const ymd = dateToBangkokYmd(new Date());
        patch.completed_at =
          dateYmdToIsoBangkokEnd(ymd) ?? new Date().toISOString();
      } else {
        patch.completed_at = null;
      }
      const { error } = await supabase.from('tasks').update(patch).eq('id', id);
      if (error) {
        setNotice({
          variant: 'error',
          title: 'อัปเดตสถานะไม่สำเร็จ',
          message: error.message,
        });
        return;
      }
      emitTaskStatusChanged({
        taskId: id,
        status,
        source: 'tasks',
      });
      const { data: meta } = await supabase
        .from('tasks')
        .select('assigned_to, assigned_by, title, task_assignees (user_id)')
        .eq('id', id)
        .maybeSingle();
      if (meta) {
        const m = meta as {
          assigned_to: string;
          assigned_by: string | null;
          title: string;
          task_assignees?: { user_id: string }[] | null;
        };
        const notifyAssigneeIds =
          m.task_assignees && m.task_assignees.length > 0
            ? m.task_assignees.map((r) => r.user_id)
            : [m.assigned_to];
        try {
          await notifyTaskStakeholders(supabase, {
            taskId: id,
            assignedTo: m.assigned_to,
            assignedBy: m.assigned_by,
            title: m.title,
            message: `เปลี่ยนสถานะเป็น ${TASK_STATUS_TH[status] ?? status}`,
            notifyAssigneeIds,
          });
        } catch {
          /* ignore */
        }
      }
      await load();
      setNotice({
        variant: 'status',
        title: 'อัปเดตสถานะแล้ว',
        message: `งานนี้อยู่ในขั้น «${TASK_STATUS_TH[status] ?? status}» แล้ว`,
        autoDismissMs: 2200,
      });
    },
    [load]
  );

  async function confirmDoneTickChecklistAndClose() {
    const id = doneChecklistGate;
    if (!id) return;
    const row = tasks.find((t) => t.id === id);
    if (!row) {
      setDoneChecklistGate(null);
      return;
    }
    setDoneChecklistGate(null);
    const ids = (row.task_checklist_items ?? []).filter((i) => !i.done).map((i) => i.id);
    if (ids.length) {
      const { error } = await supabase
        .from('task_checklist_items')
        .update({ done: true })
        .in('id', ids);
      if (error) {
        setNotice({
          variant: 'error',
          title: 'อัปเดตเช็คลิสต์ไม่สำเร็จ',
          message: error.message,
        });
        return;
      }
    }
    await applyTaskStatusUpdate(id, 'done');
  }

  async function updateStatus(id: string, status: string) {
    const row = tasks.find((t) => t.id === id);
    if (!row) return;
    if (row.status === 'done' && status !== 'done') {
      setNotice({
        variant: 'error',
        title: 'งานปิดสำเร็จแล้ว',
        message: 'ไม่สามารถเปลี่ยนสถานะกลับไปดำเนินการได้',
      });
      return;
    }
    if (status === 'done') {
      if (!taskHasDeliverableAttachment(row)) {
        setNotice({
          variant: 'error',
          title: 'ยังแนบหลักฐานไม่ครบ',
          message: 'กรุณาแนบรูป ไฟล์ หรือลิงก์อย่างน้อย 1 รายการก่อนปิดงาน',
        });
        return;
      }
      if (!checklistAllDone(row)) {
        setDoneChecklistGate(id);
        return;
      }
    }
    await applyTaskStatusUpdate(id, status);
  }

  function resetManagerTaskForm() {
    setTitle('');
    setDesc('');
    setSelectedAssigneeIds([]);
    setPrimaryAssigneeIds([]);
    setOrderDate(null);
    setDueDate(null);
    setAssignPriority('normal');
    setAssigneeSearch('');
    setChecklistLines([{ id: newMgrChecklistLineId(), text: '' }]);
  }

  function closeManagerModal() {
    if (mgrSaving) return;
    setManagerModalOpen(false);
    resetManagerTaskForm();
  }

  function openManagerModalWithContext() {
    if (assigneeFocusMode && focusedAssigneeId) {
      setSelectedAssigneeIds([focusedAssigneeId]);
      setPrimaryAssigneeIds([focusedAssigneeId]);
    }
    setManagerModalOpen(true);
  }

  function updateChecklistLine(id: string, text: string) {
    setChecklistLines((prev) =>
      prev.map((l) => (l.id === id ? { ...l, text } : l))
    );
  }

  function removeChecklistLine(id: string) {
    setChecklistLines((prev) => {
      const next = prev.filter((l) => l.id !== id);
      return next.length ? next : [{ id: newMgrChecklistLineId(), text: '' }];
    });
  }

  function toggleAssigneePick(profileId: string) {
    setSelectedAssigneeIds((prev) => {
      if (prev.includes(profileId)) {
        setPrimaryAssigneeIds((p) => p.filter((x) => x !== profileId));
        return prev.filter((x) => x !== profileId);
      }
      setPrimaryAssigneeIds((p) => [...p, profileId]);
      return [...prev, profileId];
    });
  }

  function togglePrimaryPick(profileId: string) {
    if (!selectedAssigneeIds.includes(profileId)) return;
    setPrimaryAssigneeIds((prev) =>
      prev.includes(profileId)
        ? prev.filter((x) => x !== profileId)
        : [...prev, profileId]
    );
  }

  async function createManagerTask() {
    if (!session?.user?.id || !title.trim()) {
      setNotice({
        variant: 'info',
        title: 'ข้อมูลยังไม่ครบ',
        message: 'กรุณากรอกหัวข้อและเลือกผู้รับงาน',
      });
      return;
    }
    if (selectedAssigneeIds.length === 0) {
      setNotice({
        variant: 'info',
        title: 'ยังไม่เลือกผู้รับงาน',
        message: 'เลือกพนักงานอย่างน้อย 1 คน',
      });
      return;
    }
    const primaryAmong = primaryAssigneeIds.filter((id) =>
      selectedAssigneeIds.includes(id)
    );
    if (primaryAmong.length === 0) {
      setNotice({
        variant: 'info',
        title: 'ยังไม่ระบุผู้รับผิดชอบหลัก',
        message: 'เลือกอย่างน้อย 1 คนเป็น «ผู้รับผิดชอบหลัก» (เลือกหลายคนได้ = รับผิดชอบร่วมกัน)',
      });
      return;
    }
    const startIso = orderDate
      ? dateYmdToIsoBangkokStart(dateToBangkokYmd(orderDate))
      : null;
    const dueIso = dueDate
      ? dateYmdToIsoBangkokEnd(dateToBangkokYmd(dueDate))
      : null;
    if (orderDate && !startIso) {
      setNotice({
        variant: 'info',
        title: 'วันที่ไม่ถูกต้อง',
        message: 'กรุณาเลือกวันที่เริ่มใหม่',
      });
      return;
    }
    if (dueDate && !dueIso) {
      setNotice({
        variant: 'info',
        title: 'วันที่ไม่ถูกต้อง',
        message: 'กรุณาเลือกกำหนดวันที่ใหม่',
      });
      return;
    }

    setMgrSaving(true);
    try {
      const firstPrimary =
        selectedAssigneeIds.find((id) => primaryAmong.includes(id)) ??
        selectedAssigneeIds[0];
      const labels = checklistLines.map((s) => s.text.trim()).filter(Boolean);

      const { data: taskId, error } = await supabase.rpc('create_manager_task_bundle', {
        p_title: title.trim(),
        p_description: desc.trim() || null,
        p_priority: assignPriority,
        p_start_at: startIso,
        p_due_at: dueIso,
        p_assignee_ids: selectedAssigneeIds,
        p_primary_ids: primaryAmong,
        p_checklist_labels: labels.length > 0 ? labels : [],
      });

      if (error || taskId == null) {
        setNotice({
          variant: 'error',
          title: 'สร้างงานไม่สำเร็จ',
          message: humanizeSupabaseError(error?.message ?? 'ไม่ได้รับรหัสงานจากเซิร์ฟเวอร์'),
        });
        return;
      }

      const t = {
        id: String(taskId),
        title: title.trim(),
        assigned_to: firstPrimary,
        assigned_by: session.user.id,
      };

      try {
        await notifyTaskStakeholders(supabase, {
          taskId: t.id,
          assignedTo: t.assigned_to,
          assignedBy: t.assigned_by,
          title: t.title,
          message: 'มีงานใหม่จากหัวหน้า/ผู้มอบหมาย',
          notifyAssigneeIds: selectedAssigneeIds,
        });
      } catch {
        /* ignore */
      }

      setManagerModalOpen(false);
      resetManagerTaskForm();
      await load();
      setNotice({
        variant: 'success',
        title: 'มอบหมายงานแล้ว',
        message: 'ผู้รับงานและทีมจะได้รับแจ้งเตือน',
        autoDismissMs: 2400,
      });
    } finally {
      setMgrSaving(false);
    }
  }

  async function confirmDeleteTask() {
    if (deleteBusy) return;
    const id = deleteTaskId;
    if (!id || !admin) {
      setDeleteTaskId(null);
      return;
    }
    setDeleteBusy(true);
    const { error } = await supabase.from('tasks').delete().eq('id', id);
    setDeleteBusy(false);
    setDeleteTaskId(null);
    if (error) {
      setNotice({
        variant: 'error',
        title: 'ลบงานไม่สำเร็จ',
        message: humanizeSupabaseError(error.message),
      });
      return;
    }
    if (detailId === id) setDetailId(null);
    setNotice({
      variant: 'success',
      title: 'ลบงานแล้ว',
      autoDismissMs: 2000,
    });
    await load();
  }

  async function copyPresentationSummary() {
    try {
      await Clipboard.setStringAsync(presentationDraft);
      setNotice({
        variant: 'success',
        title: 'คัดลอกสรุปแล้ว',
        message: 'นำไปวางในสไลด์หรือรายงานได้เลย',
        autoDismissMs: 1800,
      });
    } catch (e) {
      setNotice({
        variant: 'error',
        title: 'คัดลอกไม่สำเร็จ',
        message: e instanceof Error ? e.message : 'ลองใหม่อีกครั้ง',
      });
    }
  }

  if (loading || !uid) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={NatureTheme.colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <SelfTaskModal
        visible={selfModalOpen}
        onClose={() => setSelfModalOpen(false)}
        onSaved={load}
      />
      <TaskDetailModal
        visible={detailId != null}
        taskId={detailId}
        userId={uid}
        onClose={() => setDetailId(null)}
        onChanged={load}
        manager={manager}
        admin={admin}
      />

      <ScrollView
        ref={mainScrollRef}
        style={styles.mainScroll}
        contentContainerStyle={styles.mainContent}
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled>
      <View
        style={[
          styles.toolbar,
          {
            gap: ui.toolbarGap,
            paddingHorizontal: ui.toolbarPadOuter,
          },
        ]}>
        <Pressable
          style={[
            styles.selfBtn,
            { paddingVertical: ui.toolbarPadV, paddingHorizontal: ui.toolbarPadH },
          ]}
          onPress={() => setSelfModalOpen(true)}>
          <Text
            style={[
              styles.selfBtnText,
              {
                fontSize: ui.toolbarFs(13),
                width: '100%',
                textAlign: 'center',
              },
            ]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.62}>
            {assigneeFocusMode
              ? `+ เพิ่มงานให้ ${focusedAssigneeName || 'พนักงาน'}`
              : '+ เพิ่มงานของฉัน'}
          </Text>
        </Pressable>
        {manager && (
          <Pressable
            style={[
              styles.mgrBtn,
              { paddingVertical: ui.toolbarPadV, paddingHorizontal: ui.toolbarPadH },
            ]}
            onPress={openManagerModalWithContext}>
            <Text
              style={[
                styles.mgrBtnText,
                {
                  fontSize: ui.toolbarFs(13),
                  width: '100%',
                  textAlign: 'center',
                },
              ]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.62}>
              มอบหมายงาน
            </Text>
          </Pressable>
        )}
        <Pressable
          style={[
            styles.deckBtn,
            { paddingVertical: ui.toolbarPadV, paddingHorizontal: ui.toolbarPadH },
          ]}
          onPress={() => setPresentationOpen(true)}>
          <Text
            style={[
              styles.deckBtnText,
              {
                fontSize: ui.toolbarFs(13),
                width: '100%',
                textAlign: 'center',
              },
            ]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.62}>
            เตรียมนำเสนอ
          </Text>
        </Pressable>
        <Pressable
          style={[
            styles.assignTrackBtn,
            { paddingVertical: ui.toolbarPadV - 1, paddingHorizontal: ui.toolbarPadH },
          ]}
          onPress={() => router.push('/tasks-assigned')}>
          <Text
            style={[
              styles.assignTrackBtnText,
              {
                fontSize: ui.toolbarFs(12),
                width: '100%',
                textAlign: 'center',
              },
            ]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.62}>
            สถานะมอบหมาย
          </Text>
        </Pressable>
      </View>
      {(manager || admin) && (
        <View style={styles.filterRow}>
          <Pressable
            style={[styles.filterChip, styles.filterChipOn]}>
            <Text
              style={[
                styles.filterChipText,
                styles.filterChipTextOn,
                { fontSize: ui.fs(12) },
              ]}>
              {focusedScopeLabel}
            </Text>
          </Pressable>
          {assigneeFocusMode ? (
            <Pressable
              style={styles.filterChip}
              onPress={() => router.replace('/tasks')}>
              <Text style={[styles.filterChipText, { fontSize: ui.fs(12) }]}>
                ล้างตัวกรอง
              </Text>
            </Pressable>
          ) : null}
        </View>
      )}
      <View style={styles.filterRow}>
        {[7, 30, 90].map((d) => (
          <Pressable
            key={`range-${d}`}
            style={[styles.filterChip, rangeDays === d && styles.filterChipOn]}
            onPress={() => setRangeDays(d as 7 | 30 | 90)}>
            <Text
              style={[
                styles.filterChipText,
                rangeDays === d && styles.filterChipTextOn,
                { fontSize: ui.fs(12) },
              ]}>
              {d} วัน
            </Text>
          </Pressable>
        ))}
      </View>

      <Text
        style={[
          styles.kpiSectionLabel,
          { fontSize: ui.fs(12), marginHorizontal: s.screen, marginTop: 6, marginBottom: 6 },
        ]}>
        ค้นหางาน · ช่วงวันที่ได้รับงาน (วันที่สร้างในระบบ)
      </Text>
      <View style={{ paddingHorizontal: s.screen, marginBottom: 8 }}>
        <TextInput
          style={styles.taskSearchInput}
          placeholder="ค้นหาจากหัวข้อหรือรายละเอียด..."
          placeholderTextColor={c.textMuted}
          value={taskSearchQuery}
          onChangeText={setTaskSearchQuery}
        />
      </View>
      <ScrollView
        horizontal
        nestedScrollEnabled
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.filterRow, { paddingBottom: 8 }]}>
        {(
          [
            { key: '7d' as const, label: '7 วัน' },
            { key: '30d' as const, label: '30 วัน' },
            { key: '90d' as const, label: '90 วัน' },
            { key: 'month' as const, label: 'เดือนนี้' },
            { key: 'custom' as const, label: 'กำหนดเอง' },
            { key: 'all' as const, label: 'ทั้งหมด' },
          ] as const
        ).map(({ key, label }) => (
          <Pressable
            key={key}
            style={[
              styles.filterChip,
              taskCreatedRangePreset === key && styles.filterChipOn,
            ]}
            onPress={() => {
              if (key === 'custom') {
                const to = new Date();
                const from = new Date();
                from.setDate(from.getDate() - 7);
                setTaskCreatedCustomFrom((prev) => prev ?? from);
                setTaskCreatedCustomTo((prev) => prev ?? to);
              }
              setTaskCreatedRangePreset(key);
            }}>
            <Text
              style={[
                styles.filterChipText,
                taskCreatedRangePreset === key && styles.filterChipTextOn,
                { fontSize: ui.fs(12) },
              ]}>
              {label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
      {taskCreatedRangePreset === 'custom' ? (
        <View style={{ paddingHorizontal: s.screen, gap: 8, marginBottom: 10 }}>
          <DatePickerField
            label="ได้รับงานตั้งแต่"
            value={taskCreatedCustomFrom}
            onChange={setTaskCreatedCustomFrom}
            maximumDate={taskCreatedCustomTo ?? undefined}
          />
          <DatePickerField
            label="ถึงวันที่"
            value={taskCreatedCustomTo}
            onChange={setTaskCreatedCustomTo}
            minimumDate={taskCreatedCustomFrom ?? undefined}
          />
        </View>
      ) : null}

      <ScrollView
        horizontal
        nestedScrollEnabled
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.kpiRow}>
        <Pressable
          style={[styles.kpiCard, { minWidth: ui.kpiMinW }]}
          onPress={() => {
            setDeadlineFilter('all');
            setStatusFilter('all');
            scrollToTaskList();
          }}>
          <Text style={[styles.kpiLabel, { fontSize: ui.fs(12) }]}>งานทั้งหมด</Text>
          <Text style={[styles.kpiValue, { fontSize: ui.fs(22) }]}>{dashboard.total}</Text>
        </Pressable>
        <Pressable
          style={[styles.kpiCard, { minWidth: ui.kpiMinW }]}
          onPress={() => {
            setDeadlineFilter('all');
            setStatusFilter('active');
            scrollToTaskList();
          }}>
          <Text style={[styles.kpiLabel, { fontSize: ui.fs(12) }]} numberOfLines={1}>
            กำลังดำเนินการ
          </Text>
          <Text style={[styles.kpiValue, { fontSize: ui.fs(22) }]}>{dashboard.openCount}</Text>
        </Pressable>
        <Pressable
          style={[styles.kpiCard, { minWidth: ui.kpiMinW }]}
          onPress={() => {
            setDeadlineFilter('all');
            setStatusFilter('overdue');
            scrollToTaskList();
          }}>
          <Text style={[styles.kpiLabel, { fontSize: ui.fs(12) }]}>เลยกำหนด</Text>
          <Text style={[styles.kpiValue, styles.kpiWarn, { fontSize: ui.fs(22) }]}>
            {dashboard.overdue}
          </Text>
        </Pressable>
        <Pressable
          style={[styles.kpiCard, { minWidth: ui.kpiMinW }]}
          onPress={() => {
            setDeadlineFilter('all');
            setStatusFilter('done');
            scrollToTaskList();
          }}>
          <Text style={[styles.kpiLabel, { fontSize: ui.fs(12) }]}>เสร็จแล้ว</Text>
          <Text style={[styles.kpiValue, { fontSize: ui.fs(22) }]}>
            {dashboard.byStatus.done}
          </Text>
          <Text style={[styles.kpiHint, { fontSize: ui.fs(10), marginTop: 2 }]}>
            ({dashboard.completionRate}% ของช่วง)
          </Text>
        </Pressable>
      </ScrollView>
      <Text style={[styles.kpiSectionLabel, { fontSize: ui.fs(11) }]}>
        อัตราความสำเร็จ: ฐาน 100% = งานที่ยังมีผล (ไม่รวมยกเลิก) — หักค้างเกินกำหนด + ปิดงานล่าช้า (มี due และวันที่ทำงานเสร็จหลังกำหนดเท่านั้น)
      </Text>
      <ScrollView
        horizontal
        nestedScrollEnabled
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.kpiRow}>
        <Pressable
          style={[styles.kpiCard, styles.kpiCardRate, { minWidth: ui.kpiMinW }]}
          onPress={() => {
            setDeadlineFilter('all');
            setStatusFilter('all');
            scrollToTaskList();
          }}>
          <Text
            style={[styles.kpiLabel, { fontSize: ui.kpiRateLabelFs }]}
            numberOfLines={2}
            adjustsFontSizeToFit
            minimumFontScale={0.85}>
            ความสำเร็จ (ฐาน 100%)
          </Text>
          <Text style={[styles.kpiValue, { fontSize: ui.fs(20), color: c.primary }]}>
            {dashboard.successRateBase100}%
          </Text>
          <Text style={[styles.kpiHint, { fontSize: ui.fs(9) }]}>
            หัก {dashboard.badForSuccess}/{dashboard.totalForSuccessRate} งานที่มีผล
          </Text>
        </Pressable>
        <Pressable
          style={[styles.kpiCard, styles.kpiCardRate, { minWidth: ui.kpiMinW }]}
          onPress={() => {
            setDeadlineFilter('all');
            setStatusFilter('done');
            scrollToTaskList();
          }}>
          <Text
            style={[styles.kpiLabel, { fontSize: ui.kpiRateLabelFs }]}
            numberOfLines={2}
            adjustsFontSizeToFit
            minimumFontScale={0.85}>
            ปิดงานล่าช้า
          </Text>
          <Text style={[styles.kpiValue, styles.kpiWarn, { fontSize: ui.fs(19) }]}>
            −{dashboard.deductLatePctOfTotal}%
          </Text>
          <Text style={[styles.kpiHint, { fontSize: ui.fs(9) }]}>
            {dashboard.doneLate} งาน
          </Text>
        </Pressable>
        <Pressable
          style={[styles.kpiCard, styles.kpiCardRate, { minWidth: ui.kpiMinW }]}
          onPress={() => {
            setDeadlineFilter('all');
            setStatusFilter('overdue');
            scrollToTaskList();
          }}>
          <Text
            style={[styles.kpiLabel, { fontSize: ui.kpiRateLabelFs }]}
            numberOfLines={2}
            adjustsFontSizeToFit
            minimumFontScale={0.85}>
            ค้างเกินกำหนด
          </Text>
          <Text style={[styles.kpiValue, styles.kpiWarn, { fontSize: ui.fs(19) }]}>
            −{dashboard.deductOpenOverduePctOfTotal}%
          </Text>
          <Text style={[styles.kpiHint, { fontSize: ui.fs(9) }]}>
            {dashboard.overdue} งาน
          </Text>
        </Pressable>
        <Pressable
          style={[styles.kpiCard, styles.kpiCardRate, { minWidth: ui.kpiMinW }]}
          onPress={() => {
            setDeadlineFilter('all');
            setStatusFilter('cancelled');
            scrollToTaskList();
          }}>
          <Text
            style={[styles.kpiLabel, { fontSize: ui.kpiRateLabelFs }]}
            numberOfLines={2}
            adjustsFontSizeToFit
            minimumFontScale={0.85}>
            อัตรายกเลิก
          </Text>
          <Text style={[styles.kpiValue, { fontSize: ui.fs(20), color: c.textMuted }]}>
            {dashboard.cancelledPct}%
          </Text>
          <Text style={[styles.kpiHint, { fontSize: ui.fs(9) }]}>
            {dashboard.byStatus.cancelled}/{dashboard.total} งาน
          </Text>
        </Pressable>
      </ScrollView>
      <Text style={[styles.rangeHint, { fontSize: ui.fs(11) }]}>
        Summary for last {rangeDays} days (My Tasks)
      </Text>
      <View style={styles.chartCard}>
        <Text style={[styles.chartTitle, { fontSize: ui.fs(14) }]}>Deadline Completion Status</Text>
        <View style={styles.deadlineGrid}>
          <Pressable
            style={styles.deadlineCard}
            onPress={() => setDeadlineFilter('today')}>
            <Text style={[styles.deadlineTitle, { fontSize: ui.fs(11) }]}>Today</Text>
            <Text style={[styles.deadlineValue, { fontSize: ui.fs(15) }]}>
              {deadlineSummary.today.done}/{deadlineSummary.today.total}
            </Text>
            <Text style={[styles.deadlinePct, { fontSize: ui.fs(12) }]}>
              {deadlineSummary.today.pct}%
            </Text>
          </Pressable>
          <Pressable
            style={styles.deadlineCard}
            onPress={() => setDeadlineFilter('week')}>
            <Text style={[styles.deadlineTitle, { fontSize: ui.fs(11) }]}>This Week</Text>
            <Text style={[styles.deadlineValue, { fontSize: ui.fs(15) }]}>
              {deadlineSummary.week.done}/{deadlineSummary.week.total}
            </Text>
            <Text style={[styles.deadlinePct, { fontSize: ui.fs(12) }]}>
              {deadlineSummary.week.pct}%
            </Text>
          </Pressable>
          <Pressable
            style={styles.deadlineCard}
            onPress={() => setDeadlineFilter('month')}>
            <Text style={[styles.deadlineTitle, { fontSize: ui.fs(11) }]}>This Month</Text>
            <Text style={[styles.deadlineValue, { fontSize: ui.fs(15) }]}>
              {deadlineSummary.month.done}/{deadlineSummary.month.total}
            </Text>
            <Text style={[styles.deadlinePct, { fontSize: ui.fs(12) }]}>
              {deadlineSummary.month.pct}%
            </Text>
          </Pressable>
        </View>
        <Text style={[styles.qualityHint, { fontSize: ui.fs(12) }]}>
          Performance Index (completion + on-time): {deadlineSummary.performancePct}%
        </Text>
      </View>

      <View style={styles.chartCard}>
        <Text style={[styles.chartTitle, { fontSize: ui.fs(14) }]}>Task Status</Text>
        <Text style={[styles.chartSubtitle, { fontSize: ui.fs(11) }]}>
          งานทั้งหมด {taskStatusSnapshot.total} งาน — นับจากทุกงานในมุมมองนี้ (ไม่จำกัดช่วง {rangeDays} วัน) · งานรอ/กำลังทำแสดงในรายการเสมอแม้ไม่อยู่ในช่วงเดดไลน์ที่เลือก
        </Text>
        {STATUSES.map((s) => {
          const count = taskStatusSnapshot.byStatus[s];
          const total = taskStatusSnapshot.total;
          const share = total > 0 ? Math.round((count / total) * 100) : 0;
          const barPct = total > 0 ? Math.max(4, Math.round((count / total) * 100)) : 0;
          return (
            <View key={`status-${s}`} style={styles.barRow}>
              <Text style={[styles.barLabel, { width: ui.barLabelW, fontSize: ui.fs(12) }]}>
                {TASK_STATUS_TH[s]}
              </Text>
              <View style={styles.barTrack}>
                <View style={[styles.barFill, { width: `${barPct}%` }]} />
              </View>
              <Text style={[styles.barValue, { fontSize: ui.fs(12) }]}>
                {count} ({share}%)
              </Text>
            </View>
          );
        })}
      </View>

      <View style={styles.chartCard}>
        <Text style={[styles.chartTitle, { fontSize: ui.fs(14) }]}>Priority Distribution</Text>
        <View style={styles.donutWrap}>
          <Svg width={160} height={160} viewBox="0 0 160 160">
            <G transform="rotate(-90 80 80)">
              <Circle cx={80} cy={80} r={56} stroke={c.surfaceMuted} strokeWidth={20} fill="none" />
              {(() => {
                const radius = 56;
                const circumference = 2 * Math.PI * radius;
                let acc = 0;
                return TASK_PRIORITY_OPTIONS.filter((p) => priorityDonut.byPriority[p.key] > 0).map((p) => {
                  const value = priorityDonut.byPriority[p.key];
                  const fraction = value / Math.max(1, priorityDonut.total);
                  const dash = circumference * fraction;
                  const seg = (
                    <Circle
                      key={`donut-${p.key}`}
                      cx={80}
                      cy={80}
                      r={radius}
                      stroke={p.color}
                      strokeWidth={20}
                      fill="none"
                      strokeDasharray={`${dash} ${circumference - dash}`}
                      strokeDashoffset={-acc}
                      strokeLinecap="butt"
                    />
                  );
                  acc += dash;
                  return seg;
                });
              })()}
            </G>
          </Svg>
          <View style={styles.donutCenter}>
            <Text style={[styles.donutCenterValue, { fontSize: ui.fs(24) }]}>
              {priorityDonut.total}
            </Text>
            <Text style={[styles.donutCenterLabel, { fontSize: ui.fs(11) }]}>Open</Text>
          </View>
        </View>
        {TASK_PRIORITY_OPTIONS.map((p) => (
          <View key={`legend-pri-${p.key}`} style={styles.legendPriorityRow}>
            <View style={[styles.legendDot, { backgroundColor: p.color }]} />
            <Text style={[styles.legendPriorityText, { fontSize: ui.fs(12) }]}>{p.label}</Text>
            <Text style={[styles.legendPriorityCount, { fontSize: ui.fs(12) }]}>
              {priorityDonut.byPriority[p.key]}
            </Text>
          </View>
        ))}
        <Text style={[styles.priorityNote, { fontSize: ui.fs(11) }]}>
          * Excludes completed/cancelled tasks
        </Text>
      </View>

      <View style={styles.chartCard}>
        <Text style={[styles.chartTitle, { fontSize: ui.fs(14) }]}>7-Day Trend</Text>
        <View style={styles.trendRow}>
          {dashboard.trend.map((d) => {
            const createdH = Math.max(
              4,
              Math.round((d.created / dashboard.maxTrend) * 52)
            );
            const doneH = Math.max(4, Math.round((d.done / dashboard.maxTrend) * 52));
            return (
              <View key={d.key} style={styles.trendCol}>
                <View style={styles.trendBars}>
                  <View style={[styles.trendCreated, { height: createdH }]} />
                  <View style={[styles.trendDone, { height: doneH }]} />
                </View>
                <Text style={[styles.trendLabel, { fontSize: ui.fs(10) }]}>{d.label}</Text>
              </View>
            );
          })}
        </View>
        <View style={styles.trendLegendRow}>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, styles.trendCreated]} />
            <Text style={[styles.legendText, { fontSize: ui.fs(11) }]}>Created</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, styles.trendDone]} />
            <Text style={[styles.legendText, { fontSize: ui.fs(11) }]}>Completed</Text>
          </View>
        </View>
      </View>
      <View style={styles.chartCard}>
        <Text style={[styles.chartTitle, { fontSize: ui.fs(14) }]}>On-time vs Overdue</Text>
        <View style={styles.barRow}>
          <Text style={[styles.barLabel, { width: ui.barLabelW, fontSize: ui.fs(12) }]}>
            On-time
          </Text>
          <View style={styles.barTrack}>
            <View
              style={[
                styles.barFill,
                {
                  width: `${Math.max(
                    6,
                    Math.round(
                      (dashboard.onTime /
                        Math.max(1, dashboard.onTime + dashboard.overdueQuality)) *
                        100
                    )
                  )}%`,
                  backgroundColor: c.checkIn,
                },
              ]}
            />
          </View>
          <Text style={[styles.barValue, { fontSize: ui.fs(12) }]}>{dashboard.onTime}</Text>
        </View>
        <View style={styles.barRow}>
          <Text style={[styles.barLabel, { width: ui.barLabelW, fontSize: ui.fs(12) }]}>
            Overdue
          </Text>
          <View style={styles.barTrack}>
            <View
              style={[
                styles.barFill,
                {
                  width: `${Math.max(
                    6,
                    Math.round(
                      (dashboard.overdueQuality /
                        Math.max(1, dashboard.onTime + dashboard.overdueQuality)) *
                        100
                    )
                  )}%`,
                  backgroundColor: c.warningTitle,
                },
              ]}
            />
          </View>
          <Text style={[styles.barValue, { fontSize: ui.fs(12) }]}>{dashboard.overdueQuality}</Text>
        </View>
        <Text style={[styles.qualityHint, { fontSize: ui.fs(12) }]}>
          อัตราทำงานตรงเวลา: {dashboard.onTimeRate}%
        </Text>
      </View>

      <View
        onLayout={(e) => {
          taskListYRef.current = e.nativeEvent.layout.y;
        }}
        style={styles.listPad}>
        {filteredTasks.length === 0 ? (
          <Text style={[styles.empty, { fontSize: ui.fs(14) }]}>
            ไม่มีงานในช่วงที่เลือก หรือไม่ตรงกับคำค้น
          </Text>
        ) : (
          filteredTasks.map((item) => {
          const mine = uid ? taskUserIsPrimaryResponsible(item, uid) : false;
          const canSetStatus = uid
            ? canEditTaskStatus(item, uid, manager, admin)
            : false;
          const pri = item.priority ?? 'normal';
          const { percent, done, total } = checklistProgress(item);
          return (
            <View
              key={item.id}
              style={[styles.card, { borderLeftColor: priorityColor(pri) }]}>
              {admin ? (
                <Pressable
                  style={styles.cardDeleteBtn}
                  onPress={() => setDeleteTaskId(item.id)}
                  hitSlop={8}>
                  <Text style={styles.cardDeleteBtnText}>ลบงาน</Text>
                </Pressable>
              ) : null}
              <Pressable onPress={() => setDetailId(item.id)}>
                <Text style={[styles.cardTitle, { fontSize: ui.fs(16) }]}>{item.title}</Text>
                <Text style={[styles.priTag, { fontSize: ui.fs(12) }]}>{priorityLabel(pri)}</Text>
                {item.description ? (
                  <Text style={styles.cardDesc} numberOfLines={2}>
                    {item.description}
                  </Text>
                ) : null}
                <Text style={styles.cardMeta}>
                  สถานะ: {TASK_STATUS_TH[item.status] ?? item.status}
                </Text>
                {taskParticipantUserIds(item).length > 0 ? (
                  <Text style={styles.cardMeta} numberOfLines={3}>
                    รับผิดชอบหลัก:{' '}
                    {taskPrimaryUserIds(item)
                      .map((id) => assigneeLabelFromPicklist(id, assignOptions))
                      .join(', ')}
                    {taskParticipantUserIds(item).length >
                    taskPrimaryUserIds(item).length
                      ? ` · ร่วมงาน: ${taskParticipantUserIds(item)
                          .filter((id) => !taskPrimaryUserIds(item).includes(id))
                          .map((id) => assigneeLabelFromPicklist(id, assignOptions))
                          .join(', ')}`
                      : ''}
                    {item.assigned_by
                      ? item.assigned_by === uid
                        ? ' · ผู้มอบหมาย: คุณ'
                        : ` · ผู้มอบหมาย: ${item.assigned_by.slice(0, 8)}…`
                      : ''}
                  </Text>
                ) : null}
                {item.due_at ? (
                  <Text style={styles.due}>
                    ครบกำหนด:{' '}
                    {new Date(item.due_at).toLocaleString('th-TH')}
                  </Text>
                ) : null}
                <View style={styles.progressBlock}>
                  <View style={styles.progressHeader}>
                    <Text style={styles.progressLabel}>
                      ความคืบหน้า (เช็คลิสต์)
                    </Text>
                    <Text style={styles.progressPct}>
                      {total > 0 ? `${percent}%` : '—'}
                      {total > 0 && percent >= 100 ? ' ✨' : ''}
                    </Text>
                  </View>
                  <TaskProgressBar
                    percent={percent}
                    empty={total === 0}
                  />
                  <Text style={styles.progressSub}>
                    {total > 0
                      ? `ทำแล้ว ${done} จาก ${total} หัวข้อ`
                      : 'ยังไม่มีหัวข้อเช็คลิสต์ — แตะเพื่อเพิ่มในรายละเอียดงาน'}
                  </Text>
                </View>
                <Text style={styles.tapHint}>
                  แตะด้านบนเพื่อรายละเอียด / เช็คลิสต์ / แนบไฟล์
                </Text>
              </Pressable>
              {canSetStatus && item.status !== 'done' ? (
                <View style={styles.statusRow}>
                  {STATUSES.map((s) => (
                    <Pressable
                      key={s}
                      style={[
                        styles.chip,
                        item.status === s && styles.chipOn,
                      ]}
                      onPress={() => updateStatus(item.id, s)}>
                      <Text
                        style={[
                          styles.chipText,
                          item.status === s && styles.chipTextOn,
                        ]}>
                        {TASK_STATUS_TH[s] ?? s}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ) : item.status === 'done' ? (
                <Text style={styles.doneLockedHint}>งานปิดสำเร็จแล้ว — ไม่สามารถเปลี่ยนสถานะกลับได้</Text>
              ) : null}
            </View>
          );
          })
        )}
      </View>
      </ScrollView>

      <Modal
        visible={presentationOpen && !notice && doneChecklistGate == null}
        animationType="slide"
        transparent
        presentationStyle="overFullScreen"
        statusBarTranslucent
        onRequestClose={() => setPresentationOpen(false)}>
        <Pressable style={styles.mgrBack} onPress={() => setPresentationOpen(false)}>
          <Pressable style={styles.mgrCard} onPress={() => {}}>
            <Text style={styles.mgrH1}>ตัวช่วยเตรียมงานนำเสนอ</Text>
            <Text style={styles.assignHint}>
              เลือกเทมเพลต แล้วนำข้อความสรุปไปวางในสไลด์หรือรายงานได้ทันที
            </Text>
            <View style={styles.templateRow}>
              {PRESENTATION_TEMPLATES.map((tpl) => (
                <Pressable
                  key={tpl.id}
                  style={[
                    styles.templateChip,
                    selectedTemplate === tpl.id && styles.templateChipOn,
                  ]}
                  onPress={() => setSelectedTemplate(tpl.id)}>
                  <Text
                    style={[
                      styles.templateChipText,
                      selectedTemplate === tpl.id && styles.templateChipTextOn,
                    ]}>
                    {tpl.title}
                  </Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              style={styles.presentationBox}
              value={presentationDraft}
              multiline
              editable={false}
            />
            <Pressable
              style={styles.sheetPrimaryBtn}
              onPress={copyPresentationSummary}>
              <Text style={styles.sheetPrimaryBtnText}>คัดลอกสรุป</Text>
            </Pressable>
            <Pressable
              style={styles.sheetSecondaryBtn}
              onPress={() => setPresentationOpen(false)}>
              <Text style={styles.sheetSecondaryBtnText}>ปิด</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={managerModalOpen && !notice && doneChecklistGate == null}
        animationType="slide"
        transparent
        presentationStyle="overFullScreen"
        statusBarTranslucent
        onRequestClose={closeManagerModal}>
        <Pressable style={styles.mgrBack} onPress={closeManagerModal}>
          <Pressable style={styles.mgrCard} onPress={() => {}}>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.mgrScrollContent}>
              <Text style={styles.mgrH1}>มอบหมายงาน</Text>

              <Text style={styles.mgrLabel}>ชื่องาน *</Text>
              <TextInput
                style={styles.mgrInput}
                placeholder="เช่น นัดลูกค้า บริษัท …"
                value={title}
                onChangeText={setTitle}
                editable={!mgrSaving}
              />

              <Text style={styles.mgrLabel}>รายละเอียด</Text>
              <TextInput
                style={[styles.mgrInput, styles.mgrTall]}
                placeholder="การนัดหมาย การประสานกับทีม ฯลฯ"
                value={desc}
                onChangeText={setDesc}
                multiline
                editable={!mgrSaving}
              />

              <DatePickerField
                label="วันที่เริ่ม"
                value={orderDate}
                onChange={setOrderDate}
                disabled={mgrSaving}
                maximumDate={dueDate ?? undefined}
              />
              <DatePickerField
                label="วันที่ต้องทำเสร็จ"
                value={dueDate}
                onChange={setDueDate}
                disabled={mgrSaving}
                minimumDate={orderDate ?? undefined}
              />

              <Text style={styles.mgrLabel}>ระดับความสำคัญ</Text>
              <View style={styles.priRow}>
                {TASK_PRIORITY_OPTIONS.map((p) => (
                  <Pressable
                    key={p.key}
                    style={[
                      styles.priChip,
                      { borderColor: p.color },
                      assignPriority === p.key && {
                        backgroundColor: p.color + '33',
                      },
                    ]}
                    onPress={() => setAssignPriority(p.key)}
                    disabled={mgrSaving}>
                    <View
                      style={[styles.priDot, { backgroundColor: p.color }]}
                    />
                    <Text style={styles.priText} numberOfLines={2}>
                      {p.label}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.mgrLabel}>หัวข้อย่อย (ทำเป็นเช็คลิสต์)</Text>
              {checklistLines.map((line) => (
                <View key={line.id} style={styles.lineRow}>
                  <TextInput
                    style={[styles.mgrInput, styles.lineInput]}
                    value={line.text}
                    onChangeText={(v) => updateChecklistLine(line.id, v)}
                    placeholder="หัวข้อย่อย"
                    editable={!mgrSaving}
                  />
                  <Pressable
                    style={[
                      styles.removeMgrLine,
                      checklistLines.length <= 1 && styles.removeMgrLineDisabled,
                    ]}
                    onPress={() => removeChecklistLine(line.id)}
                    disabled={mgrSaving || checklistLines.length <= 1}
                    accessibilityLabel="ลบหัวข้อ">
                    <Text style={styles.removeMgrLineText}>ลบ</Text>
                  </Pressable>
                </View>
              ))}
              <Pressable
                style={styles.addMgrLine}
                onPress={() =>
                  setChecklistLines((prev) => [
                    ...prev,
                    { id: newMgrChecklistLineId(), text: '' },
                  ])
                }
                disabled={mgrSaving}>
                <Text style={styles.addMgrLineText}>+ เพิ่มหัวข้อ</Text>
              </Pressable>

              <Text style={styles.mgrLabel}>มอบหมายงานให้ *</Text>
              <Text style={styles.assignHint}>
                แตะแถวเพื่อเลือก/ยกเลิกหลายคน — แสดงชื่อจาก HR / โปรไฟล์ แจ้งเตือนไปที่บัญชีล็อกอิน
                {admin ? '' : ' (เฉพาะลูกทีมที่แอดมินกำหนดใน manager_direct_reports)'} ·
                ค้นหาได้จากชื่อ นามสกุล ชื่อเล่น หรืออีเมล
              </Text>
              {assignOptions.length === 0 ? (
                <Text style={styles.assignEmpty}>
                  {admin
                    ? 'ยังไม่มีรายชื่อพนักงาน — ตรวจสอบว่ามีบทบาท employee ในระบบ และ (ถ้าใช้ RPC ใหม่) รัน migration บน Supabase แล้ว'
                    : 'ยังไม่มีรายชื่อลูกทีม — ให้แอดมินกำหนดลูกทีม (manager_direct_reports) และเชื่อม employee กับโปรไฟล์'}
                </Text>
              ) : (
                <>
                  <TextInput
                    style={styles.assignSearch}
                    placeholder="ค้นหาชื่อพนักงาน ชื่อเล่น หรืออีเมล…"
                    placeholderTextColor={c.textMuted}
                    value={assigneeSearch}
                    onChangeText={setAssigneeSearch}
                    editable={!mgrSaving}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  {assigneeSearch.trim() && filteredAssignOptions.length === 0 ? (
                    <Text style={styles.assignNoResults}>ไม่พบผลการค้นหา</Text>
                  ) : null}
                </>
              )}
              {selectedAssigneeIds.length > 0 ? (
                <>
                  <Text style={[styles.mgrLabel, { marginTop: 12 }]}>
                    ผู้รับผิดชอบหลัก (เลือกได้หลายคน = รับผิดชอบร่วมกัน)
                  </Text>
                  <Text style={styles.assignHint}>
                    แตะชื่อด้านล่างเพื่อติ๊ก/ยกติ๊ก «หลัก» — งานจะไปอยู่ในรายการหลักของคนที่เป็นหลักเท่านั้น
                    (ถ้าคุณเป็นคนมอบหมายแต่ไม่ได้เป็นหลัก งานจะไม่ขึ้นในรายการงานของคุณ)
                  </Text>
                  {selectedAssigneeIds.map((pid) => {
                    const isPrimary = primaryAmongSelected.includes(pid);
                    return (
                      <Pressable
                        key={`pri-${pid}`}
                        style={[styles.primaryPickRow, isPrimary && styles.primaryPickRowOn]}
                        onPress={() => togglePrimaryPick(pid)}
                        disabled={mgrSaving}>
                        <Text style={styles.pickPrimary}>
                          {assigneeLabelFromPicklist(pid, assignOptions)}
                        </Text>
                        <Text style={styles.pickEmail}>
                          {isPrimary ? 'ผู้รับผิดชอบหลัก ✓' : 'แตะเพื่อตั้งเป็นผู้รับผิดชอบหลัก'}
                        </Text>
                      </Pressable>
                    );
                  })}
                </>
              ) : null}
              {filteredAssignOptions.map((row) => {
                const acc = row.account_email?.trim() ?? '';
                const hrId = row.hr_user_id?.trim() ?? '';
                const showHrId =
                  hrId.length > 0 &&
                  (!acc || hrId.toLowerCase() !== acc.toLowerCase());
                const headline = assignDisplayHeadline(row);
                const nick = row.hr_nickname?.trim();
                const picked = selectedAssigneeIds.includes(row.profile_id);
                const av = assignAvatarByProfileId[row.profile_id];
                return (
                  <Pressable
                    key={row.profile_id}
                    style={[styles.pickRow, picked && styles.pickRowOn]}
                    onPress={() => toggleAssigneePick(row.profile_id)}
                    disabled={mgrSaving}>
                    <View style={styles.pickRowInner}>
                      <UserAvatar
                        uri={av ?? undefined}
                        label={headline || row.account_email || row.profile_id}
                        size={44}
                      />
                      <View style={styles.pickBody}>
                        <Text style={styles.pickPrimary}>
                          {headline || 'ยังไม่มีชื่อในระบบ'}
                        </Text>
                        {nick ? (
                          <Text style={styles.pickNickname}>ชื่อเล่น {nick}</Text>
                        ) : null}
                        {acc ? (
                          <Text style={styles.pickEmail} numberOfLines={2}>
                            อีเมลล็อกอิน: {acc}
                          </Text>
                        ) : null}
                        {showHrId ? (
                          <Text style={styles.pickHrId} numberOfLines={2}>
                            HR UserID: {hrId}
                          </Text>
                        ) : null}
                      </View>
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>

            <View style={styles.mgrActions}>
              <Pressable
                style={styles.mgrCancel}
                onPress={closeManagerModal}
                disabled={mgrSaving}>
                <Text style={styles.mgrCancelText}>ยกเลิก</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.mgrSave,
                  (mgrSaving ||
                    !title.trim() ||
                    selectedAssigneeIds.length === 0 ||
                    primaryAmongSelected.length === 0) &&
                    styles.mgrSaveDisabled,
                ]}
                onPress={createManagerTask}
                disabled={
                  mgrSaving ||
                  !title.trim() ||
                  selectedAssigneeIds.length === 0 ||
                  primaryAmongSelected.length === 0
                }>
                {mgrSaving ? (
                  <ActivityIndicator color={NatureTheme.colors.onAccent} />
                ) : (
                  <Text style={styles.mgrSaveText}>บันทึกงาน</Text>
                )}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
      <FriendlyConfirmModal
        visible={doneChecklistGate != null}
        title="ยืนยันปิดงานสำเร็จ?"
        message="ยังมีหัวข้อเช็คลิสต์ที่ยังไม่เสร็จ ต้องการให้ติ๊กครบทุกข้อแล้วปิดงานหรือไม่?"
        confirmLabel="ติ๊กครบและปิดงาน"
        cancelLabel="ยกเลิก"
        onConfirm={() => void confirmDoneTickChecklistAndClose()}
        onCancel={() => setDoneChecklistGate(null)}
      />
      <FriendlyConfirmModal
        visible={deleteTaskId != null}
        title="ลบงานจากระบบ?"
        message="งาน เช็คลิสต์ และไฟล์แนบที่เกี่ยวข้องจะถูกลบถาวร ไม่สามารถกู้คืนได้"
        confirmLabel={deleteBusy ? 'กำลังลบ…' : 'ลบถาวร'}
        cancelLabel="ยกเลิก"
        danger
        onConfirm={() => void confirmDeleteTask()}
        onCancel={() => {
          if (!deleteBusy) setDeleteTaskId(null);
        }}
      />
      <FriendlyNoticeModal
        visible={!!notice}
        variant={notice?.variant ?? 'info'}
        title={notice?.title ?? ''}
        message={notice?.message}
        autoDismissMs={notice?.autoDismissMs}
        onClose={() => setNotice(null)}
      />
    </View>
  );
}

const c = NatureTheme.colors;
const r = NatureTheme.radius;
const s = NatureTheme.spacing;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.canvas },
  mainScroll: { flex: 1 },
  mainContent: { paddingBottom: 14 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  toolbar: {
    flexDirection: 'row',
    paddingTop: 8,
    paddingBottom: 4,
    flexWrap: 'wrap',
  },
  kpiRow: {
    paddingHorizontal: s.screen,
    gap: 8,
    paddingBottom: 6,
  },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: s.screen,
    gap: 6,
    paddingBottom: 6,
  },
  filterChip: {
    paddingHorizontal: s.screen,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: c.chip,
  },
  filterChipOn: { backgroundColor: c.chipActive },
  filterChipText: { fontSize: 12, color: c.chipText, fontWeight: '600' },
  filterChipTextOn: { color: c.chipTextActive },
  viewingMemberBanner: {
    marginHorizontal: s.screen,
    marginBottom: 8,
    backgroundColor: c.primaryLight,
    borderWidth: 1,
    borderColor: c.primaryMuted,
    borderRadius: r.sm,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  viewingMemberBannerText: { color: c.primaryDark, fontWeight: '700', fontSize: 12 },
  rangeHint: {
    paddingHorizontal: s.screen,
    fontSize: 11,
    color: c.textMuted,
    marginBottom: 6,
  },
  kpiSectionLabel: {
    paddingHorizontal: s.screen,
    marginTop: 2,
    marginBottom: 4,
    color: c.textSecondary,
    fontWeight: '600',
  },
  kpiHint: {
    marginTop: 4,
    color: c.textMuted,
    textAlign: 'center',
  },
  kpiCardRate: {
    paddingTop: 6,
    paddingBottom: 8,
    alignItems: 'center',
  },
  kpiCard: {
    minWidth: 132,
    backgroundColor: c.surface,
    borderRadius: r.md,
    borderWidth: 1,
    borderColor: c.borderSoft,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  kpiLabel: { fontSize: 12, color: c.textMuted, marginBottom: 2 },
  kpiValue: { fontSize: 22, fontWeight: '800', color: c.text },
  kpiWarn: { color: c.warningTitle },
  chartCard: {
    marginHorizontal: s.screen,
    marginBottom: s.section,
    backgroundColor: c.surface,
    borderRadius: r.md,
    borderWidth: 1,
    borderColor: c.borderSoft,
    padding: s.card,
  },
  chartTitle: { fontWeight: '700', fontSize: 14, color: c.text, marginBottom: 4 },
  chartSubtitle: { color: c.textMuted, marginBottom: 8 },
  deadlineGrid: {
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  deadlineCard: {
    flex: 1,
    backgroundColor: c.surfaceMuted,
    borderRadius: r.sm,
    borderWidth: 1,
    borderColor: c.borderSoft,
    paddingVertical: 10,
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  deadlineTitle: { fontSize: 11, color: c.textMuted },
  deadlineValue: { marginTop: 2, fontSize: 15, fontWeight: '700', color: c.text },
  deadlinePct: { marginTop: 2, fontSize: 12, color: c.primaryDark, fontWeight: '700' },
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  barLabel: { width: 88, fontSize: 12, color: c.textSecondary },
  barTrack: {
    flex: 1,
    height: 10,
    borderRadius: 999,
    backgroundColor: c.surfaceMuted,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: c.primary,
  },
  barValue: {
    minWidth: 56,
    textAlign: 'right',
    color: c.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  doneLockedHint: {
    marginTop: 10,
    fontSize: 12,
    color: c.textMuted,
    fontStyle: 'italic',
  },
  trendRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 6,
    minHeight: 74,
  },
  trendCol: { flex: 1, alignItems: 'center' },
  trendBars: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 3,
  },
  trendCreated: {
    width: 8,
    borderRadius: 4,
    backgroundColor: c.river,
  },
  trendDone: {
    width: 8,
    borderRadius: 4,
    backgroundColor: c.checkIn,
  },
  trendLabel: { marginTop: 4, fontSize: 10, color: c.textMuted },
  trendLegendRow: {
    marginTop: 6,
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontSize: 11, color: c.textMuted },
  donutWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  donutCenter: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  donutCenterValue: { fontSize: 24, fontWeight: '800', color: c.text },
  donutCenterLabel: { fontSize: 11, color: c.textMuted },
  legendPriorityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  legendPriorityText: { flex: 1, fontSize: 12, color: c.textSecondary },
  legendPriorityCount: { fontSize: 12, fontWeight: '700', color: c.textMuted },
  priorityNote: { marginTop: 4, fontSize: 11, color: c.textMuted },
  qualityHint: {
    marginTop: 8,
    fontSize: 12,
    color: c.textSecondary,
    fontWeight: '600',
  },
  templateRow: {
    gap: 8,
    marginBottom: 10,
  },
  templateChip: {
    borderWidth: 1,
    borderColor: c.borderSoft,
    borderRadius: r.sm,
    backgroundColor: c.surface,
    paddingVertical: 9,
    paddingHorizontal: 10,
  },
  templateChipOn: {
    borderColor: c.primaryMuted,
    backgroundColor: c.primaryLight,
  },
  templateChipText: { fontSize: 12, color: c.textSecondary, fontWeight: '600' },
  templateChipTextOn: { color: c.primaryDark },
  presentationBox: {
    minHeight: 200,
    maxHeight: 300,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: r.sm,
    padding: s.card,
    backgroundColor: c.surface,
    color: c.text,
    textAlignVertical: 'top',
  },
  sheetSecondaryBtn: {
    marginTop: 10,
    backgroundColor: c.surface,
    paddingVertical: 12,
    borderRadius: r.sm,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: c.border,
  },
  sheetSecondaryBtnText: { color: c.primaryDark, fontWeight: '700', fontSize: 14 },
  sheetPrimaryBtn: {
    marginTop: 10,
    backgroundColor: c.primary,
    paddingVertical: 12,
    borderRadius: r.sm,
    alignItems: 'center',
  },
  sheetPrimaryBtnText: { color: c.onAccent, fontWeight: '700', fontSize: 14 },
  selfBtn: {
    flex: 1,
    minWidth: 0,
    backgroundColor: c.checkIn,
    paddingVertical: 12,
    borderRadius: r.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selfBtnText: { color: c.onAccent, fontWeight: '700' },
  mgrBtn: {
    flex: 1,
    minWidth: 0,
    backgroundColor: c.primary,
    paddingVertical: 12,
    borderRadius: r.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mgrBtnText: { color: c.onAccent, fontWeight: '700' },
  deckBtn: {
    flex: 1,
    minWidth: 0,
    backgroundColor: c.river,
    paddingVertical: 12,
    borderRadius: r.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deckBtnText: { color: c.onAccent, fontWeight: '700' },
  assignTrackBtn: {
    flexBasis: '100%',
    minWidth: 0,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.borderSoft,
    borderRadius: r.md,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  assignTrackBtnText: { color: c.primaryDark, fontWeight: '700' },
  taskSearchInput: {
    borderWidth: 1,
    borderColor: c.borderSoft,
    borderRadius: r.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: c.text,
    backgroundColor: c.surface,
  },
  cardDeleteBtn: {
    alignSelf: 'flex-end',
    marginBottom: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: r.sm,
    backgroundColor: c.errorBg,
  },
  cardDeleteBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: c.error,
  },
  listPad: { paddingBottom: s.scrollBottom },
  card: {
    marginHorizontal: s.screen,
    marginBottom: s.section,
    padding: s.card,
    backgroundColor: c.surface,
    borderRadius: r.md,
    borderWidth: 1,
    borderColor: c.borderSoft,
    borderLeftWidth: 5,
  },
  cardTitle: { fontWeight: '700', fontSize: 16, color: c.text },
  priTag: { fontSize: 12, color: c.textMuted, marginTop: 4 },
  cardDesc: { marginTop: 6, color: c.textSecondary },
  cardMeta: { marginTop: 8, color: c.textMuted, fontSize: 13 },
  due: { marginTop: 4, fontSize: 12, color: c.accentWarm },
  progressBlock: { marginTop: 8 },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  progressLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: c.textSecondary,
  },
  progressPct: {
    fontSize: 13,
    fontWeight: '700',
    color: c.primary,
  },
  progressSub: {
    marginTop: 6,
    fontSize: 11,
    color: c.textMuted,
  },
  statusRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: r.sm,
    backgroundColor: c.chip,
  },
  chipOn: { backgroundColor: c.chipActive },
  chipText: { fontSize: 12, color: c.chipText },
  chipTextOn: { color: c.chipTextActive, fontWeight: '600' },
  tapHint: {
    fontSize: 11,
    color: c.textMuted,
    marginTop: 10,
    fontStyle: 'italic',
  },
  empty: { textAlign: 'center', color: c.textMuted, marginTop: 20 },
  mgrBack: {
    flex: 1,
    backgroundColor: c.overlay,
    justifyContent: 'flex-end',
  },
  mgrCard: {
    backgroundColor: c.surfaceElevated,
    borderTopLeftRadius: r.xl,
    borderTopRightRadius: r.xl,
    padding: 14,
    maxHeight: '92%',
    borderWidth: 1,
    borderColor: c.borderSoft,
  },
  mgrScrollContent: { paddingBottom: 12 },
  mgrH1: {
    fontSize: 18,
    fontWeight: '700',
    color: c.text,
    marginBottom: 10,
  },
  mgrLabel: {
    fontWeight: '600',
    fontSize: 13,
    color: c.textSecondary,
    marginBottom: 6,
    marginTop: 8,
  },
  mgrInput: {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: r.sm,
    padding: 12,
    marginBottom: 10,
    backgroundColor: c.surface,
    color: c.text,
  },
  mgrTall: { minHeight: 88, textAlignVertical: 'top' },
  priRow: { gap: 8, marginBottom: 8 },
  priChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    borderRadius: r.sm,
    borderWidth: 1.5,
    backgroundColor: c.surfaceMuted,
  },
  priDot: { width: 12, height: 12, borderRadius: 6 },
  priText: { flex: 1, fontSize: 12, color: c.text },
  lineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  lineInput: { flex: 1, marginBottom: 0 },
  removeMgrLine: {
    paddingHorizontal: s.screen,
    paddingVertical: 12,
    borderRadius: r.sm,
    backgroundColor: c.errorBg,
    borderWidth: 1,
    borderColor: c.error + '55',
  },
  removeMgrLineDisabled: { opacity: 0.35 },
  removeMgrLineText: { color: c.error, fontWeight: '700', fontSize: 13 },
  addMgrLine: { paddingVertical: 8, marginBottom: 8 },
  addMgrLineText: { color: c.link, fontWeight: '600' },
  assignHint: {
    fontSize: 12,
    color: c.textMuted,
    marginBottom: 10,
    lineHeight: 17,
  },
  assignEmpty: {
    fontSize: 13,
    color: c.warningTitle,
    marginBottom: 12,
    lineHeight: 20,
  },
  assignSearch: {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: r.sm,
    paddingHorizontal: s.screen,
    paddingVertical: 10,
    marginBottom: 10,
    backgroundColor: c.surface,
    color: c.text,
    fontSize: 15,
  },
  assignNoResults: {
    fontSize: 13,
    color: c.textMuted,
    marginBottom: 10,
    fontStyle: 'italic',
  },
  pickRow: {
    paddingVertical: 10,
    paddingHorizontal: 8,
    marginBottom: 4,
    borderRadius: r.sm,
    borderWidth: 1,
    borderColor: c.borderSoft,
    backgroundColor: c.surface,
  },
  pickRowOn: {
    backgroundColor: c.primaryLight,
    borderColor: c.primaryMuted,
  },
  pickRowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  pickBody: { flex: 1, minWidth: 0 },
  primaryPickRow: {
    paddingVertical: 8,
    paddingHorizontal: 8,
    marginBottom: 6,
    borderRadius: r.sm,
    borderWidth: 1,
    borderColor: c.borderSoft,
    backgroundColor: c.surface,
  },
  primaryPickRowOn: {
    borderColor: c.primary,
    backgroundColor: c.primaryLight,
  },
  pickPrimary: { fontSize: 15, fontWeight: '600', color: c.text },
  pickNickname: { fontSize: 13, color: c.primaryDark, marginTop: 2 },
  pickEmail: { fontSize: 11, color: c.textMuted, marginTop: 2 },
  pickHrId: { fontSize: 11, color: c.accentWarm, marginTop: 2 },
  mgrActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 12,
    paddingTop: 6,
    borderTopWidth: 1,
    borderColor: c.borderSoft,
  },
  mgrCancel: { padding: 12 },
  mgrCancelText: { color: c.textMuted, fontWeight: '600' },
  mgrSave: {
    backgroundColor: c.primary,
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: r.md,
    minWidth: 120,
    alignItems: 'center',
  },
  mgrSaveDisabled: { opacity: 0.7 },
  mgrSaveText: { color: c.onAccent, fontWeight: '700' },
});
