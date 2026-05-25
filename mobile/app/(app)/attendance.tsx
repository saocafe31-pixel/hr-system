import FontAwesome from '@expo/vector-icons/FontAwesome';
import * as FileSystem from 'expo-file-system/legacy';
import * as Location from 'expo-location';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';

import { AnnouncementCarousel } from '@/components/AnnouncementCarousel';
import { DatePickerField } from '@/components/DatePickerField';
import { FriendlyNoticeModal } from '@/components/FriendlyNoticeModal';
import { LeaveRequestModal } from '@/components/LeaveRequestModal';
import { LateRequestModal } from '@/components/LateRequestModal';
import { UserAvatar } from '@/components/UserAvatar';
import { WellbeingMoodModal } from '@/components/WellbeingMoodModal';
import { useAuth } from '@/contexts/AuthContext';
import { useCuteToast } from '@/contexts/CuteToastContext';
import { NatureTheme } from '@/constants/Theme';
import { parseAnnouncementSettings, type AnnouncementSlide } from '@/lib/announcementSlides';
import { onLeaveStatusChanged } from '@/lib/appSignals';
import { presentBackgroundAwareNotification } from '@/lib/appNotifications';
import {
  computeLateFromAttendanceData,
  type AssignmentWithShiftTimes,
} from '@/lib/computeLateFromAttendance';
import { currentYearBangkok } from '@/lib/leaveLateRules';
import { distanceMeters } from '@/lib/geo';
import { mapBranchInformationRows } from '@/lib/mapBranchInformation';
import { priorityColor, sortByPriorityThenCreated } from '@/lib/taskHelpers';
import { supabase } from '@/lib/supabase';
import type { AttendanceLog, Branch, TaskPriority, WorkScheduleRow } from '@/lib/types';
import {
  fetchLatestTodayEmojiByUserIds,
  nameWithMoodEmoji,
  WELLBEING_MOOD_OPTIONS,
  type WellbeingMoodOption,
} from '@/lib/wellbeing';

type PendingTask = {
  id: string;
  title: string;
  status: string;
  priority?: string | null;
};

type GeoBranch = {
  lat: number;
  lon: number;
  branchId: number | null;
  within: boolean;
  branchName: string;
  /** บันทึกลง attendance_logs.note (เช่น WFH / ทำงานนอกสถานที่) */
  note: string | null;
};

type BranchMatch = { br: Branch; distanceM: number };

type PendingCheckIn = GeoBranch;
type AttendanceSummaryRow = {
  dateYmd: string;
  checkIn: string;
  checkOut: string;
  checkInIso?: string;
  checkOutIso?: string;
  employeeCode: string;
  checkInLocation: string;
  note: string;
};

type SummaryLeaveRow = {
  starts_on: string;
  ends_on: string;
  leave_type: 'sick' | 'personal' | 'vacation';
  status: 'pending' | 'approved';
};

type SummaryLateRequestRow = {
  work_date: string;
  minutes_late: number;
};

type TodayShiftAssignmentRow = {
  work_date: string;
  shift_id: string;
  allowed_branch_id?: number | null;
};

type TodayLegacyScheduleRow = {
  start_at: string;
  end_at: string;
  title: string | null;
};

type TodayWorkPlan = {
  source: 'shift' | 'legacy';
  title: string;
  startIso: string;
  endIso: string;
  startLabel: string;
  endLabel: string;
  allowedBranchId?: number | null;
  allowedBranchName?: string | null;
};

type OvertimeRequestRow = {
  id: string;
  status: 'pending' | 'accepted' | 'declined' | 'auto_checked_out';
  response_deadline_at: string;
  work_date: string;
};

type MyScheduleCalendarRow = {
  ymd: string;
  title: string;
  startText: string;
  endText: string;
  source: 'shift' | 'legacy';
  allowedBranchId?: number | null;
  allowedBranchName?: string | null;
};

type CalendarCell = {
  ymd: string | null;
  rows: MyScheduleCalendarRow[];
  markerSource: 'shift' | 'legacy' | 'memo' | null;
};

type CalendarChecklistItem = {
  id: string;
  label: string;
  done: boolean;
};

const WEB_MODAL_BACKDROP = Platform.select({
  web: {
    position: 'fixed' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 999_999,
  },
  default: {},
});

function taskStatusLabelTh(status: string): string {
  if (status === 'in_progress') return 'กำลังทำ';
  if (status === 'pending') return 'รอดำเนินการ';
  return status;
}

function attendanceKindLabel(kind: AttendanceLog['kind']): string {
  if (kind === 'check_in') return 'เข้างาน';
  if (kind === 'check_out') return 'ออกงาน';
  if (kind === 'break_start') return 'เริ่มพัก';
  if (kind === 'break_end') return 'เริ่มงานหลังพัก';
  return kind;
}

const BREAK_START_MESSAGES_DEFAULT = [
  'วันนี้เป็นยังไงบ้าง เหนื่อยไหมคนเก่ง',
  'ได้พักแล้ว อย่าลืมหาอะไรกินด้วยนะ',
  'เหนื่อยก็มานั่งพัก ไม่ใช่ไปนั่งคิดถึงคนที่เขาไม่รักนะ',
];

const BREAK_END_MESSAGES_DEFAULT = [
  'ได้เวลากลับมาสู้แล้ว',
  'ทำงาน ทำงาน ทำงาน',
  'เวลาพักมีมากมายในหลุมศพ แต่ตอนนี้ต้องทำงานแล้วนะ',
];

function bangkokYmd(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function parseSettingsMessages(
  raw: unknown,
  fallback: string[]
): string[] {
  if (!raw || typeof raw !== 'object') return fallback;
  const value = raw as { messages?: unknown };
  if (!Array.isArray(value.messages)) return fallback;
  const msgs = value.messages
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter((v) => v.length > 0);
  return msgs.length > 0 ? msgs : fallback;
}

function pickRandomMessage(messages: string[]): string {
  if (messages.length === 0) return '';
  return messages[Math.floor(Math.random() * messages.length)] ?? '';
}

function formatDurationMs(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const hh = Math.floor(totalSec / 3600);
  const mm = Math.floor((totalSec % 3600) / 60);
  const ss = totalSec % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return `${two(hh)}:${two(mm)}:${two(ss)}`;
}

function htmlEscape(input: string): string {
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function csvEscape(input: string): string {
  const escaped = input.replaceAll('"', '""');
  return `"${escaped}"`;
}

function formatBangkokDateTimeForCsv(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

function ymdToDate(ymd: string): Date {
  return new Date(`${ymd}T12:00:00+07:00`);
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

function ymdFromParts(year: number, month: number, day: number): string {
  const two = (n: number) => String(n).padStart(2, '0');
  return `${year}-${two(month)}-${two(day)}`;
}

function buildPeriod26To25(anchorDate: Date): { startYmd: string; endYmd: string } {
  const { year, month } = ymdPartsInBangkok(anchorDate);
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  return {
    startYmd: ymdFromParts(prevYear, prevMonth, 26),
    endYmd: ymdFromParts(year, month, 25),
  };
}

function listYmdRange(startYmd: string, endYmd: string): string[] {
  const out: string[] = [];
  const d = ymdToDate(startYmd);
  const end = ymdToDate(endYmd).getTime();
  while (d.getTime() <= end) {
    out.push(bangkokYmd(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

function leaveTypeLabelTh(type: SummaryLeaveRow['leave_type']): string {
  if (type === 'sick') return 'ลาป่วย';
  if (type === 'personal') return 'ลากิจ';
  if (type === 'vacation') return 'ลาพักร้อน';
  return 'ลา';
}

function leaveStatusSuffixTh(status: SummaryLeaveRow['status']): string {
  return status === 'pending' ? ' (รออนุมัติ)' : '';
}

function lateRequestMinutesByWorkDate(rows: SummaryLateRequestRow[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    const ymd = String(row.work_date).slice(0, 10);
    const minutes = Number(row.minutes_late);
    if (!ymd || !Number.isFinite(minutes) || minutes <= 0) continue;
    map.set(ymd, (map.get(ymd) ?? 0) + minutes);
  }
  return map;
}

function parseShiftTimeText(raw: string): { hh: number; mm: number; ss: number } | null {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(raw.trim());
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  const ss = Number(m[3] ?? '0');
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59 || ss < 0 || ss > 59) return null;
  return { hh, mm, ss };
}

function buildBangkokIsoFromYmdTime(ymd: string, timeText: string): string | null {
  const t = parseShiftTimeText(timeText);
  if (!t) return null;
  const two = (n: number) => String(n).padStart(2, '0');
  return `${ymd}T${two(t.hh)}:${two(t.mm)}:${two(t.ss)}+07:00`;
}

function addMonthsLocal(base: Date, delta: number): Date {
  return new Date(base.getFullYear(), base.getMonth() + delta, 1, 12, 0, 0, 0);
}

/** แถวจาก Supabase สำหรับการ์ดงานค้างบนหน้าเข้า–ออก */
type OpenTaskRow = {
  id: string;
  title: string;
  status: string;
  priority?: string | null;
  assigned_to: string;
  created_at?: string;
};

/** งานค้างที่ผู้ใช้เป็นผู้รับผิดชอบ/ร่วมงาน — ไม่รวมเฉพาะผู้มอบหมาย (สอดคล้องหน้างาน) */
async function fetchOpenTasksForAttendance(uid: string): Promise<OpenTaskRow[]> {
  const openStatuses = ['pending', 'in_progress'] as const;
  const sel = 'id,title,status,priority,assigned_to,created_at';
  const { data: linkRows, error: linkErr } = await supabase
    .from('task_assignees')
    .select('task_id')
    .eq('user_id', uid);
  if (linkErr) return [];
  const taskIds = [
    ...new Set(
      (linkRows ?? []).map((r: { task_id: string }) => String(r.task_id))
    ),
  ];
  if (taskIds.length === 0) return [];
  const { data, error } = await supabase
    .from('tasks')
    .select(sel)
    .in('id', taskIds)
    .in('status', [...openStatuses])
    .order('created_at', { ascending: false })
    .limit(80);
  if (error) return [];
  return (data ?? []) as OpenTaskRow[];
}

export default function AttendanceScreen() {
  const toast = useCuteToast();
  const { profile, session } = useAuth();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [pendingTasks, setPendingTasks] = useState<PendingTask[]>([]);
  const [announcementUrls, setAnnouncementUrls] = useState<string[]>([]);
  const [announcementSlides, setAnnouncementSlides] = useState<AnnouncementSlide[]>([]);
  const [announcementSlideHeightPx, setAnnouncementSlideHeightPx] = useState(160);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [acting, setActing] = useState(false);
  const [moodOpen, setMoodOpen] = useState(false);
  const [moodSaving, setMoodSaving] = useState(false);
  const [pendingCheckIn, setPendingCheckIn] = useState<PendingCheckIn | null>(
    null
  );
  const [myTodayEmoji, setMyTodayEmoji] = useState<string | null>(null);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [checkOutConfirmOpen, setCheckOutConfirmOpen] = useState(false);
  const [checkoutDoneOpen, setCheckoutDoneOpen] = useState(false);
  const [postCheckInOpen, setPostCheckInOpen] = useState(false);
  const [postCheckInTasks, setPostCheckInTasks] = useState<PendingTask[]>([]);
  const [breakNotice, setBreakNotice] = useState<{
    title: string;
    message: string;
    variant: 'info' | 'status';
  } | null>(null);
  const [breakStartMessages, setBreakStartMessages] = useState<string[]>(
    BREAK_START_MESSAGES_DEFAULT
  );
  const [breakEndMessages, setBreakEndMessages] = useState<string[]>(
    BREAK_END_MESSAGES_DEFAULT
  );
  const [nowTick, setNowTick] = useState(() => new Date());

  /** หลายสาขาทับซ้อน — เลือกสาขาที่เข้างาน */
  const [branchPickOpen, setBranchPickOpen] = useState(false);
  const [branchPickMatches, setBranchPickMatches] = useState<BranchMatch[]>([]);
  const [leaveModalOpen, setLeaveModalOpen] = useState(false);
  const [lateModalOpen, setLateModalOpen] = useState(false);
  /** วันนี้ (กทม.) มี leave approved ครอบคลุม — บล็อกเข้า/ออก/พัก/ขอสาย/ลาซ้ำทั้งวัน */
  const [onApprovedLeaveToday, setOnApprovedLeaveToday] = useState(false);
  const [summaryAnchorDate, setSummaryAnchorDate] = useState<Date | null>(() => new Date());
  const [summaryLogs, setSummaryLogs] = useState<AttendanceLog[]>([]);
  const [summaryLeaves, setSummaryLeaves] = useState<SummaryLeaveRow[]>([]);
  const [summaryLateRequests, setSummaryLateRequests] = useState<SummaryLateRequestRow[]>([]);
  const [summaryAssignments, setSummaryAssignments] = useState<AssignmentWithShiftTimes[]>([]);
  const [summaryLegacySchedules, setSummaryLegacySchedules] = useState<WorkScheduleRow[]>([]);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [todayPlanLabel, setTodayPlanLabel] = useState<string | null>(null);
  const [todayWorkPlan, setTodayWorkPlan] = useState<TodayWorkPlan | null>(null);
  const [pendingOvertimeRequest, setPendingOvertimeRequest] = useState<OvertimeRequestRow | null>(
    null
  );
  const [notifPrefs, setNotifPrefs] = useState<{
    task_enabled: boolean;
    mention_enabled: boolean;
    checkout_enabled: boolean;
  }>({
    task_enabled: true,
    mention_enabled: true,
    checkout_enabled: true,
  });
  const [otResponding, setOtResponding] = useState(false);
  const [scheduleCalendarOpen, setScheduleCalendarOpen] = useState(false);
  const [scheduleCalendarAnchorDate, setScheduleCalendarAnchorDate] = useState<Date | null>(
    () => new Date()
  );
  const [scheduleCalendarRows, setScheduleCalendarRows] = useState<MyScheduleCalendarRow[]>([]);
  const [scheduleCalendarLoading, setScheduleCalendarLoading] = useState(false);
  const [scheduleSelectedYmd, setScheduleSelectedYmd] = useState<string | null>(null);
  const [scheduleDayDetailOpen, setScheduleDayDetailOpen] = useState(false);
  const [scheduleDayDetailRows, setScheduleDayDetailRows] = useState<MyScheduleCalendarRow[]>([]);
  const [scheduleDayNote, setScheduleDayNote] = useState('');
  const [scheduleDayChecklist, setScheduleDayChecklist] = useState<CalendarChecklistItem[]>([]);
  const [scheduleDaySaving, setScheduleDaySaving] = useState(false);
  const [scheduleDayLoading, setScheduleDayLoading] = useState(false);
  const [scheduleDayNewItemText, setScheduleDayNewItemText] = useState('');
  const [scheduleDayMemoCache, setScheduleDayMemoCache] = useState<
    Record<string, { note: string; checklist: CalendarChecklistItem[] }>
  >({});
  const [scheduleMemoYmdSet, setScheduleMemoYmdSet] = useState<Set<string>>(() => new Set());
  const endReminderSentRef = useRef<string | null>(null);

  const [branchPickLatLon, setBranchPickLatLon] = useState<{
    lat: number;
    lon: number;
  } | null>(null);

  /** ไม่อยู่ในรัศมีสาขา — ระบุตำแหน่ง + หมายเหตุ */
  const [offSiteOpen, setOffSiteOpen] = useState(false);
  const [offSiteLocation, setOffSiteLocation] = useState('');
  const [offSiteRemark, setOffSiteRemark] = useState('');
  const [offSiteLatLon, setOffSiteLatLon] = useState<{
    lat: number;
    lon: number;
  } | null>(null);
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxWaitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingReloadRef = useRef(false);

  const load = useCallback(async () => {
    const uid = session?.user?.id;
    const tasksReq = uid
      ? fetchOpenTasksForAttendance(uid).then((rows) => ({
          data: rows,
          error: null,
        }))
      : Promise.resolve({ data: [] as OpenTaskRow[], error: null });
    const logsReq =
      uid != null && uid !== ''
        ? supabase
            .from('attendance_logs')
            .select('*')
            .eq('user_id', uid)
            .order('created_at', { ascending: false })
            .limit(30)
        : Promise.resolve({ data: [] as AttendanceLog[] });

    const todayYmdForLeave = bangkokYmd(new Date());
    const approvedLeaveTodayReq =
      uid != null && uid !== ''
        ? supabase
            .from('leave_requests')
            .select('id')
            .eq('user_id', uid)
            .eq('status', 'approved')
            .lte('starts_on', todayYmdForLeave)
            .gte('ends_on', todayYmdForLeave)
            .limit(1)
        : Promise.resolve({ data: [] as { id: string }[] });
    const todayStartIso = new Date(`${todayYmdForLeave}T00:00:00+07:00`).toISOString();
    const todayEndIso = new Date(`${todayYmdForLeave}T23:59:59+07:00`).toISOString();
    const shiftAssignmentReq =
      uid != null && uid !== ''
        ? supabase
            .from('work_schedule_assignments')
            .select('work_date, shift_id, allowed_branch_id')
            .eq('user_id', uid)
            .eq('work_date', todayYmdForLeave)
            .maybeSingle()
        : Promise.resolve({ data: null as TodayShiftAssignmentRow | null });
    const legacyScheduleReq =
      uid != null && uid !== ''
        ? supabase
            .from('work_schedules')
            .select('start_at, end_at, title')
            .eq('user_id', uid)
            .lte('start_at', todayEndIso)
            .gte('end_at', todayStartIso)
            .order('start_at', { ascending: true })
            .limit(1)
            .maybeSingle()
        : Promise.resolve({ data: null as TodayLegacyScheduleRow | null });
    const overtimeReq =
      uid != null && uid !== ''
        ? supabase
            .from('attendance_overtime_requests')
            .select('id,status,response_deadline_at,work_date')
            .eq('user_id', uid)
            .eq('work_date', todayYmdForLeave)
            .eq('status', 'pending')
            .maybeSingle()
        : Promise.resolve({ data: null as OvertimeRequestRow | null });
    const notifPrefsReq =
      uid != null && uid !== ''
        ? supabase
            .from('notification_preferences')
            .select('task_enabled,mention_enabled,checkout_enabled')
            .eq('user_id', uid)
            .maybeSingle()
        : Promise.resolve({
            data: {
              task_enabled: true,
              mention_enabled: true,
              checkout_enabled: true,
            },
          });

    const [
      { data: b },
      { data: l },
      { data: taskRows },
      { data: annRow },
      { data: breakStartRow },
      { data: breakEndRow },
      { data: leaveTodayRows },
      { data: shiftAssignmentRow },
      { data: legacyScheduleRow },
      { data: overtimeRow },
      { data: notifPrefRow },
    ] = await Promise.all([
      supabase.from('branch_information').select('*').order('branch_name'),
      logsReq,
      tasksReq,
      supabase
        .from('app_settings')
        .select('value')
        .eq('key', 'announcement_slides')
        .maybeSingle(),
      supabase
        .from('app_settings')
        .select('value')
        .eq('key', 'attendance_break_start_messages')
        .maybeSingle(),
      supabase
        .from('app_settings')
        .select('value')
        .eq('key', 'attendance_break_end_messages')
        .maybeSingle(),
      approvedLeaveTodayReq,
      shiftAssignmentReq,
      legacyScheduleReq,
      overtimeReq,
      notifPrefsReq,
    ]);

    setBranches(mapBranchInformationRows((b as Record<string, unknown>[]) ?? []));
    setLogs((l as AttendanceLog[]) ?? []);
    const taskRaw = (taskRows as OpenTaskRow[]) ?? [];
    setPendingTasks(
      sortByPriorityThenCreated(taskRaw).map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        priority: t.priority,
      }))
    );
    const annParsed = parseAnnouncementSettings(annRow?.value);
    setAnnouncementUrls(annParsed.urls);
    setAnnouncementSlides(annParsed.slides);
    setAnnouncementSlideHeightPx(annParsed.slideHeightPx);
    setBreakStartMessages(
      parseSettingsMessages(breakStartRow?.value, BREAK_START_MESSAGES_DEFAULT)
    );
    setBreakEndMessages(
      parseSettingsMessages(breakEndRow?.value, BREAK_END_MESSAGES_DEFAULT)
    );

    setOnApprovedLeaveToday(((leaveTodayRows ?? []) as { id: string }[]).length > 0);
    setPendingOvertimeRequest((overtimeRow as OvertimeRequestRow | null) ?? null);
    setNotifPrefs({
      task_enabled: (notifPrefRow as { task_enabled?: boolean } | null)?.task_enabled ?? true,
      mention_enabled:
        (notifPrefRow as { mention_enabled?: boolean } | null)?.mention_enabled ?? true,
      checkout_enabled:
        (notifPrefRow as { checkout_enabled?: boolean } | null)?.checkout_enabled ?? true,
    });

    const shiftRow = (shiftAssignmentRow as TodayShiftAssignmentRow | null) ?? null;
    const shiftData = shiftRow?.shift_id
      ? await supabase
          .from('work_shifts')
          .select('name,start_time,end_time')
          .eq('id', shiftRow.shift_id)
          .maybeSingle()
      : { data: null };
    const allowedBranchName =
      shiftRow?.allowed_branch_id != null
        ? mapBranchInformationRows((b as Record<string, unknown>[]) ?? []).find(
            (x) => x.id === shiftRow.allowed_branch_id
          )?.branch_name ?? null
        : null;
    const shiftInfo = (shiftData.data as { name: string; start_time: string; end_time: string } | null) ?? null;
    if (shiftInfo) {
      const startIso = buildBangkokIsoFromYmdTime(todayYmdForLeave, shiftInfo.start_time);
      let endIso = buildBangkokIsoFromYmdTime(todayYmdForLeave, shiftInfo.end_time);
      if (startIso && endIso && new Date(endIso).getTime() <= new Date(startIso).getTime()) {
        const nextDate = ymdToDate(todayYmdForLeave);
        nextDate.setDate(nextDate.getDate() + 1);
        endIso = buildBangkokIsoFromYmdTime(bangkokYmd(nextDate), shiftInfo.end_time);
      }
      if (startIso && endIso) {
        setTodayWorkPlan({
          source: 'shift',
          title: shiftInfo.name || 'กะงาน',
          startIso,
          endIso,
          startLabel: shiftInfo.start_time.slice(0, 5),
          endLabel: shiftInfo.end_time.slice(0, 5),
          allowedBranchId: shiftRow?.allowed_branch_id ?? null,
          allowedBranchName,
        });
      } else {
        setTodayWorkPlan(null);
      }
      setTodayPlanLabel(
        `กะวันนี้: ${shiftInfo.name} (${shiftInfo.start_time.slice(0, 5)} - ${shiftInfo.end_time.slice(0, 5)})${
          allowedBranchName ? ` · สาขา ${allowedBranchName}` : ''
        }`
      );
    } else {
      const legacy = (legacyScheduleRow as TodayLegacyScheduleRow | null) ?? null;
      if (legacy) {
        const sText = new Date(legacy.start_at).toLocaleTimeString('th-TH', {
          hour: '2-digit',
          minute: '2-digit',
        });
        const eText = new Date(legacy.end_at).toLocaleTimeString('th-TH', {
          hour: '2-digit',
          minute: '2-digit',
        });
        setTodayWorkPlan({
          source: 'legacy',
          title: legacy.title || 'กะงาน',
          startIso: legacy.start_at,
          endIso: legacy.end_at,
          startLabel: sText,
          endLabel: eText,
        });
        setTodayPlanLabel(`ตารางวันนี้: ${legacy.title || 'กะงาน'} (${sText} - ${eText})`);
      } else {
        setTodayWorkPlan(null);
        setTodayPlanLabel(null);
      }
    }

    if (uid) {
      const em = await fetchLatestTodayEmojiByUserIds([uid]);
      setMyTodayEmoji(em[uid] ?? null);
    } else {
      setMyTodayEmoji(null);
    }
  }, [session?.user?.id]);

  const period = useMemo(
    () => buildPeriod26To25(summaryAnchorDate ?? new Date()),
    [summaryAnchorDate]
  );
  const compact = width < 420;
  const largeTouch = width >= 420 && width < 1024;
  const scheduleMonthPeriod = useMemo(() => {
    const base = scheduleCalendarAnchorDate ?? new Date();
    const { year, month } = ymdPartsInBangkok(base);
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    const firstThis = ymdFromParts(year, month, 1);
    const firstNext = ymdFromParts(nextYear, nextMonth, 1);
    const lastThis = bangkokYmd(new Date(`${firstNext}T12:00:00+07:00`));
    const d = ymdToDate(lastThis);
    d.setDate(d.getDate() - 1);
    return { startYmd: firstThis, endYmd: bangkokYmd(d) };
  }, [scheduleCalendarAnchorDate]);
  const scheduleRowsByYmd = useMemo(() => {
    const map = new Map<string, MyScheduleCalendarRow[]>();
    for (const row of scheduleCalendarRows) {
      const arr = map.get(row.ymd) ?? [];
      arr.push(row);
      map.set(row.ymd, arr);
    }
    return map;
  }, [scheduleCalendarRows]);
  const scheduleDaysCount = useMemo(
    () => new Set(scheduleCalendarRows.map((r) => r.ymd)).size,
    [scheduleCalendarRows]
  );
  const scheduleGridCells = useMemo(() => {
    const { startYmd, endYmd } = scheduleMonthPeriod;
    const first = ymdToDate(startYmd);
    const firstDowSun0 = first.getDay();
    const lead = (firstDowSun0 + 6) % 7; // Monday-first calendar
    const dates = listYmdRange(startYmd, endYmd);
    const cells: CalendarCell[] = [];
    for (let i = 0; i < lead; i += 1) cells.push({ ymd: null, rows: [], markerSource: null });
    for (const ymd of dates) {
      const rows = scheduleRowsByYmd.get(ymd) ?? [];
      const hasMemo = scheduleMemoYmdSet.has(ymd);
      const markerSource = rows.find((r) => r.source === 'shift')
        ? 'shift'
        : rows.length > 0
          ? 'legacy'
          : hasMemo
            ? 'memo'
            : null;
      cells.push({ ymd, rows, markerSource });
    }
    while (cells.length % 7 !== 0) cells.push({ ymd: null, rows: [], markerSource: null });
    return cells;
  }, [scheduleMonthPeriod, scheduleRowsByYmd, scheduleMemoYmdSet]);
  const todayYmdInBangkok = useMemo(() => bangkokYmd(new Date()), []);
  const selectedScheduleRows = useMemo(() => {
    if (!scheduleSelectedYmd) return scheduleCalendarRows;
    return scheduleRowsByYmd.get(scheduleSelectedYmd) ?? [];
  }, [scheduleCalendarRows, scheduleRowsByYmd, scheduleSelectedYmd]);

  async function loadScheduleDayMemo(ymd: string) {
    const uid = session?.user?.id;
    if (!uid) return;
    setScheduleDayLoading(true);
    try {
      const { data, error } = await supabase
        .from('attendance_calendar_notes')
        .select('note, checklist, updated_at')
        .eq('user_id', uid)
        .eq('work_date', ymd)
        .order('updated_at', { ascending: false })
        .limit(1);
      if (error) throw error;
      const row =
        ((data as Array<{ note?: string | null; checklist?: unknown }> | null)?.[0] ?? null);
      setScheduleDayNote(row?.note ?? '');
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
      setScheduleDayChecklist(list);
      setScheduleDayMemoCache((prev) => ({
        ...prev,
        [ymd]: {
          note: row?.note ?? '',
          checklist: list.map((it) => ({ ...it })),
        },
      }));
      const hasMemo = Boolean((row?.note ?? '').trim()) || list.length > 0;
      setScheduleMemoYmdSet((prev) => {
        const next = new Set(prev);
        if (hasMemo) next.add(ymd);
        else next.delete(ymd);
        return next;
      });
    } catch (e) {
      toast.error('โหลดโน้ตปฏิทินไม่สำเร็จ', e instanceof Error ? e.message : String(e));
      const cached = scheduleDayMemoCache[ymd];
      if (cached) {
        setScheduleDayNote(cached.note);
        setScheduleDayChecklist(cached.checklist.map((it) => ({ ...it })));
      } else {
        setScheduleDayNote('');
        setScheduleDayChecklist([]);
      }
    } finally {
      setScheduleDayLoading(false);
    }
  }

  function openScheduleDayDetail(ymd: string, rows: MyScheduleCalendarRow[]) {
    setScheduleSelectedYmd(ymd);
    setScheduleDayDetailRows(rows);
    setScheduleDayDetailOpen(true);
    const cached = scheduleDayMemoCache[ymd];
    if (cached) {
      setScheduleDayNote(cached.note);
      setScheduleDayChecklist(cached.checklist.map((it) => ({ ...it })));
    } else {
      setScheduleDayNote('');
      setScheduleDayChecklist([]);
    }
    void loadScheduleDayMemo(ymd);
  }

  async function saveScheduleDayMemo() {
    const uid = session?.user?.id;
    if (!uid || !scheduleSelectedYmd) return;
    const optimisticNote = scheduleDayNote.trim();
    const optimisticChecklist = scheduleDayChecklist
      .map((it) => ({
        id: it.id,
        label: it.label.trim(),
        done: it.done,
      }))
      .filter((it) => it.label.length > 0);
    setScheduleDayMemoCache((prev) => ({
      ...prev,
      [scheduleSelectedYmd]: {
        note: optimisticNote,
        checklist: optimisticChecklist.map((it) => ({ ...it })),
      },
    }));
    setScheduleDayNote(optimisticNote);
    setScheduleDayChecklist(optimisticChecklist.map((it) => ({ ...it })));
    const hasOptimisticMemo = Boolean(optimisticNote) || optimisticChecklist.length > 0;
    setScheduleMemoYmdSet((prev) => {
      const next = new Set(prev);
      if (hasOptimisticMemo) next.add(scheduleSelectedYmd);
      else next.delete(scheduleSelectedYmd);
      return next;
    });
    setScheduleDaySaving(true);
    const checklistPayload = optimisticChecklist;
    const { error } = await supabase
      .from('attendance_calendar_notes')
      .upsert(
        {
          user_id: uid,
          work_date: scheduleSelectedYmd,
          note: optimisticNote || null,
          checklist: checklistPayload,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,work_date' }
      )
      .select('note, checklist, work_date')
      .single();
    setScheduleDaySaving(false);
    if (error) {
      toast.error('บันทึกข้อมูลไม่สำเร็จ', error.message);
      return;
    }
    toast.success('บันทึกแล้ว', 'อัปเดตโน้ต/เช็กลิสต์ของวันนี้เรียบร้อย');
    await loadScheduleDayMemo(scheduleSelectedYmd);
  }

  const loadSummary = useCallback(async () => {
    const uid = session?.user?.id;
    if (!uid) {
      setSummaryLogs([]);
      setSummaryLeaves([]);
      setSummaryLateRequests([]);
      setSummaryAssignments([]);
      setSummaryLegacySchedules([]);
      return;
    }
    setSummaryLoading(true);
    try {
      const startIso = new Date(`${period.startYmd}T00:00:00+07:00`).toISOString();
      const endIso = new Date(`${period.endYmd}T23:59:59+07:00`).toISOString();
      const [
        { data: logsRows },
        { data: leaveRows },
        { data: lateRows },
        { data: assignmentRows },
        { data: legacyRows },
      ] = await Promise.all([
        supabase
          .from('attendance_logs')
          .select('*')
          .eq('user_id', uid)
          .gte('created_at', startIso)
          .lte('created_at', endIso)
          .in('kind', ['check_in', 'check_out'])
          .order('created_at', { ascending: true }),
        supabase
          .from('leave_requests')
          .select('starts_on,ends_on,leave_type,status')
          .eq('user_id', uid)
          .in('status', ['pending', 'approved'])
          .lte('starts_on', period.endYmd)
          .gte('ends_on', period.startYmd),
        supabase
          .from('late_requests')
          .select('work_date,minutes_late')
          .eq('user_id', uid)
          .gte('work_date', period.startYmd)
          .lte('work_date', period.endYmd),
        supabase
          .from('work_schedule_assignments')
          .select('id, work_date, work_shifts(name, start_time, end_time)')
          .eq('user_id', uid)
          .gte('work_date', period.startYmd)
          .lte('work_date', period.endYmd),
        supabase
          .from('work_schedules')
          .select('id, user_id, start_at, end_at, title')
          .eq('user_id', uid)
          .lte('start_at', endIso)
          .gte('end_at', startIso),
      ]);
      const assignments: AssignmentWithShiftTimes[] = [];
      for (const row of (assignmentRows as unknown[]) ?? []) {
        const r = row as {
          id?: string;
          work_date?: string;
          work_shifts?: unknown;
        };
        let workShift = r.work_shifts as AssignmentWithShiftTimes['work_shifts'] | null;
        if (Array.isArray(r.work_shifts)) {
          workShift = (r.work_shifts[0] as AssignmentWithShiftTimes['work_shifts']) ?? null;
        }
        if (!r.id || !r.work_date) continue;
        assignments.push({
          id: String(r.id),
          work_date: String(r.work_date),
          work_shifts: workShift,
        });
      }
      setSummaryLogs((logsRows as AttendanceLog[]) ?? []);
      setSummaryLeaves((leaveRows as SummaryLeaveRow[]) ?? []);
      setSummaryLateRequests((lateRows as SummaryLateRequestRow[]) ?? []);
      setSummaryAssignments(assignments);
      setSummaryLegacySchedules((legacyRows as WorkScheduleRow[]) ?? []);
    } finally {
      setSummaryLoading(false);
    }
  }, [period.endYmd, period.startYmd, session?.user?.id]);

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
    void Promise.all([load(), loadSummary()]);
  }, [load, loadSummary]);

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
    void loadSummary();
  }, [loadSummary]);

  useFocusEffect(
    useCallback(() => {
      // กลับเข้าหน้านี้แล้วรีโหลดทันที เพื่อให้สถานะลา/เวลาเข้าออกอัปเดตจากการอนุมัติล่าสุด
      scheduleReload();
    }, [scheduleReload])
  );

  useEffect(() => {
    const off = onLeaveStatusChanged(() => {
      // optimistic cross-tab refresh: หน้าอื่นยิง signal มาแล้วรีโหลดทันที
      scheduleReload();
    });
    return off;
  }, [scheduleReload]);

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
      .channel(`attendance_live_${session?.user?.id ?? 'guest'}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'attendance_logs' },
        scheduleReload
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tasks' },
        scheduleReload
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'app_settings' },
        scheduleReload
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'leave_requests' },
        scheduleReload
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'late_requests' },
        scheduleReload
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'work_schedule_assignments' },
        scheduleReload
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'work_shifts' },
        scheduleReload
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'work_schedules' },
        scheduleReload
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'attendance_overtime_requests' },
        scheduleReload
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [scheduleReload, session?.user?.id]);

  useEffect(() => {
    const id = setInterval(() => setNowTick(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    await loadSummary();
    setRefreshing(false);
  }

  const summaryRows = useMemo<AttendanceSummaryRow[]>(() => {
    const employeeCode = profile?.employee_code?.trim() || '-';
    const leaveNotesByYmd = new Map<string, string[]>();
    for (const row of summaryLeaves) {
      for (const ymd of listYmdRange(row.starts_on, row.ends_on)) {
        const arr = leaveNotesByYmd.get(ymd) ?? [];
        arr.push(`${leaveTypeLabelTh(row.leave_type)}${leaveStatusSuffixTh(row.status)}`);
        leaveNotesByYmd.set(ymd, arr);
      }
    }
    const byYmd = new Map<string, { checkIn?: AttendanceLog; checkOut?: AttendanceLog }>();
    for (const lg of summaryLogs) {
      const ymd = bangkokYmd(new Date(lg.created_at));
      const entry = byYmd.get(ymd) ?? {};
      if (lg.kind === 'check_in' && !entry.checkIn) entry.checkIn = lg;
      if (lg.kind === 'check_out') entry.checkOut = lg;
      byYmd.set(ymd, entry);
    }
    const lateRequestMinutesByYmd = lateRequestMinutesByWorkDate(summaryLateRequests);
    const lateRows = computeLateFromAttendanceData({
      startYmd: period.startYmd,
      endYmd: period.endYmd,
      assignments: summaryAssignments,
      legacySchedules: summaryLegacySchedules,
      checkIns: summaryLogs
        .filter((lg) => lg.kind === 'check_in')
        .map((lg) => ({ created_at: lg.created_at })),
      lateRequestMinutesByYmd,
    });
    const netLateByYmd = new Map(lateRows.map((row) => [row.work_date, row]));
    return listYmdRange(period.startYmd, period.endYmd).map((ymd) => {
      const day = byYmd.get(ymd);
      const leaveNotes = leaveNotesByYmd.get(ymd) ?? [];
      const requestedLateMinutes = lateRequestMinutesByYmd.get(ymd) ?? 0;
      const netLate = netLateByYmd.get(ymd);
      const noteParts = [...leaveNotes];
      if (requestedLateMinutes > 0 && netLate) {
        noteParts.push(
          `ใช้สิทธิ์ขอเข้าสาย ${requestedLateMinutes} นาที · สายสุทธิ ${netLate.minutes_late} นาที`
        );
      } else if (requestedLateMinutes > 0) {
        noteParts.push(`ใช้สิทธิ์ขอเข้าสาย ${requestedLateMinutes} นาที`);
      } else if (netLate) {
        noteParts.push(`สาย ${netLate.minutes_late} นาที`);
      }
      const note = noteParts.join(' / ');
      if (leaveNotes.length > 0) {
        return {
          dateYmd: ymd,
          checkIn: 'ลา',
          checkOut: 'ลา',
          checkInIso: undefined,
          checkOutIso: undefined,
          employeeCode,
          checkInLocation: 'ลา',
          note,
        };
      }
      const checkInAt = day?.checkIn?.created_at
        ? new Date(day.checkIn.created_at).toLocaleTimeString('th-TH', {
            hour: '2-digit',
            minute: '2-digit',
          })
        : '';
      const checkOutAt = day?.checkOut?.created_at
        ? new Date(day.checkOut.created_at).toLocaleTimeString('th-TH', {
            hour: '2-digit',
            minute: '2-digit',
          })
        : '';
      const location = day?.checkIn
        ? day.checkIn.note?.trim() ||
          (day.checkIn.branch_id != null
            ? branches.find((b) => b.id === day.checkIn?.branch_id)?.branch_name ??
              String(day.checkIn.branch_id)
            : '')
        : '';
      return {
        dateYmd: ymd,
        checkIn: checkInAt,
        checkOut: checkOutAt,
        checkInIso: day?.checkIn?.created_at,
        checkOutIso: day?.checkOut?.created_at,
        employeeCode,
        checkInLocation: location ?? '',
        note,
      };
    });
  }, [
    branches,
    period.endYmd,
    period.startYmd,
    profile?.employee_code,
    summaryAssignments,
    summaryLateRequests,
    summaryLeaves,
    summaryLegacySchedules,
    summaryLogs,
  ]);

  const exportCsv = useCallback(async () => {
    if (summaryRows.length === 0) return;
    setExporting(true);
    try {
      const header = [
        'วันที่',
        'เวลาเข้างาน',
        'เวลาออกงาน',
        'รหัสพนักงาน',
        'สถานที่เข้างาน',
        'หมายเหตุ',
      ];
      const lines = [header.map(csvEscape).join(',')];
      for (const row of summaryRows) {
        const checkInCell = row.checkInIso
          ? formatBangkokDateTimeForCsv(row.checkInIso)
          : row.checkIn || '';
        const checkOutCell = row.checkOutIso
          ? formatBangkokDateTimeForCsv(row.checkOutIso)
          : row.checkOut || '';
        lines.push(
          [
            row.dateYmd,
            checkInCell,
            checkOutCell,
            row.employeeCode,
            row.checkInLocation,
            row.note,
          ]
            .map((v) => csvEscape(v || ''))
            .join(',')
        );
      }
      const content = `\uFEFF${lines.join('\n')}`;
      const filename = `attendance-summary-${period.startYmd}-${period.endYmd}.csv`;
      if (Platform.OS === 'web') {
        const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        return;
      }
      const uri = `${FileSystem.cacheDirectory}${filename}`;
      await FileSystem.writeAsStringAsync(uri, content, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: 'text/csv',
          dialogTitle: 'ดาวน์โหลดตารางสรุปเวลาเข้า-ออกงาน',
        });
      }
    } finally {
      setExporting(false);
    }
  }, [period.endYmd, period.startYmd, summaryRows]);

  const exportPdf = useCallback(async () => {
    if (summaryRows.length === 0) return;
    setExporting(true);
    try {
      const rowsHtml = summaryRows
        .map(
          (row) => `
          <tr>
            <td>${htmlEscape(row.dateYmd)}</td>
            <td>${htmlEscape(row.checkIn || '')}</td>
            <td>${htmlEscape(row.checkOut || '')}</td>
            <td>${htmlEscape(row.employeeCode || '')}</td>
            <td>${htmlEscape(row.checkInLocation || '')}</td>
            <td>${htmlEscape(row.note || '')}</td>
          </tr>`
        )
        .join('');
      const html = `<!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8" />
        <style>
          body { font-family: Arial, sans-serif; padding: 16px; color: #203028; }
          h1 { font-size: 18px; margin: 0 0 6px; }
          p { font-size: 12px; margin: 0 0 14px; color: #4b5f54; }
          table { width: 100%; border-collapse: collapse; font-size: 11px; }
          th, td { border: 1px solid #cedbcf; padding: 6px; text-align: left; vertical-align: top; }
          th { background: #e7f2e8; }
        </style>
      </head>
      <body>
        <h1>ตารางสรุปเวลาเข้า-ออกงาน</h1>
        <p>รอบวันที่ ${htmlEscape(period.startYmd)} ถึง ${htmlEscape(period.endYmd)}</p>
        <table>
          <thead>
            <tr>
              <th>วันที่</th>
              <th>เวลาเข้างาน</th>
              <th>เวลาออกงาน</th>
              <th>รหัสพนักงาน</th>
              <th>สถานที่เข้างาน</th>
              <th>หมายเหตุ</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </body>
      </html>`;
      if (Platform.OS === 'web') {
        const w = window.open('', '_blank');
        if (!w) return;
        w.document.write(html);
        w.document.close();
        w.focus();
        w.print();
        return;
      }
      const pdf = await Print.printToFileAsync({ html });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(pdf.uri, {
          mimeType: 'application/pdf',
          dialogTitle: 'ดาวน์โหลดรายงานเวลาเข้า-ออกงาน (PDF)',
        });
      }
    } finally {
      setExporting(false);
    }
  }, [period.endYmd, period.startYmd, summaryRows]);

  async function startAttendance(kind: 'check_in' | 'check_out') {
    if (!session?.user?.id) return;
    const today = bangkokYmd(new Date());
    const logsToday = logs.filter(
      (l) => bangkokYmd(new Date(l.created_at)) === today
    );
    const alreadyIn = logsToday.some((l) => l.kind === 'check_in');
    const alreadyOut = logsToday.some((l) => l.kind === 'check_out');
    const last = logsToday[0];
    if (kind === 'check_in' && onApprovedLeaveToday) {
      toast.info(
        'วันนี้มีการลา',
        'คุณได้รับการอนุมัติลาในวันนี้ — ไม่บันทึกเวลาเข้า-ออกในวันลา'
      );
      return;
    }
    if (kind === 'check_out' && onApprovedLeaveToday) {
      toast.info(
        'วันนี้มีการลา',
        'คุณได้รับการอนุมัติลาในวันนี้ — ไม่บันทึกเวลาเข้า-ออกในวันลา'
      );
      return;
    }
    if (kind === 'check_in' && alreadyIn) {
      toast.info('เข้างานแล้ว', 'วันนี้บันทึกเข้างานแล้ว ไม่ต้องกดซ้ำ');
      return;
    }
    if (kind === 'check_out' && alreadyOut) {
      toast.info('ออกงานแล้ว', 'วันนี้บันทึกออกงานแล้ว ไม่ต้องกดซ้ำ');
      return;
    }
    if (kind === 'check_out' && !alreadyIn) {
      toast.info('ยังไม่ได้เข้างาน', 'กรุณาบันทึกเข้างานก่อน');
      return;
    }
    if (kind === 'check_out' && last?.kind === 'break_start') {
      toast.info('กำลังพักอยู่', 'กดเริ่มงานก่อน แล้วค่อยบันทึกออกงาน');
      return;
    }
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      toast.info('ตำแหน่ง', 'กรุณาอนุญาตให้แอปใช้ตำแหน่ง');
      return;
    }
    setActing(true);
    try {
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;

      const matches: BranchMatch[] = [];
      for (const br of branches) {
        if (br.latitude == null || br.longitude == null) continue;
        const radius = br.radius_meters ?? 150;
        const d = distanceMeters(lat, lon, br.latitude, br.longitude);
        if (d <= radius) {
          matches.push({ br, distanceM: d });
        }
      }
      matches.sort((a, b) => a.distanceM - b.distanceM);

      if (kind === 'check_out') {
        let branchId: number | null = null;
        let within = false;
        let branchName = '';
        if (matches.length > 0) {
          const best = matches[0];
          branchId = best.br.id;
          within = true;
          branchName =
            best.br.branch_name ?? best.br.branch_code ?? String(best.br.id);
        } else {
          toast.info(
            'นอกพื้นที่สาขา',
            'ไม่พบตำแหน่งภายในรัศมีสาขาที่ตั้งไว้ ระบบจะบันทึกว่าอยู่นอกพื้นที่'
          );
        }
        const geo: GeoBranch = {
          lat,
          lon,
          branchId,
          within,
          branchName,
          note: null,
        };
        await saveCheckOutAndConfirm(geo);
        return;
      }

      // check_in
      if (matches.length === 0) {
        setOffSiteLatLon({ lat, lon });
        setOffSiteLocation('');
        setOffSiteRemark('');
        setOffSiteOpen(true);
        return;
      }
      if (matches.length >= 2) {
        setBranchPickLatLon({ lat, lon });
        setBranchPickMatches(matches);
        setBranchPickOpen(true);
        return;
      }

      const only = matches[0];
      const geo: GeoBranch = {
        lat,
        lon,
        branchId: only.br.id,
        within: true,
        branchName:
          only.br.branch_name ?? only.br.branch_code ?? String(only.br.id),
        note: null,
      };
      setPendingCheckIn(geo);
      setMoodOpen(true);
    } catch (e) {
      toast.error('ผิดพลาด', e instanceof Error ? e.message : 'ไม่ทราบสาเหตุ');
    } finally {
      setActing(false);
    }
  }

  function cancelMoodFlow() {
    if (moodSaving) return;
    setMoodOpen(false);
    setPendingCheckIn(null);
  }

  function cancelBranchPick() {
    setBranchPickOpen(false);
    setBranchPickMatches([]);
    setBranchPickLatLon(null);
  }

  function cancelOffSite() {
    setOffSiteOpen(false);
    setOffSiteLatLon(null);
    setOffSiteLocation('');
    setOffSiteRemark('');
  }

  function selectBranchForCheckIn(entry: BranchMatch) {
    if (!branchPickLatLon) return;
    const { br } = entry;
    const geo: GeoBranch = {
      lat: branchPickLatLon.lat,
      lon: branchPickLatLon.lon,
      branchId: br.id,
      within: true,
      branchName: br.branch_name ?? br.branch_code ?? String(br.id),
      note: null,
    };
    cancelBranchPick();
    setPendingCheckIn(geo);
    setMoodOpen(true);
  }

  function confirmOffSiteCheckIn() {
    const loc = offSiteLocation.trim();
    if (!loc) {
      toast.info(
        'กรุณาระบุตำแหน่ง',
        'ระบุสถานที่หรือลักษณะการเข้างาน เช่น บ้าน / ไซต์ลูกค้า'
      );
      return;
    }
    const remark = offSiteRemark.trim();
    const note = remark ? `${loc} · ${remark}` : loc;
    if (!offSiteLatLon) return;
    const geo: GeoBranch = {
      lat: offSiteLatLon.lat,
      lon: offSiteLatLon.lon,
      branchId: null,
      within: false,
      branchName: 'นอกรัศมีสาขา',
      note,
    };
    cancelOffSite();
    setPendingCheckIn(geo);
    setMoodOpen(true);
  }

  async function saveCheckOutAndConfirm(p: GeoBranch) {
    if (!session?.user?.id) return;
    if (onApprovedLeaveToday) {
      toast.info(
        'วันนี้มีการลา',
        'วันนี้เป็นวันลาที่อนุมัติแล้ว — ไม่บันทึกออกงาน'
      );
      return;
    }
    setCheckoutBusy(true);
    try {
      const { error: e1 } = await supabase.from('attendance_logs').insert({
        user_id: session.user.id,
        branch_id: p.branchId,
        kind: 'check_out',
        latitude: p.lat,
        longitude: p.lon,
        within_branch: p.within,
        note: p.note,
      });
      if (e1) throw e1;

      const body = `${profile?.full_name ?? 'พนักงาน'} แจ้งออกงาน${
        p.branchName ? ` · ${p.branchName}` : ''
      }${p.note ? ` · ${p.note}` : ''}`;

      const { error: e2 } = await supabase
        .from('attendance_chat_messages')
        .insert({ user_id: session.user.id, body });
      if (e2) throw e2;

      if (todayWorkPlan) {
        const nowMs = Date.now();
        const planEndMs = new Date(todayWorkPlan.endIso).getTime();
        if (Number.isFinite(planEndMs) && nowMs < planEndMs) {
          toast.info(
            'ออกงานก่อนเวลา',
            `เวลาตารางคือ ${todayWorkPlan.endLabel} น. แต่มีการออกงานก่อนกำหนด`
          );
        }
      }

      setCheckoutDoneOpen(true);
      void Promise.all([load(), loadSummary()]);
    } catch (e) {
      toast.error('ผิดพลาด', e instanceof Error ? e.message : 'ไม่ทราบสาเหตุ');
    } finally {
      setCheckoutBusy(false);
    }
  }

  async function completeAttendanceWithMood(opt: WellbeingMoodOption) {
    if (!session?.user?.id || !pendingCheckIn) return;
    if (onApprovedLeaveToday) {
      toast.info(
        'วันนี้มีการลา',
        'วันนี้เป็นวันลาที่อนุมัติแล้ว — ไม่บันทึกเวลาเข้า-ออกหรือพักเบรก'
      );
      setMoodOpen(false);
      setPendingCheckIn(null);
      return;
    }
    const p = pendingCheckIn;
    setMoodSaving(true);
    try {
      const { error: e1 } = await supabase.from('attendance_logs').insert({
        user_id: session.user.id,
        branch_id: p.branchId,
        kind: 'check_in',
        latitude: p.lat,
        longitude: p.lon,
        within_branch: p.within,
        note: p.note,
      });
      if (e1) throw e1;

      const body = `${profile?.full_name ?? 'พนักงาน'} แจ้งเข้างาน${
        p.branchName ? ` · ${p.branchName}` : ''
      }${p.note ? ` · ${p.note}` : ''}`;

      const { error: e2 } = await supabase
        .from('attendance_chat_messages')
        .insert({ user_id: session.user.id, body });
      if (e2) throw e2;

      const { error: e3 } = await supabase.from('wellbeing_checkins').insert({
        user_id: session.user.id,
        mood_key: opt.key,
        score: opt.score,
        emoji: opt.emoji,
        label: opt.label,
        attendance_kind: 'check_in',
      });
      if (e3) throw e3;

      if (todayWorkPlan?.allowedBranchId != null) {
        const matched = p.branchId === todayWorkPlan.allowedBranchId;
        if (!matched) {
          setBreakNotice({
            title: 'เข้างานไม่ตรงสาขาตามตาราง',
            message: `ตารางวันนี้กำหนดสาขา ${
              todayWorkPlan.allowedBranchName || String(todayWorkPlan.allowedBranchId)
            } แต่คุณเช็กอินที่ ${p.branchName || 'ตำแหน่งอื่น'}`,
            variant: 'info',
          });
        }
      }

      if (todayWorkPlan) {
        const nowMs = Date.now();
        const planStartMs = new Date(todayWorkPlan.startIso).getTime();
        if (Number.isFinite(planStartMs) && nowMs > planStartMs) {
          const lateMin = Math.floor((nowMs - planStartMs) / 60000);
          if (lateMin >= 1) {
            toast.info(
              'เข้างานสาย',
              `ช้ากว่าตารางประมาณ ${lateMin} นาที (เวลาเริ่ม ${todayWorkPlan.startLabel} น.)`
            );
          }
        }
      }

      const postRaw = await fetchOpenTasksForAttendance(session.user.id);
      setPostCheckInTasks(
        sortByPriorityThenCreated(postRaw).map((t) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          priority: t.priority,
        }))
      );
      setMoodOpen(false);
      setPendingCheckIn(null);
      setMyTodayEmoji(opt.emoji);
      setPostCheckInOpen(true);
      void Promise.all([load(), loadSummary()]);
    } catch (e) {
      toast.error('ผิดพลาด', e instanceof Error ? e.message : 'ไม่ทราบสาเหตุ');
    } finally {
      setMoodSaving(false);
    }
  }

  async function markBreak(kind: 'break_start' | 'break_end') {
    if (!session?.user?.id) return;
    if (onApprovedLeaveToday) {
      toast.info(
        'วันนี้มีการลา',
        'วันนี้เป็นวันลาที่อนุมัติแล้ว — ไม่บันทึกพักเบรก'
      );
      return;
    }
    setActing(true);
    try {
      let lastBreakMinutes = 0;
      if (kind === 'break_end') {
        const today = bangkokYmd(new Date());
        const logsToday = logs
          .filter((l) => bangkokYmd(new Date(l.created_at)) === today)
          .slice()
          .sort(
            (a, b) =>
              new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          );
        const latestBreakStart = [...logsToday]
          .reverse()
          .find((l) => l.kind === 'break_start');
        if (latestBreakStart) {
          lastBreakMinutes = Math.floor(
            Math.max(0, Date.now() - new Date(latestBreakStart.created_at).getTime()) /
              60000
          );
        }
      }
      const { error } = await supabase.from('attendance_logs').insert({
        user_id: session.user.id,
        kind,
        within_branch: true,
      });
      if (error) throw error;
      await load();
      const msg =
        kind === 'break_start'
          ? pickRandomMessage(breakStartMessages)
          : pickRandomMessage(breakEndMessages);
      const finalMsg =
        kind === 'break_end'
          ? `คุณพักไป ${lastBreakMinutes} นาที\n${msg}`
          : msg;
      setBreakNotice({
        title: kind === 'break_start' ? 'พักเบรกแล้วนะ 🌿' : 'กลับมาลุยกันต่อ ✨',
        message: finalMsg || (kind === 'break_start' ? 'พักผ่อนให้เต็มที่นะ' : 'พร้อมลุยงานต่อแล้ว'),
        variant: kind === 'break_start' ? 'info' : 'status',
      });
    } catch (e) {
      toast.error('ผิดพลาด', e instanceof Error ? e.message : 'ไม่ทราบสาเหตุ');
    } finally {
      setActing(false);
    }
  }

  const pendingCount = pendingTasks.length;
  const activeTaskCount = pendingTasks.filter((t) => t.status === 'in_progress').length;
  const waitingTaskCount = pendingTasks.filter((t) => t.status === 'pending').length;
  const workStatusPreviewTasks = pendingTasks.slice(0, 4);
  const greetName =
    profile?.full_name || profile?.email || session?.user?.email || 'พนักงาน';
  const greetWithMood = nameWithMoodEmoji(greetName, myTodayEmoji);
  const today = bangkokYmd(nowTick);
  const todayLogs = logs
    .filter((l) => bangkokYmd(new Date(l.created_at)) === today)
    .slice()
    .sort(
      (a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
  const hasTodayCheckIn = todayLogs.some((l) => l.kind === 'check_in');
  const hasTodayCheckOut = todayLogs.some((l) => l.kind === 'check_out');
  const lastTodayLog = todayLogs[todayLogs.length - 1] ?? null;
  const onBreak = lastTodayLog?.kind === 'break_start';
  const canBreak = hasTodayCheckIn && !hasTodayCheckOut && !onBreak;
  const canResume = hasTodayCheckIn && !hasTodayCheckOut && onBreak;

  const workStart = todayLogs.find((l) => l.kind === 'check_in');
  const workEnd = todayLogs.find((l) => l.kind === 'check_out');
  const rangeEnd = workEnd
    ? new Date(workEnd.created_at).getTime()
    : onBreak && lastTodayLog
      ? new Date(lastTodayLog.created_at).getTime()
      : nowTick.getTime();

  let breakOpenAt: number | null = null;
  let totalBreakMs = 0;
  for (const lg of todayLogs) {
    const ts = new Date(lg.created_at).getTime();
    if (lg.kind === 'break_start' && breakOpenAt == null) {
      breakOpenAt = ts;
      continue;
    }
    if (lg.kind === 'break_end' && breakOpenAt != null) {
      totalBreakMs += Math.max(0, ts - breakOpenAt);
      breakOpenAt = null;
    }
  }
  const activeBreakMs =
    onBreak && breakOpenAt != null ? Math.max(0, nowTick.getTime() - breakOpenAt) : 0;
  const totalBreakTodayMs = totalBreakMs + activeBreakMs;
  const workedTodayMs = workStart
    ? Math.max(
        0,
        rangeEnd - new Date(workStart.created_at).getTime() - totalBreakMs
      )
    : 0;
  const latestBreakMinutes = Math.floor(activeBreakMs / 60000);

  const buttonsLocked =
    acting ||
    moodOpen ||
    moodSaving ||
    checkoutBusy ||
    branchPickOpen ||
    offSiteOpen;
  const checkInDisabled =
    buttonsLocked || hasTodayCheckIn || onApprovedLeaveToday;
  const checkOutDisabled =
    buttonsLocked ||
    hasTodayCheckOut ||
    !hasTodayCheckIn ||
    onBreak ||
    onApprovedLeaveToday;
  const breakStartDisabled =
    buttonsLocked || !canBreak || onApprovedLeaveToday;
  const breakEndDisabled =
    buttonsLocked || !canResume || onApprovedLeaveToday;
  const lateDisabled =
    buttonsLocked || onApprovedLeaveToday || hasTodayCheckIn;

  useEffect(() => {
    const todayKey = `${today}-${session?.user?.id ?? 'guest'}`;
    if (!hasTodayCheckIn || hasTodayCheckOut) {
      return;
    }
    if (!todayWorkPlan) return;
    const endAt = new Date(todayWorkPlan.endIso).getTime();
    const nowMs = nowTick.getTime();
    if (Number.isNaN(endAt)) return;

    if (
      notifPrefs.checkout_enabled &&
      nowMs >= endAt &&
      endReminderSentRef.current !== todayKey
    ) {
      endReminderSentRef.current = todayKey;
      toast.info('ถึงเวลาออกงานแล้ว', `ตามตารางวันนี้ ${todayWorkPlan.endLabel} น.`);
      void presentBackgroundAwareNotification(
        'ถึงเวลาออกงานแล้ว',
        `ตามตารางวันนี้ ${todayWorkPlan.endLabel} น. กรุณากดออกงาน`
      );
    }
  }, [
    hasTodayCheckIn,
    hasTodayCheckOut,
    nowTick,
    session?.user?.id,
    today,
    todayWorkPlan,
    notifPrefs.checkout_enabled,
    toast,
  ]);

  useEffect(() => {
    if (!pendingOvertimeRequest || !notifPrefs.checkout_enabled) return;
    void presentBackgroundAwareNotification(
      'เลยเวลาออกงาน 30 นาที',
      'โปรดยืนยันว่าต้องการทำงานล่วงเวลาหรือไม่'
    );
  }, [pendingOvertimeRequest?.id, notifPrefs.checkout_enabled]);

  const loadScheduleCalendar = useCallback(async () => {
    const uid = session?.user?.id;
    if (!uid) return;
    const { startYmd, endYmd } = scheduleMonthPeriod;
    setScheduleCalendarLoading(true);
    try {
      const [assignmentRes, legacyRes, memoRes] = await Promise.all([
        supabase
          .from('work_schedule_assignments')
          .select('work_date, shift_id, allowed_branch_id')
          .eq('user_id', uid)
          .gte('work_date', startYmd)
          .lte('work_date', endYmd)
          .order('work_date', { ascending: true }),
        supabase
          .from('work_schedules')
          .select('start_at, end_at, title')
          .eq('user_id', uid)
          .lte('start_at', new Date(`${endYmd}T23:59:59+07:00`).toISOString())
          .gte('end_at', new Date(`${startYmd}T00:00:00+07:00`).toISOString())
          .order('start_at', { ascending: true }),
        supabase
          .from('attendance_calendar_notes')
          .select('work_date, note, checklist')
          .eq('user_id', uid)
          .gte('work_date', startYmd)
          .lte('work_date', endYmd),
      ]);
      if (assignmentRes.error) {
        throw new Error(`โหลดมอบหมายกะไม่สำเร็จ: ${assignmentRes.error.message}`);
      }
      if (legacyRes.error) {
        throw new Error(`โหลดตารางงานแบบเดิมไม่สำเร็จ: ${legacyRes.error.message}`);
      }
      if (memoRes.error) {
        throw new Error(`โหลดโน้ตปฏิทินไม่สำเร็จ: ${memoRes.error.message}`);
      }

      const assignments = (assignmentRes.data ??
        []) as Array<{ work_date: string; shift_id: string; allowed_branch_id?: number | null }>;
      const branchNameById = new Map<number, string>();
      for (const br of branches) {
        branchNameById.set(br.id, br.branch_name || br.branch_code || `สาขา ${br.id}`);
      }
      const shiftIds = [...new Set(assignments.map((a) => a.shift_id).filter(Boolean))];
      let shiftById = new Map<string, { name: string; start_time: string; end_time: string }>();
      if (shiftIds.length > 0) {
        const shiftsRes = await supabase
          .from('work_shifts')
          .select('id,name,start_time,end_time')
          .in('id', shiftIds);
        if (shiftsRes.error) {
          throw new Error(`โหลดรายละเอียดกะไม่สำเร็จ: ${shiftsRes.error.message}`);
        }
        shiftById = new Map(
          (shiftsRes.data ?? []).map((s) => [
            (s as { id: string }).id,
            {
              name: (s as { name: string }).name,
              start_time: (s as { start_time: string }).start_time,
              end_time: (s as { end_time: string }).end_time,
            },
          ])
        );
      }

      const dailyShiftMap = new Map<string, MyScheduleCalendarRow>();
      for (const row of assignments) {
        const shift = shiftById.get(row.shift_id) ?? null;
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

      const legacyRows = ((legacyRes.data ?? []) as TodayLegacyScheduleRow[]).map((r) => ({
        startYmd: bangkokYmd(new Date(r.start_at)),
        endYmd: bangkokYmd(new Date(r.end_at)),
        title: r.title || 'กะงาน',
        startText: new Date(r.start_at).toLocaleTimeString('th-TH', {
          hour: '2-digit',
          minute: '2-digit',
        }),
        endText: new Date(r.end_at).toLocaleTimeString('th-TH', {
          hour: '2-digit',
          minute: '2-digit',
        }),
      }));
      const memoRows = (memoRes.data ??
        []) as Array<{ work_date: string; note?: string | null; checklist?: unknown }>;
      const nextMemoYmd = new Set<string>();
      for (const row of memoRows) {
        const checklistLen = Array.isArray(row.checklist) ? row.checklist.length : 0;
        if ((row.note ?? '').trim() || checklistLen > 0) {
          nextMemoYmd.add(row.work_date);
        }
      }
      setScheduleMemoYmdSet(nextMemoYmd);

      const out: MyScheduleCalendarRow[] = [];
      for (const ymd of listYmdRange(startYmd, endYmd)) {
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
      setScheduleCalendarRows(out);
      if (out.length === 0) {
        toast.info(
          'ไม่พบตารางในเดือนนี้',
          'ตรวจสอบว่าบัญชีนี้ถูกมอบหมายกะ/ตารางงานในเดือนที่เลือกแล้ว'
        );
      }
    } catch (e) {
      toast.error('โหลดปฏิทินไม่สำเร็จ', e instanceof Error ? e.message : String(e));
    } finally {
      setScheduleCalendarLoading(false);
    }
  }, [branches, scheduleMonthPeriod, session?.user?.id, toast]);

  useEffect(() => {
    if (!scheduleCalendarOpen) return;
    void loadScheduleCalendar();
  }, [loadScheduleCalendar, scheduleCalendarOpen]);

  useEffect(() => {
    if (!scheduleCalendarOpen) return;
    const channel = supabase
      .channel(`schedule_calendar_live_${session?.user?.id ?? 'guest'}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'work_schedule_assignments' },
        () => void loadScheduleCalendar()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'work_shifts' },
        () => void loadScheduleCalendar()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'work_schedules' },
        () => void loadScheduleCalendar()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadScheduleCalendar, scheduleCalendarOpen, session?.user?.id]);

  useEffect(() => {
    if (!scheduleCalendarOpen) return;
    const { startYmd, endYmd } = scheduleMonthPeriod;
    const inCurrentMonth = scheduleSelectedYmd
      ? scheduleSelectedYmd >= startYmd && scheduleSelectedYmd <= endYmd
      : false;
    if (inCurrentMonth) return;
    const todayYmd = bangkokYmd(new Date());
    const fallbackYmd =
      todayYmd >= startYmd && todayYmd <= endYmd ? todayYmd : startYmd;
    setScheduleSelectedYmd(fallbackYmd);
  }, [scheduleCalendarOpen, scheduleMonthPeriod, scheduleSelectedYmd]);

  async function respondOvertime(accept: boolean) {
    if (!pendingOvertimeRequest?.id) return;
    setOtResponding(true);
    try {
      const { error } = await supabase.rpc('respond_overtime_request', {
        p_request_id: pendingOvertimeRequest.id,
        p_accept: accept,
      });
      if (error) throw error;
      if (accept) {
        toast.success('บันทึกแล้ว', 'ทำงานล่วงเวลาต่อได้จนกว่าจะกดออกงานเอง');
      } else {
        toast.info('บันทึกแล้ว', 'ระบบออกงานให้เรียบร้อย');
      }
      await Promise.all([load(), loadSummary()]);
    } catch (e) {
      toast.error('ยืนยัน OT ไม่สำเร็จ', e instanceof Error ? e.message : 'ไม่ทราบสาเหตุ');
    } finally {
      setOtResponding(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={NatureTheme.colors.primary} />
      </View>
    );
  }

  const uid = session?.user?.id ?? '';

  return (
    <View style={styles.screen}>
      {uid ? (
        <>
          <LeaveRequestModal
            visible={leaveModalOpen}
            onClose={() => setLeaveModalOpen(false)}
            userId={uid}
            quotaYear={currentYearBangkok()}
            onSubmitted={scheduleReload}
          />
          <LateRequestModal
            visible={lateModalOpen}
            onClose={() => setLateModalOpen(false)}
            userId={uid}
            applicantDisplayName={greetName}
            defaultWorkDateYmd={today}
            onSubmitted={scheduleReload}
          />
        </>
      ) : null}
      <Modal
        visible={branchPickOpen}
        transparent
        animationType="fade"
        onRequestClose={cancelBranchPick}>
        <Pressable style={[styles.sheetBackdrop, WEB_MODAL_BACKDROP]} onPress={cancelBranchPick}>
          <Pressable style={styles.sheetCardTall} onPress={() => {}}>
            <Text style={styles.sheetTitle}>เลือกสาขาที่เข้างาน</Text>
            <Text style={styles.sheetSub}>
              ตำแหน่งของคุณอยู่ในรัศมีหลายสาขา — กรุณาเลือกสาขาที่กำลังเข้างาน
            </Text>
            <ScrollView
              style={styles.branchPickScroll}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}>
              {branchPickMatches.map((m) => {
                const label =
                  m.br.branch_name ?? m.br.branch_code ?? String(m.br.id);
                return (
                  <Pressable
                    key={m.br.id}
                    style={({ pressed }) => [
                      styles.branchPickRow,
                      pressed && styles.branchPickRowPressed,
                    ]}
                    onPress={() => selectBranchForCheckIn(m)}>
                    <Text style={styles.branchPickName}>{label}</Text>
                    <Text style={styles.branchPickDist}>
                      ห่าง ~{Math.round(m.distanceM)} ม.
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <Pressable style={styles.sheetSecondaryBtn} onPress={cancelBranchPick}>
              <Text style={styles.sheetSecondaryBtnText}>ยกเลิก</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={offSiteOpen}
        transparent
        animationType="slide"
        onRequestClose={cancelOffSite}>
        <Pressable style={[styles.sheetBackdrop, WEB_MODAL_BACKDROP]} onPress={cancelOffSite}>
          <Pressable style={styles.sheetCardTall} onPress={() => {}}>
            <Text style={styles.sheetTitle}>เข้างานนอกรัศมีสาขา</Text>
            <Text style={styles.sheetSub}>
              ระบุตำแหน่งหรือสถานที่ทำงานปัจจุบัน และหมายเหตุ (เช่น WFH
              / ทำงานนอกสถานที่)
            </Text>
            <Text style={styles.offSiteLabel}>ตำแหน่ง / สถานที่</Text>
            <TextInput
              style={styles.offSiteInput}
              value={offSiteLocation}
              onChangeText={(t) => setOffSiteLocation(t.slice(0, 200))}
              placeholder="เช่น บ้าน · ไซต์ลูกค้า สีลม"
              placeholderTextColor={NatureTheme.colors.textMuted}
              multiline
            />
            <Text style={styles.offSiteLabel}>หมายเหตุ</Text>
            <TextInput
              style={styles.offSiteInput}
              value={offSiteRemark}
              onChangeText={(t) => setOffSiteRemark(t.slice(0, 200))}
              placeholder="เช่น WFH · ประชุมนอกสถานที่"
              placeholderTextColor={NatureTheme.colors.textMuted}
              multiline
            />
            <View style={styles.offSiteActions}>
              <Pressable
                style={[styles.sheetSecondaryBtn, styles.offSiteActionBtn]}
                onPress={cancelOffSite}>
                <Text style={styles.sheetSecondaryBtnText}>ยกเลิก</Text>
              </Pressable>
              <Pressable
                style={[styles.sheetPrimaryBtn, styles.offSiteActionBtn]}
                onPress={confirmOffSiteCheckIn}>
                <Text style={styles.sheetPrimaryBtnText}>ถัดไป (เลือกอารมณ์)</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <WellbeingMoodModal
        visible={moodOpen}
        saving={moodSaving}
        options={WELLBEING_MOOD_OPTIONS}
        onPick={completeAttendanceWithMood}
        onCancel={cancelMoodFlow}
      />
      <Modal
        visible={checkOutConfirmOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setCheckOutConfirmOpen(false)}>
        <Pressable
          style={[styles.sheetBackdrop, WEB_MODAL_BACKDROP]}
          onPress={() => setCheckOutConfirmOpen(false)}>
          <Pressable style={styles.sheetCard} onPress={() => {}}>
            <Text style={styles.sheetTitle}>ยืนยันบันทึกออกงาน</Text>
            <Text style={styles.sheetBody}>ต้องการบันทึกเวลาออกงานตอนนี้ใช่ไหม?</Text>
            <View style={styles.sheetActionRow}>
              <Pressable
                style={[styles.sheetSecondaryBtn, styles.sheetActionHalf]}
                onPress={() => setCheckOutConfirmOpen(false)}>
                <Text style={styles.sheetSecondaryBtnText}>ยกเลิก</Text>
              </Pressable>
              <Pressable
                style={[styles.sheetPrimaryBtn, styles.sheetActionHalf]}
                onPress={() => {
                  setCheckOutConfirmOpen(false);
                  void startAttendance('check_out');
                }}>
                <Text style={styles.sheetPrimaryBtnText}>ยืนยัน</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={checkoutDoneOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setCheckoutDoneOpen(false)}>
        <Pressable
          style={[styles.sheetBackdrop, WEB_MODAL_BACKDROP]}
          onPress={() => setCheckoutDoneOpen(false)}>
          <Pressable style={styles.sheetCard} onPress={() => {}}>
            <Text style={styles.sheetTitle}>บันทึกออกงานแล้ว</Text>
            <Text style={styles.sheetBody}>
              ขอให้พักผ่อนพอดี และเดินทางปลอดภัยนะครับ
            </Text>
            <Pressable
              style={styles.sheetPrimaryBtn}
              onPress={() => setCheckoutDoneOpen(false)}>
              <Text style={styles.sheetPrimaryBtnText}>ปิด</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={postCheckInOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setPostCheckInOpen(false)}>
        <Pressable
          style={[styles.sheetBackdrop, WEB_MODAL_BACKDROP]}
          onPress={() => setPostCheckInOpen(false)}>
          <Pressable style={styles.sheetCardTall} onPress={() => {}}>
            <Text style={styles.sheetTitle}>งานที่ยังต้องทำ</Text>
            <Text style={styles.sheetSub}>
              รายการจากสถานะ «รอดำเนินการ» และ «กำลังทำ»
            </Text>
            <ScrollView
              style={styles.taskScroll}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}>
              {postCheckInTasks.length === 0 ? (
                <Text style={styles.emptyTasksMsg}>
                  วันนี้ไม่มีงานค้างเลย คุณจัดการงานได้ดีมาก
                </Text>
              ) : (
                postCheckInTasks.map((t) => (
                  <View key={t.id} style={styles.taskRow}>
                    <Text style={styles.taskTitle} numberOfLines={2}>
                      {t.title}
                    </Text>
                    <Text style={styles.taskMeta}>
                      {taskStatusLabelTh(t.status)}
                    </Text>
                  </View>
                ))
              )}
            </ScrollView>
            <View style={styles.sheetActions}>
              {postCheckInTasks.length > 0 ? (
                <Pressable
                  style={styles.sheetSecondaryBtn}
                  onPress={() => {
                    setPostCheckInOpen(false);
                    router.push('/tasks');
                  }}>
                  <Text style={styles.sheetSecondaryBtnText}>ไปหน้างาน</Text>
                </Pressable>
              ) : null}
              <Pressable
                style={styles.sheetPrimaryBtn}
                onPress={() => setPostCheckInOpen(false)}>
                <Text style={styles.sheetPrimaryBtnText}>ปิด</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={!!pendingOvertimeRequest}
        transparent
        animationType="fade"
        onRequestClose={() => {}}>
        <Pressable style={[styles.sheetBackdrop, WEB_MODAL_BACKDROP]} onPress={() => {}}>
          <Pressable style={styles.sheetCard} onPress={() => {}}>
            <Text style={styles.sheetTitle}>ทำงานล่วงเวลา?</Text>
            <Text style={styles.sheetBody}>
              เลยเวลาออกงาน 30 นาทีแล้ว ต้องการทำงานล่วงเวลาต่อหรือไม่
            </Text>
            <Text style={styles.otHintText}>
              ถ้าทำ OT ต่อ ระบบจะนับเวลาทำงานต่อจนกว่าจะกดออกงานเอง
            </Text>
            {pendingOvertimeRequest?.response_deadline_at ? (
              <Text style={styles.otCountdownText}>
                ระบบจะออกงานอัตโนมัติใน{' '}
                {Math.max(
                  0,
                  Math.ceil(
                    (new Date(pendingOvertimeRequest.response_deadline_at).getTime() -
                      nowTick.getTime()) /
                      1000
                  )
                )}{' '}
                วินาที หากไม่ตอบรับ
              </Text>
            ) : null}
            <View style={styles.sheetActions}>
              <Pressable
                style={[styles.sheetSecondaryBtn, otResponding && styles.disabled]}
                disabled={otResponding}
                onPress={() => void respondOvertime(false)}>
                <Text style={styles.sheetSecondaryBtnText}>ไม่ทำ OT (ออกงาน)</Text>
              </Pressable>
              <Pressable
                style={[styles.sheetPrimaryBtn, otResponding && styles.disabled]}
                disabled={otResponding}
                onPress={() => void respondOvertime(true)}>
                <Text style={styles.sheetPrimaryBtnText}>ต้องการทำ OT</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
      <Modal
        visible={scheduleCalendarOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setScheduleCalendarOpen(false)}>
        <View style={[styles.sheetBackdrop, WEB_MODAL_BACKDROP]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setScheduleCalendarOpen(false)}
          />
          <View style={[styles.sheetCardTall, styles.calendarSheetCard]}>
            <ScrollView
              style={styles.calendarModalScroll}
              contentContainerStyle={styles.calendarModalContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator>
            <Text style={styles.sheetTitle}>ปฏิทินตารางงานของฉัน</Text>
            <Text style={styles.sheetSub}>มุมมองรายเดือน · แตะวันที่เพื่อดูรายละเอียด</Text>
            <View style={styles.monthNavRow}>
              <Pressable
                style={styles.monthNavBtn}
                onPress={() =>
                  setScheduleCalendarAnchorDate((prev) => addMonthsLocal(prev ?? new Date(), -1))
                }>
                <Text style={styles.monthNavBtnText}>{'< เดือนก่อน'}</Text>
              </Pressable>
              <Text style={styles.monthNavLabel}>
                {(scheduleCalendarAnchorDate ?? new Date()).toLocaleDateString('th-TH', {
                  month: 'long',
                  year: 'numeric',
                })}
              </Text>
              <Pressable
                style={styles.monthNavBtn}
                onPress={() =>
                  setScheduleCalendarAnchorDate((prev) => addMonthsLocal(prev ?? new Date(), 1))
                }>
                <Text style={styles.monthNavBtnText}>{'เดือนถัดไป >'}</Text>
              </Pressable>
            </View>
            <Text style={styles.legendSummaryText}>มีตารางงาน {scheduleDaysCount} วัน</Text>
            {scheduleCalendarLoading ? (
              <ActivityIndicator color={NatureTheme.colors.primary} style={{ marginVertical: 18 }} />
            ) : scheduleCalendarRows.length === 0 ? (
              <Text style={styles.emptyTasksMsg}>เดือนนี้ยังไม่มีตารางงานที่ถูกมอบหมาย</Text>
            ) : (
              <>
                <Text style={styles.calendarTapHint}>แตะวันที่ในปฏิทินเพื่อดูตารางงานของวันนั้น</Text>
                <View style={styles.calendarWeekHeader}>
                  {['จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส', 'อา'].map((d) => (
                    <Text key={d} style={styles.calendarWeekHeaderText}>
                      {d}
                    </Text>
                  ))}
                </View>
                <View style={styles.calendarGrid}>
                  {scheduleGridCells.map((cell, idx) => {
                    const dayText = cell.ymd ? String(Number(cell.ymd.slice(8, 10))) : '';
                    const selected = !!cell.ymd && cell.ymd === scheduleSelectedYmd;
                    const isToday = !!cell.ymd && cell.ymd === todayYmdInBangkok;
                    return (
                      <Pressable
                        key={`${cell.ymd ?? 'blank'}-${idx}`}
                        style={[
                          styles.calendarCell,
                          isToday && styles.calendarCellToday,
                          selected && styles.calendarCellSelected,
                        ]}
                        disabled={!cell.ymd}
                        onPress={() => {
                          if (cell.ymd) openScheduleDayDetail(cell.ymd, cell.rows);
                        }}>
                        <Text
                          style={[
                            styles.calendarDayNumber,
                            !cell.ymd && styles.calendarDayNumberMuted,
                            isToday && styles.calendarDayNumberToday,
                            selected && styles.calendarDayNumberSelected,
                          ]}>
                          {dayText}
                        </Text>
                        {cell.markerSource ? (
                          <View
                            style={[
                              styles.calendarDot,
                              cell.markerSource === 'shift'
                                ? styles.dotShift
                                : cell.markerSource === 'legacy'
                                  ? styles.dotLegacy
                                  : styles.dotMemo,
                            ]}
                          />
                        ) : null}
                        {cell.markerSource ? (
                          <Text style={styles.calendarMiniCount}>
                            {cell.rows.length > 0 ? 'มีงาน' : 'มีโน้ต'}
                          </Text>
                        ) : null}
                      </Pressable>
                    );
                  })}
                </View>
              </>
            )}
            <View style={styles.calendarCloseRow}>
              <Pressable
                style={styles.calendarCloseBtn}
                onPress={() => setScheduleCalendarOpen(false)}>
                <Text style={styles.calendarCloseBtnText}>ปิด</Text>
              </Pressable>
            </View>
            </ScrollView>
          </View>
          {scheduleDayDetailOpen ? (
            <View style={styles.dayDetailOverlayWrap}>
              <Pressable
                style={styles.dayDetailBackdrop}
                onPress={() => setScheduleDayDetailOpen(false)}
              />
              <View style={styles.dayDetailCard}>
                <Text style={styles.sheetTitle}>
                  {scheduleSelectedYmd ? `ตารางงานวันที่ ${scheduleSelectedYmd}` : 'ตารางงาน'}
                </Text>
                <Text style={styles.sheetSub}>
                  {scheduleDayDetailRows.length > 0
                    ? 'รายละเอียดตารางงานที่มอบหมายในวันดังกล่าว'
                    : 'วันนี้ยังไม่มีตารางงาน แต่คุณสามารถจดโน้ต/เช็กลิสต์ได้'}
                </Text>
                <ScrollView style={styles.taskScroll} showsVerticalScrollIndicator={false}>
                  {scheduleDayDetailRows.length > 0 ? (
                    scheduleDayDetailRows.map((row, idx) => (
                      <View
                        key={`${row.ymd}-${row.source}-${row.startText}-${idx}`}
                        style={styles.scheduleCalendarRow}>
                        <Text style={styles.scheduleCalendarTitle}>{row.title}</Text>
                        <Text style={styles.scheduleCalendarMeta}>
                          เวลา {row.startText} - {row.endText}
                        </Text>
                        <Text style={styles.scheduleCalendarMeta}>
                          สาขาที่เข้าได้:{' '}
                          {row.allowedBranchId != null
                            ? row.allowedBranchName || `#${row.allowedBranchId}`
                            : 'ไม่จำกัด'}
                        </Text>
                      </View>
                    ))
                  ) : (
                    <Text style={styles.emptyTasksMsg}>ยังไม่มีข้อมูลตารางงาน</Text>
                  )}
                  <View style={styles.dayMemoCard}>
                    <Text style={styles.dayMemoTitle}>บันทึกงานของวัน (คล้ายกิจกรรม)</Text>
                    {scheduleDayLoading ? (
                      <ActivityIndicator color={NatureTheme.colors.primary} style={{ marginVertical: 12 }} />
                    ) : (
                      <>
                        <TextInput
                          style={styles.dayMemoInput}
                          value={scheduleDayNote}
                          onChangeText={setScheduleDayNote}
                          placeholder="เพิ่มโน้ตของวันนี้..."
                          placeholderTextColor={NatureTheme.colors.textMuted}
                          multiline
                        />
                        <Text style={styles.dayMemoSectionTitle}>เช็กลิสต์</Text>
                        {scheduleDayChecklist.length === 0 ? (
                          <Text style={styles.dayMemoEmpty}>ยังไม่มีรายการเช็กลิสต์</Text>
                        ) : (
                          scheduleDayChecklist.map((item) => (
                            <View key={item.id} style={styles.dayChecklistRow}>
                              <Pressable
                                style={styles.dayChecklistCheck}
                                onPress={() =>
                                  setScheduleDayChecklist((prev) =>
                                    prev.map((it) =>
                                      it.id === item.id ? { ...it, done: !it.done } : it
                                    )
                                  )
                                }>
                                <FontAwesome
                                  name={item.done ? 'check-square-o' : 'square-o'}
                                  size={18}
                                  color={item.done ? NatureTheme.colors.checkIn : NatureTheme.colors.textMuted}
                                />
                              </Pressable>
                              <Text style={[styles.dayChecklistLabel, item.done && styles.dayChecklistLabelDone]}>
                                {item.label}
                              </Text>
                              <Pressable
                                style={styles.dayChecklistDeleteBtn}
                                onPress={() =>
                                  setScheduleDayChecklist((prev) => prev.filter((it) => it.id !== item.id))
                                }>
                                <FontAwesome name="trash-o" size={16} color={NatureTheme.colors.error} />
                              </Pressable>
                            </View>
                          ))
                        )}
                        <View style={styles.dayChecklistAddRow}>
                          <TextInput
                            style={styles.dayChecklistAddInput}
                            value={scheduleDayNewItemText}
                            onChangeText={setScheduleDayNewItemText}
                            placeholder="เพิ่มรายการเช็กลิสต์"
                            placeholderTextColor={NatureTheme.colors.textMuted}
                          />
                          <Pressable
                            style={styles.dayChecklistAddBtn}
                            onPress={() => {
                              const next = scheduleDayNewItemText.trim();
                              if (!next) return;
                              setScheduleDayChecklist((prev) => [
                                ...prev,
                                {
                                  id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                                  label: next,
                                  done: false,
                                },
                              ]);
                              setScheduleDayNewItemText('');
                            }}>
                            <Text style={styles.dayChecklistAddBtnText}>เพิ่ม</Text>
                          </Pressable>
                        </View>
                      </>
                    )}
                  </View>
                </ScrollView>
                <View style={styles.sheetActions}>
                  <Pressable
                    style={[styles.sheetSecondaryBtn, scheduleDaySaving && styles.disabled]}
                    disabled={scheduleDaySaving || scheduleDayLoading}
                    onPress={() => void saveScheduleDayMemo()}>
                    <Text style={styles.sheetSecondaryBtnText}>
                      {scheduleDaySaving ? 'กำลังบันทึก...' : 'บันทึกโน้ต/เช็กลิสต์'}
                    </Text>
                  </Pressable>
                  <Pressable
                    style={styles.sheetPrimaryBtn}
                    onPress={() => setScheduleDayDetailOpen(false)}>
                    <Text style={styles.sheetPrimaryBtnText}>ปิด</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          ) : null}
        </View>
      </Modal>

      <FlatList
        data={logs}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={NatureTheme.colors.primary}
            colors={[NatureTheme.colors.primary]}
            title="ดึงลงเพื่อรีเฟรช"
            titleColor={NatureTheme.colors.textMuted}
          />
        }
        ListHeaderComponent={
          <>
            <AnnouncementCarousel
              urls={announcementUrls}
              slides={announcementSlides}
              slideHeightPx={announcementSlideHeightPx}
            />
            <View style={styles.userStrip}>
              <UserAvatar
                uri={profile?.avatar_url}
                label={greetName}
                size={48}
              />
              <View style={styles.userStripText}>
                <Text style={styles.userGreet}>สวัสดี</Text>
                <Text style={styles.userName} numberOfLines={1}>
                  {greetWithMood}
                </Text>
              </View>
              <View style={styles.userClock}>
                <Text style={styles.userClockLabel}>เวลาปัจจุบัน</Text>
                <Text style={styles.userClockMain}>
                  {nowTick.toLocaleTimeString('th-TH', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </Text>
                <Text style={styles.userClockDate}>
                  {nowTick.toLocaleDateString('th-TH', {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                  })}
                </Text>
              </View>
              <Pressable
                style={({ pressed }) => [
                  styles.refreshHeaderBtn,
                  pressed && !refreshing && styles.refreshHeaderBtnPressed,
                ]}
                onPress={() => void onRefresh()}
                disabled={refreshing}
                accessibilityRole="button"
                accessibilityLabel="รีเฟรชข้อมูลหน้านี้">
                <FontAwesome
                  name="refresh"
                  size={22}
                  color={NatureTheme.colors.primaryDark}
                  style={refreshing ? styles.refreshIconBusy : undefined}
                />
              </Pressable>
            </View>
            <View style={styles.workCard}>
              <Text style={styles.workTitle}>เวลาทำงานวันนี้</Text>
              {todayPlanLabel ? (
                <Text style={styles.workPlan} numberOfLines={2}>
                  {todayPlanLabel}
                </Text>
              ) : (
                <Text style={styles.workPlanMuted}>ยังไม่พบกะที่มอบหมายสำหรับวันนี้</Text>
              )}
              <Text style={styles.workTime}>{formatDurationMs(workedTodayMs)}</Text>
              <Text style={styles.workSub}>
                พักรวม {Math.floor(totalBreakTodayMs / 60000)} นาที
              </Text>
                {onBreak ? (
                  <Text style={styles.breakingHint}>
                    กำลังพักอยู่ {latestBreakMinutes} นาที
                  </Text>
                ) : null}
            </View>
            {onApprovedLeaveToday ? (
              <Text style={styles.leaveBlocksCheckInHint}>
                วันนี้เป็นวันลาที่อนุมัติแล้ว — ไม่บันทึกเข้างาน ออกงาน พักเบรก
                หรือขอเข้าสาย/ลาซ้ำในวันนี้
              </Text>
            ) : null}
            <View style={styles.actions}>
              <Pressable
                style={[
                  styles.primary,
                  compact && styles.touchCompactBtn,
                  largeTouch && styles.touchLargeBtn,
                  checkInDisabled && styles.disabled,
                ]}
                onPress={() => startAttendance('check_in')}
                disabled={checkInDisabled}>
                <View style={styles.actionBtnInner}>
                  <FontAwesome name="sign-in" size={16} color={c.onAccent} />
                  <Text style={[styles.primaryText, compact && styles.touchCompactBtnText]}>
                    บันทึกเข้างาน
                  </Text>
                </View>
              </Pressable>
              <Pressable
                style={[
                  styles.secondary,
                  compact && styles.touchCompactBtn,
                  largeTouch && styles.touchLargeBtn,
                  checkOutDisabled && styles.disabled,
                ]}
                onPress={() => setCheckOutConfirmOpen(true)}
                disabled={checkOutDisabled}>
                <View style={styles.actionBtnInner}>
                  <FontAwesome name="sign-out" size={16} color={c.text} />
                  <Text style={[styles.secondaryText, compact && styles.touchCompactBtnText]}>
                    บันทึกออกงาน
                  </Text>
                </View>
              </Pressable>
              <View style={styles.actionGrid}>
                <Pressable
                  style={[
                    styles.actionCard,
                    styles.breakBtn,
                    compact && styles.touchCompactBtn,
                    largeTouch && styles.touchLargeBtn,
                    breakStartDisabled && styles.disabled,
                  ]}
                  onPress={() => markBreak('break_start')}
                  disabled={breakStartDisabled}>
                  <View style={styles.actionBtnStack}>
                    <FontAwesome name="pause" size={14} color={c.warningTitle} />
                    <Text style={styles.breakBtnText}>พักเบรก</Text>
                  </View>
                </Pressable>
                <Pressable
                  style={[
                    styles.actionCard,
                    styles.resumeBtn,
                    compact && styles.touchCompactBtn,
                    largeTouch && styles.touchLargeBtn,
                    breakEndDisabled && styles.disabled,
                  ]}
                  onPress={() => markBreak('break_end')}
                  disabled={breakEndDisabled}>
                  <View style={styles.actionBtnStack}>
                    <FontAwesome name="play" size={14} color={c.primaryDark} />
                    <Text style={styles.resumeBtnText}>เริ่มงาน (หลังพัก)</Text>
                  </View>
                </Pressable>
                <Pressable
                  style={[
                    styles.actionCard,
                    styles.leaveBtn,
                    onApprovedLeaveToday && styles.disabled,
                  ]}
                  onPress={() => setLeaveModalOpen(true)}
                  disabled={onApprovedLeaveToday}>
                  <View style={styles.actionBtnStack}>
                    <FontAwesome name="file-text-o" size={14} color={c.river} />
                    <Text style={[styles.leaveBtnText, compact && styles.touchCompactBtnText]}>
                      ลางาน
                    </Text>
                  </View>
                </Pressable>
                <Pressable
                  style={[styles.actionCard, styles.lateBtn, lateDisabled && styles.disabled]}
                  onPress={() => setLateModalOpen(true)}
                  disabled={lateDisabled}>
                  <View style={styles.actionBtnStack}>
                    <FontAwesome name="clock-o" size={14} color={c.accentWarm} />
                    <Text style={[styles.lateBtnText, compact && styles.touchCompactBtnText]}>
                      ขอเข้าสาย
                    </Text>
                  </View>
                </Pressable>
              </View>
              {hasTodayCheckIn && !onApprovedLeaveToday ? (
                <Text style={styles.actionHintMuted}>บันทึกเข้างานแล้ว จึงไม่สามารถขอเข้าสายได้</Text>
              ) : null}
              <Pressable
                style={[
                  styles.scheduleViewBtn,
                  compact && styles.touchCompactBtn,
                  largeTouch && styles.touchLargeBtn,
                ]}
                onPress={() => setScheduleCalendarOpen(true)}>
                <View style={styles.actionBtnInner}>
                  <FontAwesome name="calendar" size={15} color={c.primaryDark} />
                  <Text style={styles.scheduleViewBtnText}>ตารางเข้าออกงานของฉัน</Text>
                </View>
              </Pressable>
            </View>
            {pendingCount > 0 ? (
              <Pressable
                style={styles.pendingCard}
                onPress={() => router.push('/tasks')}>
                <View style={styles.pendingHeadRow}>
                  <View>
                    <Text style={styles.pendingEyebrow}>Work Status</Text>
                    <Text style={styles.pendingTitle}>งานที่กำลังทำ / ค้างอยู่</Text>
                  </View>
                  <View style={styles.pendingCountPill}>
                    <Text style={styles.pendingCountNum}>{pendingCount}</Text>
                    <Text style={styles.pendingCountLabel}>งาน</Text>
                  </View>
                </View>
                <View style={styles.pendingStatsRow}>
                  <View style={styles.pendingStatChip}>
                    <Text style={styles.pendingStatValue}>{activeTaskCount}</Text>
                    <Text style={styles.pendingStatLabel}>กำลังทำ</Text>
                  </View>
                  <View style={styles.pendingStatChip}>
                    <Text style={styles.pendingStatValue}>{waitingTaskCount}</Text>
                    <Text style={styles.pendingStatLabel}>รอดำเนินการ</Text>
                  </View>
                  <Text style={styles.pendingHint}>แตะเพื่อจัดการงานทั้งหมด</Text>
                </View>
                {workStatusPreviewTasks.map((t) => (
                  <View key={t.id} style={styles.pendingLineRow}>
                    <View
                      style={[
                        styles.pendingPriBar,
                        {
                          backgroundColor: priorityColor(
                            (t.priority as TaskPriority) || 'normal'
                          ),
                        },
                      ]}
                    />
                    <View style={styles.pendingLineBody}>
                      <Text style={styles.pendingLine} numberOfLines={1}>
                        {t.title}
                      </Text>
                      <Text style={styles.pendingLineMeta}>
                        {taskStatusLabelTh(t.status)}
                      </Text>
                    </View>
                  </View>
                ))}
                {pendingCount > 4 ? (
                  <Text style={styles.pendingMore}>
                    และอีก {pendingCount - 4} รายการ…
                  </Text>
                ) : null}
              </Pressable>
            ) : null}
            <View style={styles.summaryCard}>
              <Text style={styles.summaryTitle}>ตารางสรุปเวลาเข้า-ออกงาน</Text>
              <Text style={styles.summaryHint}>รอบวันที่ 26 ของเดือนก่อน ถึง 25 ของเดือนที่เลือก</Text>
              <DatePickerField
                label="เลือกเดือนสำหรับสรุป"
                value={summaryAnchorDate}
                onChange={(d) => setSummaryAnchorDate(d ?? new Date())}
                disabled={summaryLoading || exporting}
              />
              <Text style={styles.summaryPeriodText}>
                ช่วงที่แสดง: {period.startYmd} - {period.endYmd}
              </Text>
              <View style={styles.summaryExportRow}>
                <Pressable
                  style={[styles.summaryExportBtn, exporting && styles.disabled]}
                  disabled={exporting || summaryLoading}
                  onPress={() => void exportCsv()}>
                  <Text style={styles.summaryExportBtnText}>ดาวน์โหลด CSV</Text>
                </Pressable>
                <Pressable
                  style={[styles.summaryExportBtnAlt, exporting && styles.disabled]}
                  disabled={exporting || summaryLoading}
                  onPress={() => void exportPdf()}>
                  <Text style={styles.summaryExportBtnAltText}>ดาวน์โหลด PDF</Text>
                </Pressable>
              </View>
              {summaryLoading ? (
                <ActivityIndicator
                  color={NatureTheme.colors.primary}
                  style={styles.summaryLoading}
                />
              ) : (
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View>
                    <View style={[styles.summaryTableRow, styles.summaryHeaderRow]}>
                      <Text style={[styles.summaryCell, styles.summaryHeaderCell, styles.colDate]}>
                        วันที่
                      </Text>
                      <Text style={[styles.summaryCell, styles.summaryHeaderCell, styles.colTime]}>
                        เวลาเข้างาน
                      </Text>
                      <Text style={[styles.summaryCell, styles.summaryHeaderCell, styles.colTime]}>
                        เวลาออกงาน
                      </Text>
                      <Text style={[styles.summaryCell, styles.summaryHeaderCell, styles.colEmp]}>
                        รหัสพนักงาน
                      </Text>
                      <Text style={[styles.summaryCell, styles.summaryHeaderCell, styles.colLocation]}>
                        สถานที่เข้างาน
                      </Text>
                      <Text style={[styles.summaryCell, styles.summaryHeaderCell, styles.colNote]}>
                        หมายเหตุ
                      </Text>
                    </View>
                    {summaryRows.map((row) => (
                      <View key={row.dateYmd} style={styles.summaryTableRow}>
                        <Text style={[styles.summaryCell, styles.colDate]}>{row.dateYmd}</Text>
                        <Text style={[styles.summaryCell, styles.colTime]}>{row.checkIn}</Text>
                        <Text style={[styles.summaryCell, styles.colTime]}>{row.checkOut}</Text>
                        <Text style={[styles.summaryCell, styles.colEmp]}>{row.employeeCode}</Text>
                        <Text style={[styles.summaryCell, styles.colLocation]}>{row.checkInLocation}</Text>
                        <Text style={[styles.summaryCell, styles.colNote]}>{row.note}</Text>
                      </View>
                    ))}
                  </View>
                </ScrollView>
              )}
            </View>
            <Text style={styles.section}>ประวัติล่าสุด</Text>
          </>
        }
        ListEmptyComponent={
          <Text style={styles.empty}>ยังไม่มีบันทึก</Text>
        }
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Text style={styles.rowTitle}>{attendanceKindLabel(item.kind)}</Text>
            <Text style={styles.rowMeta}>
              {new Date(item.created_at).toLocaleString('th-TH')}
              {item.within_branch ? '' : ' · นอกสาขา'}
            </Text>
            {item.note ? (
              <Text style={styles.rowNote} numberOfLines={4}>
                {item.note}
              </Text>
            ) : null}
          </View>
        )}
      />
      <FriendlyNoticeModal
        visible={!!breakNotice}
        variant={breakNotice?.variant ?? 'info'}
        title={breakNotice?.title ?? ''}
        message={breakNotice?.message}
        autoDismissMs={2800}
        onClose={() => setBreakNotice(null)}
      />
    </View>
  );
}

const c = NatureTheme.colors;
const r = NatureTheme.radius;
const s = NatureTheme.spacing;

const styles = StyleSheet.create({
  screen: { flex: 1, padding: s.screen, backgroundColor: c.canvas },
  listContent: { paddingBottom: s.scrollBottom },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  userStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s.gapRow,
    backgroundColor: c.surface,
    borderRadius: r.md,
    padding: s.card,
    marginBottom: s.section,
    borderWidth: 1,
    borderColor: c.borderSoft,
  },
  userStripText: { flex: 1, minWidth: 0 },
  userGreet: { fontSize: 12, color: c.textMuted },
  userName: { fontSize: 17, fontWeight: '700', color: c.text, marginTop: 2 },
  userClock: {
    minWidth: 104,
    alignItems: 'flex-end',
  },
  userClockLabel: { fontSize: 11, color: c.textMuted, marginBottom: 2 },
  userClockMain: {
    fontSize: 20,
    fontWeight: '700',
    color: c.primaryDark,
    fontVariant: ['tabular-nums'],
  },
  userClockDate: {
    marginTop: 2,
    fontSize: 10,
    color: c.textMuted,
  },
  refreshHeaderBtn: {
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'center',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: r.sm,
    borderWidth: 1,
    borderColor: c.borderSoft,
    backgroundColor: c.surfaceElevated,
  },
  refreshHeaderBtnPressed: { opacity: 0.88 },
  refreshIconBusy: { opacity: 0.45 },
  workCard: {
    backgroundColor: c.surface,
    borderRadius: r.md,
    borderWidth: 1,
    borderColor: c.borderSoft,
    padding: s.card,
    marginBottom: s.section,
    alignItems: 'center',
  },
  workTitle: { fontSize: 12, color: c.textMuted },
  workTime: {
    marginTop: 4,
    fontSize: 28,
    fontWeight: '700',
    color: c.primaryDark,
    fontVariant: ['tabular-nums'],
  },
  workSub: { marginTop: 2, fontSize: 12, color: c.textSecondary },
  workPlan: {
    marginTop: 6,
    fontSize: 12,
    color: c.primaryDark,
    textAlign: 'center',
    fontWeight: '600',
  },
  workPlanMuted: {
    marginTop: 6,
    fontSize: 12,
    color: c.textMuted,
    textAlign: 'center',
  },
  breakingHint: {
    marginTop: 6,
    fontSize: 12,
    color: c.warningTitle,
    backgroundColor: c.warningBg,
    borderColor: c.warningBorder,
    borderWidth: 1,
    borderRadius: r.sm,
    paddingHorizontal: 10,
    paddingVertical: 4,
    overflow: 'hidden',
  },
  actions: { gap: s.gap, marginBottom: s.section },
  actionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: s.gapRow,
  },
  actionCard: {
    width: '48.8%',
    minHeight: 64,
  },
  actionBtnInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  actionBtnStack: {
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  actionHintMuted: {
    marginTop: 2,
    marginBottom: 2,
    textAlign: 'center',
    fontSize: 12,
    color: c.textMuted,
  },
  primary: {
    backgroundColor: c.checkIn,
    paddingVertical: 12,
    borderRadius: r.lg,
    alignItems: 'center',
    shadowColor: c.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
  },
  secondary: {
    backgroundColor: c.surface,
    borderWidth: 1.5,
    borderColor: c.border,
    paddingVertical: 12,
    borderRadius: r.lg,
    alignItems: 'center',
  },
  scheduleViewBtn: {
    backgroundColor: c.surfaceMuted,
    borderWidth: 1,
    borderColor: c.primaryMuted,
    borderRadius: r.lg,
    paddingVertical: 11,
    alignItems: 'center',
  },
  scheduleViewBtnText: { color: c.primaryDark, fontWeight: '700', fontSize: 14 },
  touchCompactBtn: {
    paddingVertical: 10,
    borderRadius: r.md,
  },
  touchLargeBtn: {
    paddingVertical: 14,
  },
  touchCompactBtnText: {
    fontSize: 14,
  },
  primaryText: { color: c.onAccent, fontWeight: '700', fontSize: 16 },
  leaveBlocksCheckInHint: {
    marginTop: 6,
    marginBottom: 10,
    paddingHorizontal: 4,
    fontSize: 13,
    lineHeight: 19,
    color: c.warningTitle,
    textAlign: 'center',
  },
  secondaryText: { color: c.text, fontWeight: '600', fontSize: 16 },
  breakBtn: {
    backgroundColor: c.accentWarmLight,
    borderRadius: r.md,
    paddingVertical: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: c.warningBorder,
  },
  breakBtnText: { color: c.warningTitle, fontWeight: '700' },
  resumeBtn: {
    backgroundColor: c.primaryLight,
    borderRadius: r.md,
    paddingVertical: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: c.primaryMuted,
  },
  resumeBtnText: { color: c.primaryDark, fontWeight: '700' },
  leaveBtn: {
    backgroundColor: c.riverLight,
    borderRadius: r.md,
    paddingVertical: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: c.river,
  },
  leaveBtnText: { color: c.river, fontWeight: '700', fontSize: 14 },
  lateBtn: {
    backgroundColor: c.accentWarmLight,
    borderRadius: r.md,
    paddingVertical: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: c.accentWarm,
  },
  lateBtnText: { color: c.accentWarm, fontWeight: '700', fontSize: 14 },
  disabled: { opacity: 0.6 },
  pendingCard: {
    backgroundColor: c.surfaceElevated,
    borderWidth: 1,
    borderColor: c.primaryMuted,
    borderRadius: r.md,
    padding: s.card,
    marginBottom: s.section,
  },
  pendingHeadRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    alignItems: 'center',
    marginBottom: 10,
  },
  pendingEyebrow: {
    fontSize: 11,
    color: c.primaryDark,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  pendingTitle: { fontSize: 17, fontWeight: '800', color: c.text, marginTop: 2 },
  pendingCountPill: {
    minWidth: 58,
    borderRadius: r.md,
    backgroundColor: c.primary,
    paddingVertical: 8,
    paddingHorizontal: 10,
    alignItems: 'center',
  },
  pendingCountNum: { color: c.onAccent, fontSize: 18, fontWeight: '900', lineHeight: 20 },
  pendingCountLabel: { color: c.onAccent, fontSize: 10, opacity: 0.85 },
  pendingStatsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
    marginBottom: 8,
  },
  pendingStatChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: c.primaryLight,
    borderRadius: 999,
    paddingVertical: 5,
    paddingHorizontal: 9,
  },
  pendingStatValue: { color: c.primaryDark, fontSize: 12, fontWeight: '900' },
  pendingStatLabel: { color: c.primaryDark, fontSize: 11, fontWeight: '700' },
  pendingHint: { fontSize: 12, color: c.textMuted },
  pendingLineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
    backgroundColor: c.surfaceMuted,
    borderRadius: r.sm,
    padding: 9,
  },
  pendingPriBar: {
    width: 4,
    height: 28,
    borderRadius: 2,
  },
  pendingLineBody: { flex: 1 },
  pendingLine: { fontSize: 14, color: c.text, fontWeight: '700' },
  pendingLineMeta: { fontSize: 11, color: c.textMuted, marginTop: 2 },
  pendingMore: { fontSize: 12, color: c.textMuted, marginTop: 8, fontStyle: 'italic' },
  summaryCard: {
    backgroundColor: c.surface,
    borderRadius: r.md,
    borderWidth: 1,
    borderColor: c.borderSoft,
    padding: s.card,
    marginBottom: s.section,
    gap: 8,
  },
  summaryTitle: { fontSize: 16, fontWeight: '700', color: c.text },
  summaryHint: { fontSize: 12, color: c.textMuted, marginBottom: 2 },
  summaryPeriodText: { fontSize: 12, color: c.textSecondary },
  summaryExportRow: { flexDirection: 'row', gap: 8 },
  summaryExportBtn: {
    flex: 1,
    backgroundColor: c.primaryLight,
    borderWidth: 1,
    borderColor: c.primaryMuted,
    borderRadius: r.sm,
    paddingVertical: 10,
    alignItems: 'center',
  },
  summaryExportBtnText: { color: c.primaryDark, fontWeight: '700' },
  summaryExportBtnAlt: {
    flex: 1,
    backgroundColor: c.surfaceMuted,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: r.sm,
    paddingVertical: 10,
    alignItems: 'center',
  },
  summaryExportBtnAltText: { color: c.text, fontWeight: '700' },
  summaryLoading: { marginVertical: 14 },
  summaryTableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: c.borderSoft,
  },
  summaryHeaderRow: {
    backgroundColor: c.surfaceMuted,
    borderTopWidth: 1,
    borderTopColor: c.borderSoft,
  },
  summaryCell: {
    paddingHorizontal: 8,
    paddingVertical: 9,
    fontSize: 12,
    color: c.text,
  },
  summaryHeaderCell: { fontWeight: '700' },
  colDate: { width: 110 },
  colTime: { width: 94 },
  colEmp: { width: 110 },
  colLocation: { width: 220 },
  colNote: { width: 260 },
  section: { fontWeight: '700', marginBottom: 6, fontSize: 16, color: c.text },
  row: {
    backgroundColor: c.surface,
    padding: s.card,
    borderRadius: r.sm,
    marginBottom: s.gap,
    borderWidth: 1,
    borderColor: c.borderSoft,
  },
  rowTitle: { fontWeight: '600', fontSize: 15, color: c.text },
  rowMeta: { color: c.textMuted, marginTop: 4, fontSize: 13 },
  empty: { color: c.textMuted, textAlign: 'center', marginTop: 14 },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: c.overlay,
    justifyContent: 'flex-end',
  },
  sheetCard: {
    backgroundColor: c.surfaceElevated,
    borderTopLeftRadius: r.xl,
    borderTopRightRadius: r.xl,
    paddingHorizontal: 22,
    paddingTop: 20,
    paddingBottom: 28,
    borderWidth: 1,
    borderColor: c.borderSoft,
    borderBottomWidth: 0,
  },
  dayDetailOverlayWrap: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 50,
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  dayDetailBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: c.overlay,
  },
  dayDetailCard: {
    backgroundColor: c.surfaceElevated,
    borderRadius: r.lg,
    borderWidth: 1,
    borderColor: c.borderSoft,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 14,
    maxHeight: '74%',
  },
  calendarSheetCard: {
    paddingBottom: 10,
    maxHeight: '86%',
  },
  sheetCardTall: {
    backgroundColor: c.surfaceElevated,
    borderTopLeftRadius: r.xl,
    borderTopRightRadius: r.xl,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 24,
    maxHeight: '78%',
    borderWidth: 1,
    borderColor: c.borderSoft,
    borderBottomWidth: 0,
    shadowColor: c.shadow,
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: c.text,
    textAlign: 'center',
  },
  sheetSub: {
    fontSize: 12,
    color: c.textMuted,
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 12,
  },
  sheetBody: {
    fontSize: 15,
    color: c.textSecondary,
    textAlign: 'center',
    marginTop: 12,
    lineHeight: 22,
  },
  otCountdownText: {
    marginTop: 10,
    fontSize: 12,
    lineHeight: 18,
    color: c.warningTitle,
    textAlign: 'center',
  },
  otHintText: {
    marginTop: 8,
    fontSize: 12,
    lineHeight: 18,
    color: c.textMuted,
    textAlign: 'center',
  },
  taskScroll: { maxHeight: 280, marginBottom: 8 },
  emptyTasksMsg: {
    fontSize: 15,
    color: c.primaryDark,
    textAlign: 'center',
    lineHeight: 24,
    paddingVertical: 20,
    paddingHorizontal: 8,
  },
  taskRow: {
    backgroundColor: c.surfaceMuted,
    borderRadius: r.sm,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: c.borderSoft,
  },
  scheduleCalendarRow: {
    backgroundColor: c.surfaceMuted,
    borderRadius: r.sm,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: c.borderSoft,
  },
  calendarLegendRow: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    marginTop: 2,
    marginBottom: 8,
  },
  monthNavRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  monthNavBtn: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: r.sm,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.surfaceElevated,
  },
  monthNavBtnText: {
    fontSize: 12,
    color: c.primaryDark,
    fontWeight: '700',
  },
  monthNavLabel: {
    flex: 1,
    textAlign: 'center',
    color: c.text,
    fontSize: 13,
    fontWeight: '700',
  },
  calendarCloseRow: {
    marginTop: 6,
    alignItems: 'stretch',
  },
  calendarCloseBtn: {
    backgroundColor: c.primary,
    borderRadius: r.md,
    alignItems: 'center',
    paddingVertical: 10,
  },
  calendarCloseBtnText: { color: c.onAccent, fontWeight: '700', fontSize: 14 },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendDot: {
    width: 9,
    height: 9,
    borderRadius: 999,
  },
  legendText: {
    fontSize: 12,
    color: c.textMuted,
  },
  legendSummaryText: {
    marginLeft: 'auto',
    fontSize: 12,
    color: c.textSecondary,
    fontWeight: '600',
  },
  dotShift: { backgroundColor: c.primaryDark },
  dotLegacy: { backgroundColor: c.accentWarm },
  dotMemo: { backgroundColor: c.checkIn },
  calendarTapHint: {
    fontSize: 12,
    color: c.textMuted,
    marginBottom: 6,
  },
  selectedDetailCard: {
    borderWidth: 1,
    borderColor: c.borderSoft,
    borderRadius: r.sm,
    backgroundColor: c.surfaceMuted,
    padding: 10,
    marginBottom: 8,
  },
  selectedDetailEmpty: {
    fontSize: 12,
    color: c.textMuted,
  },
  selectedDetailLine: {
    fontSize: 12,
    color: c.textSecondary,
    marginTop: 4,
  },
  calendarWeekHeader: {
    flexDirection: 'row',
    marginBottom: 6,
  },
  calendarWeekHeaderText: {
    flex: 1,
    textAlign: 'center',
    fontSize: 12,
    color: c.textMuted,
    fontWeight: '700',
  },
  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 10,
    borderRadius: r.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: c.borderSoft,
  },
  calendarCell: {
    width: '14.2857%',
    aspectRatio: 1,
    borderWidth: 0.5,
    borderColor: c.borderSoft,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.surfaceMuted,
  },
  calendarCellSelected: {
    backgroundColor: c.primaryLight,
    borderColor: c.primaryMuted,
  },
  calendarCellToday: {
    borderColor: c.checkIn,
    borderWidth: 2,
  },
  calendarDayNumber: {
    fontSize: 13,
    color: c.text,
    fontWeight: '600',
  },
  calendarDayNumberToday: {
    color: c.checkIn,
  },
  calendarDayNumberSelected: {
    color: c.primaryDark,
    fontWeight: '700',
  },
  calendarDayNumberMuted: {
    color: c.textMuted,
    opacity: 0.45,
  },
  calendarDot: {
    marginTop: 4,
    width: 7,
    height: 7,
    borderRadius: 999,
  },
  calendarMiniCount: {
    marginTop: 3,
    fontSize: 10,
    color: c.textMuted,
  },
  scheduleDetailList: {
    maxHeight: 180,
  },
  calendarModalScroll: {
    maxHeight: '78%',
  },
  calendarModalContent: {
    paddingBottom: 8,
  },
  selectedDateTitle: {
    marginTop: 4,
    marginBottom: 6,
    fontSize: 13,
    fontWeight: '700',
    color: c.textSecondary,
  },
  scheduleCalendarDate: {
    fontSize: 12,
    color: c.textMuted,
  },
  scheduleCalendarTitle: {
    marginTop: 2,
    fontSize: 15,
    fontWeight: '700',
    color: c.text,
  },
  scheduleCalendarMeta: {
    marginTop: 4,
    fontSize: 12,
    color: c.textSecondary,
  },
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
    fontSize: 12,
    fontWeight: '700',
  },
  taskTitle: { fontSize: 15, fontWeight: '600', color: c.text },
  taskMeta: { fontSize: 12, color: c.textMuted, marginTop: 4 },
  sheetActions: { gap: 10, marginTop: 8 },
  sheetActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 8,
  },
  sheetActionHalf: { flex: 1 },
  sheetPrimaryBtn: {
    backgroundColor: c.checkIn,
    paddingVertical: 14,
    borderRadius: r.md,
    alignItems: 'center',
  },
  sheetPrimaryBtnText: { color: c.onAccent, fontWeight: '700', fontSize: 16 },
  sheetSecondaryBtn: {
    backgroundColor: c.surface,
    paddingVertical: 14,
    borderRadius: r.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: c.border,
  },
  sheetSecondaryBtnText: { color: c.primaryDark, fontWeight: '700', fontSize: 15 },
  branchPickScroll: { maxHeight: 320, marginBottom: 12 },
  branchPickRow: {
    backgroundColor: c.surfaceMuted,
    borderRadius: r.md,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: c.borderSoft,
  },
  branchPickRowPressed: { opacity: 0.92 },
  branchPickName: { fontSize: 16, fontWeight: '700', color: c.text },
  branchPickDist: { fontSize: 12, color: c.textMuted, marginTop: 4 },
  offSiteLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: c.textSecondary,
    marginBottom: 6,
    marginTop: 4,
  },
  offSiteInput: {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: r.sm,
    padding: 12,
    minHeight: 52,
    maxHeight: 88,
    textAlignVertical: 'top',
    backgroundColor: c.surface,
    color: c.text,
    fontSize: 14,
    marginBottom: 4,
  },
  offSiteActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
    alignItems: 'stretch',
  },
  offSiteActionBtn: { flex: 1 },
  rowNote: {
    marginTop: 6,
    fontSize: 12,
    color: c.textSecondary,
    lineHeight: 18,
  },
});
