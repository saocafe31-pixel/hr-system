import { useRouter } from 'expo-router';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import * as ImageManipulator from 'expo-image-manipulator';
import {
  ActivityIndicator,
  Image,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Switch,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { AdminEmployeeEditModal } from '@/components/AdminEmployeeEditModal';
import { LateRequestHistoryCard } from '@/components/LateRequestHistoryCard';
import { ProfileClaimsCard } from '@/components/ProfileClaimsCard';
import { ProfilePayslipCard } from '@/components/ProfilePayslipCard';
import { UserAvatar } from '@/components/UserAvatar';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { isAdmin, isManagerOrAdmin, useAuth, useRole } from '@/contexts/AuthContext';
import { useCuteToast } from '@/contexts/CuteToastContext';
import { pickAvatarFromLibrary, uploadAvatarUri } from '@/lib/avatarUpload';
import {
  directoryDisplayName,
  directoryToAdminPreview,
  formatDirectoryValue,
  HR_DIRECTORY_FIELDS,
} from '@/lib/employeeDirectoryDisplay';
import type { AppTheme } from '@/constants/Theme';
import { useTabUnreadBadges } from '@/contexts/TabUnreadBadgesContext';
import {
  getNotificationPermissionStatus,
  isBadgeApiSupported,
  registerWebPushSubscription,
  registerAndSavePushToken,
  requestNotificationPermissions,
} from '@/lib/appNotifications';
import { mapEmployeeTableRowToDirectory } from '@/lib/mapEmployeeRow';
import { mapBranchInformationRows } from '@/lib/mapBranchInformation';
import {
  ATTENDANCE_KPI_SETTINGS_KEY,
  computeAttendanceKpi,
  DEFAULT_ATTENDANCE_KPI_SETTINGS,
  parseAttendanceKpiSettings,
  type AttendanceKpiSettings,
} from '@/lib/attendanceKpi';
import {
  computeLateFromAttendanceData,
  bangkokShiftStartMs,
  payrollPeriodCheckInIsoRange,
  type AssignmentWithShiftTimes,
  type LateActualFromScheduleRow,
} from '@/lib/computeLateFromAttendance';
import {
  bangkokPayrollPeriodBounds,
  currentLateQuotaPeriodBounds,
  currentYearBangkok,
  eachCalendarYmdInclusive,
  formatPayrollCycleChipTh,
  formatPayrollPeriodRangeTh,
  LATE_MAX_MINUTES,
  LATE_MAX_PER_MONTH,
  listPayrollCycleKeysDescending,
  parsePayrollCycleKey,
  payrollCycleKeyFromBangkokDate,
  PERSONAL_ANNUAL_DAYS,
  SICK_ANNUAL_DAYS,
  sumLeaveDaysInYear,
} from '@/lib/leaveLateRules';
import { supabase } from '@/lib/supabase';
import type {
  AdminEmployeePasswordRow,
  Branch,
  EmployeeDirectory,
  LeaveRequestRow,
  Profile,
  VacationGrantRow,
  WorkScheduleRow,
} from '@/lib/types';

type ProfileSectionKey =
  | 'profile'
  | 'appearance'
  | 'notifications'
  | 'leaveLate'
  | 'hr'
  | 'finance'
  | 'teamDirectory'
  | 'adminDirectory'
  | 'security';

const PROFILE_SECTIONS: Array<{
  key: ProfileSectionKey;
  title: string;
  subtitle: string;
  icon: ComponentProps<typeof FontAwesome>['name'];
  managerOnly?: boolean;
  adminOnly?: boolean;
}> = [
  {
    key: 'profile',
    title: 'โปรไฟล์',
    subtitle: 'รูป ชื่อ เบอร์โทร และสุขภาวะ',
    icon: 'user',
  },
  {
    key: 'appearance',
    title: 'ธีมแอป',
    subtitle: 'เลือกธีมเดิมหรือธีมสว่าง FOLIAGE',
    icon: 'paint-brush',
  },
  {
    key: 'notifications',
    title: 'การแจ้งเตือน',
    subtitle: 'Permission, badge และตั้งค่าแจ้งเตือน',
    icon: 'bell',
  },
  {
    key: 'leaveLate',
    title: 'ลา & เข้าสาย',
    subtitle: 'โควตา ประวัติ KPI และสรุปมาสาย',
    icon: 'calendar-check-o',
  },
  {
    key: 'hr',
    title: 'ข้อมูล HR',
    subtitle: 'ข้อมูลพนักงานจาก employee_directory',
    icon: 'id-card-o',
  },
  {
    key: 'finance',
    title: 'สลิป / เบิกเงิน',
    subtitle: 'สลิปเงินเดือน Claim Salary และ Expense Claim',
    icon: 'money',
  },
  {
    key: 'teamDirectory',
    title: 'พนักงานในสาขา',
    subtitle: 'รายการทีม/สาขาสำหรับผู้จัดการ',
    icon: 'users',
    managerOnly: true,
  },
  {
    key: 'adminDirectory',
    title: 'พนักงานทั้งหมด',
    subtitle: 'รายการ HR สำหรับแอดมิน',
    icon: 'address-book-o',
    adminOnly: true,
  },
  {
    key: 'security',
    title: 'บัญชีและความปลอดภัย',
    subtitle: 'เปลี่ยนรหัสผ่านและออกจากระบบ',
    icon: 'lock',
  },
];

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
  if (type === 'unpaid') return 'ลาไม่รับเงิน';
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

/** แสดงผลต่างนาทีแบบมีเครื่องหมาย (สิทธิ์ขอมาสาย − สายจริง) */
function formatSignedMinutesTh(n: number): string {
  if (n === 0) return '0 นาที';
  const abs = Math.abs(n);
  if (n > 0) return `+${abs} นาที`;
  return `−${abs} นาที`;
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
    const shift = assignment.work_shifts;
    if (!shift) continue;
    assignedDays.add(assignment.work_date);
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

export default function ProfileScreen() {
  const toast = useCuteToast();
  const { profile, refreshProfile, signOut, session } = useAuth();
  const { themeId, theme, setThemeId } = useAppTheme();
  const themeColors = theme.colors;
  const c = themeColors;
  const styles = useMemo(() => createProfileStyles(theme), [theme]);
  const themeStyles = {} as Partial<typeof styles>;
  const role = useRole();
  const router = useRouter();
  const admin = isAdmin(role);
  const managerScope = isManagerOrAdmin(role);
  const { totalHomeBadge } = useTabUnreadBadges();

  const [fullName, setFullName] = useState(profile?.full_name ?? '');
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [activeSection, setActiveSection] = useState<ProfileSectionKey | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarPreviewUri, setAvatarPreviewUri] = useState<string | null>(null);
  const [avatarDraftUri, setAvatarDraftUri] = useState<string | null>(null);
  const [avatarCropOpen, setAvatarCropOpen] = useState(false);
  const [avatarCropSaving, setAvatarCropSaving] = useState(false);
  const [cropSourceW, setCropSourceW] = useState(0);
  const [cropSourceH, setCropSourceH] = useState(0);
  const [cropZoom, setCropZoom] = useState(1);
  const [cropOffsetX, setCropOffsetX] = useState(0);
  const [cropOffsetY, setCropOffsetY] = useState(0);
  const cropZoomRef = useRef(1);
  const cropOffsetXRef = useRef(0);
  const cropOffsetYRef = useRef(0);
  const pinchStartZoomRef = useRef(1);
  const panStartOffsetXRef = useRef(0);
  const panStartOffsetYRef = useRef(0);

  const [myHr, setMyHr] = useState<EmployeeDirectory | null>(null);
  const [dirList, setDirList] = useState<EmployeeDirectory[]>([]);
  const [hrLoading, setHrLoading] = useState(false);
  const [branches, setBranches] = useState<Branch[]>([]);
  /** สำหรับโมดัลแอดมิน: เลือกบัญชี / บทบาท / วันลา */
  const [adminProfilesList, setAdminProfilesList] = useState<Profile[]>([]);

  const [detailEmployee, setDetailEmployee] = useState<EmployeeDirectory | null>(
    null
  );
  const [editEmployeeId, setEditEmployeeId] = useState<string | null>(null);
  const [editPreview, setEditPreview] = useState<AdminEmployeePasswordRow | null>(
    null
  );

  const [leaveRows, setLeaveRows] = useState<LeaveRequestRow[]>([]);
  const [leaveHistoryOpen, setLeaveHistoryOpen] = useState(false);
  const [vacationGrant, setVacationGrant] = useState<VacationGrantRow | null>(
    null
  );
  const [lateThisCycle, setLateThisCycle] = useState(0);
  const [lateMinutesThisCycle, setLateMinutesThisCycle] = useState(0);
  const [latePayrollCycleKey, setLatePayrollCycleKey] = useState(() =>
    payrollCycleKeyFromBangkokDate()
  );
  const [latePayrollRows, setLatePayrollRows] = useState<LateActualFromScheduleRow[]>(
    []
  );
  const [kpiSettings, setKpiSettings] = useState<AttendanceKpiSettings>(
    DEFAULT_ATTENDANCE_KPI_SETTINGS
  );
  const [kpiLateRows, setKpiLateRows] = useState<LateActualFromScheduleRow[]>([]);
  const [kpiWorkStartByYmd, setKpiWorkStartByYmd] = useState<Record<string, string>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [notifPermission, setNotifPermission] = useState<string>('unknown');
  const [notifBadgeSupported, setNotifBadgeSupported] = useState(false);
  const [notifBusy, setNotifBusy] = useState(false);
  const [notifPrefs, setNotifPrefs] = useState({
    task_enabled: true,
    mention_enabled: true,
    checkout_enabled: true,
  });
  const [notifPrefsSavingKey, setNotifPrefsSavingKey] = useState<
    'task_enabled' | 'mention_enabled' | 'checkout_enabled' | null
  >(null);

  useEffect(() => {
    setFullName(profile?.full_name ?? '');
    setPhone(profile?.phone ?? '');
  }, [profile?.full_name, profile?.phone]);

  useEffect(() => {
    cropZoomRef.current = cropZoom;
  }, [cropZoom]);

  useEffect(() => {
    cropOffsetXRef.current = cropOffsetX;
  }, [cropOffsetX]);

  useEffect(() => {
    cropOffsetYRef.current = cropOffsetY;
  }, [cropOffsetY]);

  const loadHr = useCallback(async () => {
    if (!session?.user?.id || !profile) {
      setMyHr(null);
      setDirList([]);
      return;
    }
    setHrLoading(true);
    try {
      const emailNorm = (
        session.user.email ??
        profile.email ??
        ''
      )
        .trim()
        .toLowerCase();

      let hrRow: EmployeeDirectory | null = null;

      if (profile.employee_id) {
        const { data: fromView } = await supabase
          .from('employee_directory')
          .select('*')
          .eq('id', profile.employee_id)
          .maybeSingle();
        if (fromView) {
          hrRow = fromView as EmployeeDirectory;
        } else {
          const { data: fromTable } = await supabase
            .from('employee')
            .select('*')
            .eq('id', profile.employee_id)
            .maybeSingle();
          if (fromTable) {
            hrRow = mapEmployeeTableRowToDirectory(
              fromTable as Record<string, unknown>
            );
          }
        }
      }

      if (!hrRow && emailNorm) {
        const { data: byEmail } = await supabase
          .from('employee_directory')
          .select('*')
          .ilike('legacy_user_id', emailNorm)
          .limit(1)
          .maybeSingle();
        if (byEmail) {
          hrRow = byEmail as EmployeeDirectory;
        } else {
          const { data: rawEmp } = await supabase
            .from('employee')
            .select('*')
            .ilike('UserID', emailNorm)
            .limit(1)
            .maybeSingle();
          if (rawEmp) {
            hrRow = mapEmployeeTableRowToDirectory(
              rawEmp as Record<string, unknown>
            );
          }
        }
      }

      setMyHr(hrRow);

      if (profile.role === 'manager' || profile.role === 'admin') {
        const { data, error } = await supabase
          .from('employee_directory')
          .select('*')
          .order('employee_no', { ascending: true });
        if (error) {
          setDirList([]);
        } else {
          setDirList((data as EmployeeDirectory[]) ?? []);
        }
      } else {
        setDirList([]);
      }
    } finally {
      setHrLoading(false);
    }
  }, [session?.user?.id, profile]);

  useEffect(() => {
    loadHr();
  }, [loadHr]);

  const loadLeaveDash = useCallback(async () => {
    const uid = session?.user?.id;
    if (!uid) {
      setLeaveRows([]);
      setVacationGrant(null);
      setLateThisCycle(0);
      setLateMinutesThisCycle(0);
      setKpiLateRows([]);
      setKpiWorkStartByYmd({});
      return;
    }
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
        .eq('user_id', uid)
        .lte('starts_on', yEnd)
        .gte('ends_on', yStart),
      supabase
        .from('vacation_grants')
        .select('*')
        .eq('user_id', uid)
        .eq('year', y)
        .maybeSingle(),
      supabase
        .from('late_requests')
        .select('minutes_late', { count: 'exact' })
        .eq('user_id', uid)
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
        .eq('user_id', uid)
        .gte('work_date', yStart)
        .lte('work_date', yEnd),
      supabase
        .from('work_schedules')
        .select('id, user_id, start_at, end_at, title')
        .eq('user_id', uid)
        .lte('start_at', yearToIso)
        .gte('end_at', yearFromIso),
      supabase
        .from('attendance_logs')
        .select('created_at')
        .eq('user_id', uid)
        .eq('kind', 'check_in')
        .gte('created_at', yearFromIso)
        .lte('created_at', yearToIso),
      supabase
        .from('late_requests')
        .select('work_date, minutes_late')
        .eq('user_id', uid)
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

    const assignments: AssignmentWithShiftTimes[] = [];
    for (const row of ((asnRes.data as unknown[]) ?? [])) {
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
    if (asnRes.error || legRes.error || logRes.error || lateYearRes.error) {
      setKpiLateRows([]);
      setKpiWorkStartByYmd({});
    } else {
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
    }
  }, [session?.user?.id]);

  useEffect(() => {
    void loadLeaveDash();
  }, [loadLeaveDash]);

  const loadLatePayrollCycle = useCallback(async () => {
    const uid = session?.user?.id;
    if (!uid) {
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
        .eq('user_id', uid)
        .gte('work_date', startYmd)
        .lte('work_date', endYmd),
      supabase
        .from('work_schedules')
        .select('id, user_id, start_at, end_at, title')
        .eq('user_id', uid)
        .lte('start_at', toIso)
        .gte('end_at', fromIso),
      supabase
        .from('attendance_logs')
        .select('created_at')
        .eq('user_id', uid)
        .eq('kind', 'check_in')
        .gte('created_at', fromIso)
        .lte('created_at', toIso),
      supabase
        .from('late_requests')
        .select('work_date, minutes_late')
        .eq('user_id', uid)
        .gte('work_date', startYmd)
        .lte('work_date', endYmd),
    ]);

    if (asnRes.error || legRes.error || logRes.error || lateRes.error) {
      setLatePayrollRows([]);
      return;
    }

    const rawAsn = (asnRes.data as unknown[]) ?? [];
    const assignments: AssignmentWithShiftTimes[] = [];
    for (const row of rawAsn) {
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

    const legacySchedules = (legRes.data as WorkScheduleRow[]) ?? [];
    const checkIns = (logRes.data as { created_at: string }[]) ?? [];
    const lateReqRows =
      (lateRes.data as { work_date: string; minutes_late: number }[]) ?? [];
    const lateRequestMinutesByYmd = lateRequestMinutesByWorkDate(lateReqRows);

    const rows = computeLateFromAttendanceData({
      startYmd,
      endYmd,
      assignments,
      legacySchedules,
      checkIns,
      lateRequestMinutesByYmd,
    });
    setLatePayrollRows(rows);
  }, [session?.user?.id, latePayrollCycleKey]);

  useEffect(() => {
    void loadLatePayrollCycle();
  }, [loadLatePayrollCycle]);

  const reloadBranches = useCallback(async () => {
    if (!admin) {
      setBranches([]);
      return;
    }
    const { data } = await supabase
      .from('branch_information')
      .select('*')
      .order('branch_name');
    setBranches(
      mapBranchInformationRows((data as Record<string, unknown>[]) ?? [])
    );
  }, [admin]);

  const reloadAdminProfiles = useCallback(async () => {
    if (!admin) {
      setAdminProfilesList([]);
      return;
    }
    const { data } = await supabase
      .from('profiles')
      .select(
        'id, email, full_name, role, branch_id, employee_code, phone, employee_id'
      )
      .order('full_name');
    setAdminProfilesList((data as Profile[]) ?? []);
  }, [admin]);

  useEffect(() => {
    void reloadBranches();
  }, [reloadBranches]);

  useEffect(() => {
    void reloadAdminProfiles();
  }, [reloadAdminProfiles]);

  const refreshNotificationStatus = useCallback(async () => {
    try {
      const p = await getNotificationPermissionStatus();
      setNotifPermission(String(p));
      setNotifBadgeSupported(isBadgeApiSupported());
    } catch {
      setNotifPermission('unknown');
      setNotifBadgeSupported(false);
    }
  }, []);

  const loadNotificationPrefs = useCallback(async () => {
    const uid = session?.user?.id;
    if (!uid) return;
    const { data, error } = await supabase
      .from('notification_preferences')
      .select('task_enabled,mention_enabled,checkout_enabled')
      .eq('user_id', uid)
      .maybeSingle();
    if (error) return;
    setNotifPrefs({
      task_enabled: (data as { task_enabled?: boolean } | null)?.task_enabled ?? true,
      mention_enabled: (data as { mention_enabled?: boolean } | null)?.mention_enabled ?? true,
      checkout_enabled: (data as { checkout_enabled?: boolean } | null)?.checkout_enabled ?? true,
    });
  }, [session?.user?.id]);

  useEffect(() => {
    void refreshNotificationStatus();
  }, [refreshNotificationStatus]);

  useEffect(() => {
    void loadNotificationPrefs();
  }, [loadNotificationPrefs]);

  const onPullRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        refreshProfile(),
        loadLeaveDash(),
        loadLatePayrollCycle(),
        loadHr(),
        reloadBranches(),
        reloadAdminProfiles(),
        refreshNotificationStatus(),
        loadNotificationPrefs(),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [
    refreshProfile,
    loadLeaveDash,
    loadLatePayrollCycle,
    loadHr,
    reloadBranches,
    reloadAdminProfiles,
    refreshNotificationStatus,
    loadNotificationPrefs,
  ]);

  async function setNotificationPref(
    key: 'task_enabled' | 'mention_enabled' | 'checkout_enabled',
    value: boolean
  ) {
    const uid = session?.user?.id;
    if (!uid) return;
    const nextPrefs = {
      ...notifPrefs,
      [key]: value,
    };
    setNotifPrefs(nextPrefs);
    setNotifPrefsSavingKey(key);
    const payload = {
      user_id: uid,
      task_enabled: nextPrefs.task_enabled,
      mention_enabled: nextPrefs.mention_enabled,
      checkout_enabled: nextPrefs.checkout_enabled,
    };
    const { error } = await supabase
      .from('notification_preferences')
      .upsert(payload, { onConflict: 'user_id' });
    setNotifPrefsSavingKey(null);
    if (error) {
      setNotifPrefs((prev) => ({ ...prev, [key]: !value }));
      toast.error('บันทึกการแจ้งเตือนไม่สำเร็จ', error.message);
      return;
    }
    toast.success('บันทึกแล้ว', 'อัปเดตการตั้งค่าการแจ้งเตือนเรียบร้อย');
  }

  async function requestNotifAgain() {
    const uid = session?.user?.id;
    if (!uid) return;
    setNotifBusy(true);
    try {
      const ok = await requestNotificationPermissions();
      if (ok && Platform.OS === 'web') {
        const subscribed = await registerWebPushSubscription(uid);
        if (subscribed) {
          toast.success('การแจ้งเตือน', 'อนุญาตแล้ว และสมัคร Web Push เรียบร้อย');
        } else {
          toast.info(
            'การแจ้งเตือน',
            'อนุญาตแล้ว แต่สมัคร Web Push ไม่สำเร็จ (ตรวจค่า EXPO_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY และเปิดจาก PWA บนโดเมน https)'
          );
        }
      } else if (ok) {
        const token = await registerAndSavePushToken(async () => {});
        if (token) {
          await supabase.from('profiles').update({ expo_push_token: token }).eq('id', uid);
          toast.success('การแจ้งเตือน', 'อนุญาตแล้ว และอัปเดต token เรียบร้อย');
        } else {
          await supabase.from('profiles').update({ expo_push_token: null }).eq('id', uid);
          toast.info(
            'การแจ้งเตือน',
            'อนุญาตแล้ว แต่ยังไม่ได้ Expo push token (ให้เปิดผ่าน Dev Build/TestFlight และตั้งค่า EAS projectId)'
          );
        }
      } else {
        toast.info('การแจ้งเตือน', 'ยังไม่ได้อนุญาต (ตรวจสอบที่ Settings เครื่อง)');
      }
    } catch (e) {
      toast.error(
        'การแจ้งเตือน',
        e instanceof Error ? e.message : 'ขอสิทธิ์ไม่สำเร็จ'
      );
    } finally {
      await refreshNotificationStatus();
      setNotifBusy(false);
    }
  }

  async function saveProfile() {
    if (!session?.user?.id) return;
    const { error } = await supabase
      .from('profiles')
      .update({
        full_name: fullName.trim() || null,
        phone: phone.trim() || null,
      })
      .eq('id', session.user.id);
    if (error) {
      toast.error('บันทึกไม่สำเร็จ', error.message);
      return;
    }
    await refreshProfile();
    toast.success('อัปเดตโปรไฟล์แล้ว', 'ข้อมูลโปรไฟล์ถูกบันทึกแล้ว 🌱');
  }

  async function onChangeAvatar() {
    if (uploadingAvatar || avatarCropSaving) return;
    setUploadingAvatar(true);
    try {
      const picked = await pickAvatarFromLibrary();
      const w = picked.width ?? 1024;
      const h = picked.height ?? 1024;
      setAvatarDraftUri(picked.uri);
      setCropSourceW(w);
      setCropSourceH(h);
      setCropZoom(1);
      setCropOffsetX(0);
      setCropOffsetY(0);
      setAvatarCropOpen(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'ไม่ทราบสาเหตุ';
      if (msg === 'ยกเลิกการเลือกรูป') return;
      toast.error('รูปโปรไฟล์', msg);
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function saveCroppedAvatar() {
    const uid = session?.user?.id;
    if (!uid || !avatarDraftUri || cropSourceW <= 0 || cropSourceH <= 0) return;
    setAvatarCropSaving(true);
    try {
      const frame = 260;
      const baseScale = Math.max(frame / cropSourceW, frame / cropSourceH);
      const scaledW = cropSourceW * baseScale * cropZoom;
      const scaledH = cropSourceH * baseScale * cropZoom;
      const maxX = Math.max(0, (scaledW - frame) / 2);
      const maxY = Math.max(0, (scaledH - frame) / 2);
      const safeX = Math.min(maxX, Math.max(-maxX, cropOffsetX));
      const safeY = Math.min(maxY, Math.max(-maxY, cropOffsetY));
      const cropSide = frame / (baseScale * cropZoom);
      const centerX = cropSourceW / 2 - safeX / (baseScale * cropZoom);
      const centerY = cropSourceH / 2 - safeY / (baseScale * cropZoom);
      const originX = Math.max(0, Math.min(cropSourceW - cropSide, centerX - cropSide / 2));
      const originY = Math.max(0, Math.min(cropSourceH - cropSide, centerY - cropSide / 2));

      const result = await ImageManipulator.manipulateAsync(
        avatarDraftUri,
        [
          {
            crop: {
              originX: Math.round(originX),
              originY: Math.round(originY),
              width: Math.round(cropSide),
              height: Math.round(cropSide),
            },
          },
          {
            resize: { width: 512, height: 512 },
          },
        ],
        {
          compress: 0.9,
          format: ImageManipulator.SaveFormat.JPEG,
        }
      );

      const url = await uploadAvatarUri(uid, result.uri);
      setAvatarPreviewUri(url);
      const { error } = await supabase
        .from('profiles')
        .update({ avatar_url: url })
        .eq('id', uid);
      if (error) throw new Error(error.message);
      await refreshProfile();
      setAvatarCropOpen(false);
      setAvatarDraftUri(null);
      toast.success('อัปเดตรูปโปรไฟล์แล้ว', 'รูปใหม่พร้อมใช้งานแล้ว ✨');
    } catch (e) {
      toast.error('รูปโปรไฟล์', e instanceof Error ? e.message : 'ครอปหรืออัปโหลดไม่สำเร็จ');
    } finally {
      setAvatarCropSaving(false);
    }
  }

  async function changePassword() {
    if (!pw1 || pw1.length < 6) {
      toast.info('รหัสผ่าน', 'กรุณากรอกรหัสผ่านอย่างน้อย 6 ตัวอักษร');
      return;
    }
    if (pw1 !== pw2) {
      toast.info('รหัสผ่าน', 'ยืนยันรหัสผ่านไม่ตรงกัน');
      return;
    }
    const { error } = await supabase.auth.updateUser({ password: pw1 });
    if (error) {
      toast.error('เปลี่ยนรหัสไม่สำเร็จ', error.message);
      return;
    }
    setPw1('');
    setPw2('');
    setShowPw(false);
    toast.success('เปลี่ยนรหัสผ่านแล้ว', 'บัญชีของคุณอัปเดตแล้ว 🔐');
  }

  async function logout() {
    await signOut();
    router.replace('/login');
  }

  const avatarLabel =
    profile?.full_name || profile?.email || session?.user?.email || '?';
  const avatarUriForDisplay = avatarPreviewUri ?? profile?.avatar_url ?? null;
  const cropFrame = 260;
  const cropBaseScale =
    cropSourceW > 0 && cropSourceH > 0
      ? Math.max(cropFrame / cropSourceW, cropFrame / cropSourceH)
      : 1;
  const cropPreviewW = cropSourceW * cropBaseScale * cropZoom;
  const cropPreviewH = cropSourceH * cropBaseScale * cropZoom;

  function clampCropOffset(x: number, y: number, zoomLevel: number) {
    // Free-pan mode: do not clamp while dragging.
    // Final crop step still clamps safely before writing output.
    void zoomLevel;
    return { x, y };
  }

  const handleCropWheel = useCallback(
    (evt: unknown) => {
      if (Platform.OS !== 'web' || avatarCropSaving) return;
      const e = evt as {
        preventDefault?: () => void;
        nativeEvent?: { deltaY?: number };
      };
      e.preventDefault?.();
      const deltaY = e.nativeEvent?.deltaY ?? 0;
      if (!Number.isFinite(deltaY) || deltaY === 0) return;

      const step = deltaY < 0 ? 0.08 : -0.08;
      const nextZoom = Math.max(1, Math.min(3, Number((cropZoom + step).toFixed(3))));
      const clamped = clampCropOffset(cropOffsetX, cropOffsetY, nextZoom);
      setCropZoom(nextZoom);
      setCropOffsetX(clamped.x);
      setCropOffsetY(clamped.y);
    },
    [avatarCropSaving, cropOffsetX, cropOffsetY, cropZoom]
  );

  const cropPanGesture = Gesture.Pan()
    .enabled(!avatarCropSaving)
    .runOnJS(true)
    .onBegin(() => {
      panStartOffsetXRef.current = cropOffsetXRef.current;
      panStartOffsetYRef.current = cropOffsetYRef.current;
    })
    .onUpdate((e) => {
      const nextX = panStartOffsetXRef.current + e.translationX;
      const nextY = panStartOffsetYRef.current + e.translationY;
      const clamped = clampCropOffset(nextX, nextY, cropZoomRef.current);
      setCropOffsetX(clamped.x);
      setCropOffsetY(clamped.y);
    });

  const cropPinchGesture = Gesture.Pinch()
    .enabled(!avatarCropSaving)
    .runOnJS(true)
    .onBegin(() => {
      pinchStartZoomRef.current = cropZoomRef.current;
    })
    .onUpdate((e: { scale: number }) => {
      const nextZoom = Math.max(
        1,
        Math.min(3, Number((pinchStartZoomRef.current * e.scale).toFixed(3)))
      );
      const clamped = clampCropOffset(cropOffsetXRef.current, cropOffsetYRef.current, nextZoom);
      setCropZoom(nextZoom);
      setCropOffsetX(clamped.x);
      setCropOffsetY(clamped.y);
    });

  const cropGesture = Gesture.Simultaneous(cropPanGesture, cropPinchGesture);

  const quotaY = currentYearBangkok();
  const sickUsed = sumLeaveDaysInYear(leaveRows, quotaY, 'sick');
  const personalUsed = sumLeaveDaysInYear(leaveRows, quotaY, 'personal');
  const vacationUsed = sumLeaveDaysInYear(leaveRows, quotaY, 'vacation');
  const sickGrant = vacationGrant?.sick_days_granted ?? SICK_ANNUAL_DAYS;
  const personalGrant = vacationGrant?.personal_days_granted ?? PERSONAL_ANNUAL_DAYS;
  const vacGrant = vacationGrant?.days_granted ?? 0;
  const sickLeft = Math.max(0, sickGrant - sickUsed);
  const personalLeft = Math.max(0, personalGrant - personalUsed);
  const vacationLeft = Math.max(0, vacGrant - vacationUsed);

  function barPct(used: number, cap: number): number {
    if (cap <= 0) return 0;
    return Math.min(100, Math.round((used / cap) * 1000) / 10);
  }
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

  const payrollCycleOptions = useMemo(
    () => listPayrollCycleKeysDescending(15),
    [refreshing]
  );

  const latePayrollBounds = useMemo(() => {
    const p = parsePayrollCycleKey(latePayrollCycleKey);
    if (!p) return { startYmd: '', endYmd: '' };
    return bangkokPayrollPeriodBounds(p.y, p.m);
  }, [latePayrollCycleKey]);

  const latePayrollSummary = useMemo(() => {
    let minutes = 0;
    for (const r of latePayrollRows) {
      minutes += Number(r.minutes_late) || 0;
    }
    return { count: latePayrollRows.length, minutes };
  }, [latePayrollRows]);

  const visibleProfileSections = useMemo(
    () =>
      PROFILE_SECTIONS.filter((section) => {
        if (section.adminOnly) return admin;
        if (section.managerOnly) return profile?.role === 'manager';
        return true;
      }),
    [admin, profile?.role]
  );

  const activeSectionMeta = useMemo(
    () => visibleProfileSections.find((section) => section.key === activeSection) ?? null,
    [activeSection, visibleProfileSections]
  );

  const payslipEmployeeName = useMemo(
    () =>
      myHr
        ? directoryDisplayName(myHr)
        : profile?.full_name?.trim() || profile?.email?.trim() || session?.user?.email || '',
    [myHr, profile?.email, profile?.full_name, session?.user?.email]
  );

  const payslipEmployeeMeta = useMemo(() => {
    const parts = [
      profile?.email ?? session?.user?.email ?? '',
      myHr?.employee_no != null ? `รหัส ${myHr.employee_no}` : profile?.employee_code ? `รหัส ${profile.employee_code}` : '',
      myHr?.position ?? '',
      myHr?.branch ?? '',
    ]
      .map((part) => String(part).trim())
      .filter(Boolean);
    return parts.join(' · ');
  }, [myHr, profile?.email, profile?.employee_code, session?.user?.email]);

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
  const currentQuarterIndex = Math.min(3, Math.max(0, Math.floor((new Date().getMonth()) / 3)));
  const currentQuarterKpi = attendanceKpi.quarters[currentQuarterIndex] ?? attendanceKpi.quarters[0];

  return (
    <>
      <ScrollView
        style={[styles.screen, themeStyles?.screen]}
        contentContainerStyle={styles.screenContent}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onPullRefresh}
            tintColor={themeColors.primary}
            colors={[themeColors.primary]}
            title="ดึงลงเพื่อรีเฟรช"
            titleColor={themeColors.textMuted}
          />
        }>
        {activeSection === null ? (
          <>
            <View style={[styles.profileMenuHero, themeStyles?.profileMenuHero]}>
              <View style={styles.profileMenuHeroTop}>
                <UserAvatar
                  uri={avatarUriForDisplay}
                  label={avatarLabel}
                  size={64}
                />
                <View style={styles.profileMenuHeroText}>
                  <Text style={[styles.profileMenuHeroTitle, themeStyles?.profileMenuHeroTitle]} numberOfLines={1}>
                    {fullName.trim() || profile?.full_name || profile?.email || 'โปรไฟล์'}
                  </Text>
                  <Text style={[styles.profileMenuHeroSub, themeStyles?.profileMenuHeroSub]} numberOfLines={1}>
                    {profile?.email ?? session?.user?.email ?? 'ยังไม่มีอีเมล'}
                  </Text>
                  <Text style={[styles.profileMenuHeroRole, themeStyles?.profileMenuHeroRole]}>
                    {profile?.role ?? 'employee'}
                  </Text>
                </View>
              </View>
              <Text style={[styles.profileMenuHeroHint, themeStyles?.profileMenuHeroHint]}>
                เลือกหมวดที่ต้องการจัดการ เพื่อเปิดรายละเอียดเฉพาะส่วนนั้น
              </Text>
            </View>

            <View style={styles.profileMenuGrid}>
              {visibleProfileSections.map((section) => (
                <Pressable
                  key={section.key}
                  style={[styles.profileMenuCard, themeStyles?.profileMenuCard]}
                  onPress={() => setActiveSection(section.key)}>
                  <View style={[styles.profileMenuIcon, themeStyles?.profileMenuIcon]}>
                    <FontAwesome name={section.icon} size={22} color={themeColors.primaryDark} />
                  </View>
                  <Text style={[styles.profileMenuTitle, themeStyles?.profileMenuTitle]}>{section.title}</Text>
                  <Text style={[styles.profileMenuSub, themeStyles?.profileMenuSub]}>{section.subtitle}</Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : (
          <>
            {activeSectionMeta ? (
              <View style={[styles.profileSectionHeader, themeStyles?.profileSectionHeader]}>
                <Pressable
                  style={[styles.profileBackBtn, themeStyles?.profileBackBtn]}
                  onPress={() => setActiveSection(null)}>
                  <FontAwesome name="chevron-left" size={13} color={themeColors.primaryDark} />
                  <Text style={[styles.profileBackBtnText, themeStyles?.profileBackBtnText]}>กลับสู่เมนูโปรไฟล์</Text>
                </Pressable>
                <View style={styles.profileSectionTitleRow}>
                  <View style={[styles.profileSectionIcon, themeStyles?.profileSectionIcon]}>
                    <FontAwesome name={activeSectionMeta.icon} size={20} color={themeColors.onAccent} />
                  </View>
                  <View style={styles.profileSectionTitleText}>
                    <Text style={[styles.profileSectionTitle, themeStyles?.profileSectionTitle]}>{activeSectionMeta.title}</Text>
                    <Text style={[styles.profileSectionSub, themeStyles?.profileSectionSub]}>{activeSectionMeta.subtitle}</Text>
                  </View>
                </View>
              </View>
            ) : null}

        {activeSection === 'profile' ? (
          <>
        <View style={styles.avatarRow}>
          <UserAvatar
            uri={avatarUriForDisplay}
            label={avatarLabel}
            size={88}
          />
          <View style={styles.avatarActions}>
            <Pressable
              style={[styles.avatarBtn, uploadingAvatar && styles.disabled]}
              onPress={onChangeAvatar}
              disabled={uploadingAvatar}>
              {uploadingAvatar ? (
                <ActivityIndicator color={c.primary} />
              ) : (
                <Text style={styles.avatarBtnText}>เปลี่ยนรูปโปรไฟล์</Text>
              )}
            </Pressable>
            <Text style={styles.avatarHint}>
              แสดงในหน้าเข้า-ออกงาน แชท และคอมมูนิตี้
            </Text>
          </View>
        </View>

        <Text style={styles.label}>อีเมล</Text>
        <Text style={styles.readonly}>
          {profile?.email ?? session?.user?.email}
        </Text>
        <Text style={styles.label}>บทบาท</Text>
        <Text style={styles.readonly}>{profile?.role ?? '—'}</Text>

        <Text style={styles.label}>ชื่อ-นามสกุล (แสดงในแอป)</Text>
        <TextInput
          style={styles.input}
          value={fullName}
          onChangeText={setFullName}
          placeholder="ชื่อที่แสดงในแอป"
        />
        <Text style={styles.label}>เบอร์โทร</Text>
        <TextInput
          style={styles.input}
          value={phone}
          onChangeText={setPhone}
          placeholder="เบอร์ติดต่อ"
          keyboardType="phone-pad"
        />
        <Pressable style={styles.primary} onPress={saveProfile}>
          <Text style={styles.primaryText}>บันทึกโปรไฟล์</Text>
        </Pressable>

        <Pressable
          style={styles.wellbeingNav}
          onPress={() => router.push('/wellbeing')}>
          <Text style={styles.wellbeingNavText}>
            สุขภาวะทางใจ — กราฟรายสัปดาห์ / รายเดือน
          </Text>
          <Text style={styles.wellbeingNavHint}>
            จากคำตอบตอนเข้า-ออกงาน
          </Text>
        </Pressable>
          </>
        ) : null}

        {activeSection === 'appearance' ? (
          <>
            <Text style={[styles.sectionTitle, themeStyles?.sectionTitle]}>ธีมแอป</Text>
            <Text style={[styles.themeSettingsSub, themeStyles?.themeSettingsSub]}>
              ธีมสว่างใช้พื้นหลังขาวและเขียว FOLIAGE ตามภาพแบรนด์ ส่วนธีมเดิมจะคงโทน Premium Dark เดิมของแอป
            </Text>
            <View style={styles.themeChoiceGrid}>
              {[
                {
                  id: 'classicDark' as const,
                  title: 'ธีมเดิม',
                  subtitle: 'Premium Dark · เขียวมะกอก / ทอง',
                  swatches: ['#121212', '#252525', '#A6B874'],
                },
                {
                  id: 'foliageLight' as const,
                  title: 'ธีมสว่าง FOLIAGE',
                  subtitle: 'พื้นหลังขาว · เขียวอ่อนตามภาพ',
                  swatches: ['#FFFFFF', '#F1F5DF', '#AFC25A'],
                },
              ].map((option) => {
                const selected = themeId === option.id;
                return (
                  <Pressable
                    key={option.id}
                    style={[
                      styles.themeChoiceCard,
                      themeStyles?.themeChoiceCard,
                      selected && {
                        backgroundColor: themeColors.primaryLight,
                        borderColor: themeColors.primary,
                      },
                    ]}
                    onPress={() => {
                      void setThemeId(option.id).then(() => {
                        toast.success('เปลี่ยนธีมแล้ว', `เลือก ${option.title} เรียบร้อย`);
                      });
                    }}>
                    <View style={styles.themeChoiceTopRow}>
                      <View style={styles.themeSwatchRow}>
                        {option.swatches.map((swatch) => (
                          <View
                            key={swatch}
                            style={[styles.themeSwatch, { backgroundColor: swatch }]}
                          />
                        ))}
                      </View>
                      {selected ? (
                        <FontAwesome name="check-circle" size={20} color={themeColors.primaryDark} />
                      ) : null}
                    </View>
                    <Text style={[styles.themeChoiceTitle, themeStyles?.themeChoiceTitle]}>{option.title}</Text>
                    <Text style={[styles.themeChoiceSub, themeStyles?.themeChoiceSub]}>{option.subtitle}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={[styles.themeSettingsHint, themeStyles?.themeSettingsHint]}>
              ธีมสว่าง FOLIAGE ถูกใช้เป็นฐานสีของทั้งแอปแล้ว รวมถึง header, tabbar, loading screen, ตาราง และ popup หลัก
            </Text>
          </>
        ) : null}

        {activeSection === 'notifications' ? (
          <>
        <Text style={[styles.sectionTitle, themeStyles?.sectionTitle]}>สถานะแจ้งเตือน</Text>
        <Text style={[styles.sectionSub, themeStyles?.sectionSub]}>
          ตรวจสอบ permission, ความสามารถ badge และขอสิทธิ์ใหม่ได้ทันที
        </Text>
        <View style={styles.hrCard}>
          <View style={styles.hrRow}>
            <Text style={styles.hrKey}>Permission</Text>
            <Text style={styles.hrVal}>{notifPermission}</Text>
          </View>
          <View style={styles.hrRow}>
            <Text style={styles.hrKey}>Badge API</Text>
            <Text style={styles.hrVal}>
              {notifBadgeSupported ? 'รองรับ' : 'ไม่รองรับ'}
            </Text>
          </View>
          <View style={styles.hrRow}>
            <Text style={styles.hrKey}>Badge รวมตอนนี้</Text>
            <Text style={styles.hrVal}>{totalHomeBadge}</Text>
          </View>
          <Pressable
            style={[styles.primary, notifBusy && styles.disabled]}
            onPress={requestNotifAgain}
            disabled={notifBusy}>
            {notifBusy ? (
              <ActivityIndicator color={c.onAccent} />
            ) : (
              <Text style={styles.primaryText}>ขอสิทธิ์อีกครั้ง</Text>
            )}
          </Pressable>
          <View style={styles.notifPrefRow}>
            <View style={styles.notifPrefTextWrap}>
              <Text style={styles.notifPrefTitle}>แจ้งเตือนงานที่ถูกมอบหมาย</Text>
              <Text style={styles.notifPrefHint}>เมื่อมีการแอดงานหรืออัปเดตงานที่เกี่ยวข้อง</Text>
            </View>
            <Switch
              value={notifPrefs.task_enabled}
              onValueChange={(v) => void setNotificationPref('task_enabled', v)}
              disabled={notifPrefsSavingKey !== null}
            />
          </View>
          <View style={styles.notifPrefRow}>
            <View style={styles.notifPrefTextWrap}>
              <Text style={styles.notifPrefTitle}>แจ้งเตือนเมื่อถูกกล่าวถึง</Text>
              <Text style={styles.notifPrefHint}>เมื่อมีคน @ ในแชทเข้า-ออกงาน</Text>
            </View>
            <Switch
              value={notifPrefs.mention_enabled}
              onValueChange={(v) => void setNotificationPref('mention_enabled', v)}
              disabled={notifPrefsSavingKey !== null}
            />
          </View>
          <View style={styles.notifPrefRowNoBorder}>
            <View style={styles.notifPrefTextWrap}>
              <Text style={styles.notifPrefTitle}>แจ้งเตือนออกงาน</Text>
              <Text style={styles.notifPrefHint}>เตือนเมื่อถึงเวลา/เลยเวลาออกงาน</Text>
            </View>
            <Switch
              value={notifPrefs.checkout_enabled}
              onValueChange={(v) => void setNotificationPref('checkout_enabled', v)}
              disabled={notifPrefsSavingKey !== null}
            />
          </View>
        </View>
          </>
        ) : null}

        {activeSection === 'leaveLate' ? (
          <>
        <Text style={[styles.sectionTitle, themeStyles?.sectionTitle]}>ลา & เข้าสาย</Text>
        <Text style={[styles.sectionSub, themeStyles?.sectionSub]}>
          สรุปโควตาปี {quotaY} · นับวันลาเฉพาะที่อนุมัติแล้ว · ขอเข้าสายจำกัดตามรอบ 26–25
          — สรุปเวลาสายตามรอบ 26–25 อยู่ด้านล่าง
        </Text>
        <View style={styles.leaveDashCard}>
          <View style={styles.leaveDashCardHeader}>
            <Text style={styles.leaveDashCardTitle}>สรุปการใช้สิทธิ</Text>
            <Text style={styles.leaveDashCardHint}>ปี {quotaY}</Text>
          </View>

          <View style={styles.quotaRow}>
            <View
              style={[styles.quotaAccent, { backgroundColor: c.lateNoticeBar }]}
            />
            <View style={styles.quotaMain}>
              <View style={styles.quotaTitleRow}>
                <Text style={styles.quotaLabel}>ขอเข้าสาย</Text>
                <Text style={styles.quotaValue}>
                  {lateThisCycle} / {LATE_MAX_PER_MONTH} ครั้ง ·{' '}
                  {lateMinutesThisCycle} / {LATE_MAX_MINUTES} นาที
                </Text>
              </View>
              <Text style={styles.quotaSub}>
                รอบปัจจุบัน 26–25 (ยึดอย่างใดอย่างหนึ่งถึงก่อน)
              </Text>
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
            <View
              style={[styles.quotaAccent, { backgroundColor: c.leaveSickBar }]}
            />
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
            <View
              style={[styles.quotaAccent, { backgroundColor: c.primary }]}
            />
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
            <View
              style={[styles.quotaAccent, { backgroundColor: c.accentWarm }]}
            />
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
            leaveHistoryPreview.map((row) => {
              const tone = leaveStatusTone(row.status);
              return (
                <View key={row.id} style={styles.leaveHistoryRow}>
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
                    <Text style={styles.leaveHistoryReason} numberOfLines={2}>
                      {row.reason?.trim() || row.supplementary_note?.trim() || 'ไม่ระบุเหตุผล'}
                    </Text>
                    <Text style={styles.leaveHistoryCreated}>
                      ส่งคำขอ {formatCreatedAtTh(row.created_at)}
                    </Text>
                    {row.is_kpi_exempt ? (
                      <Text style={styles.leaveHistoryAttach}>ปรับโดยแอดมิน/HR · ไม่นับ KPI</Text>
                    ) : null}
                  </View>
                </View>
              );
            })
          )}
          {leaveHistoryRows.length > leaveHistoryPreview.length ? (
            <Text style={styles.leaveHistoryMore}>
              และอีก {leaveHistoryRows.length - leaveHistoryPreview.length} รายการ กดดูทั้งหมดเพื่อดูประวัติครบ
            </Text>
          ) : null}
        </View>

        <LateRequestHistoryCard userId={session?.user?.id} />

        <View style={styles.kpiCard}>
          <View style={styles.kpiHeaderRow}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.kpiTitle}>KPI การลา / ขอเข้าสาย</Text>
              <Text style={styles.kpiSub}>
                คะแนนเต็ม {currentQuarterKpi.maxScore} คะแนนต่อไตรมาส · ภาพรวมปี {quotaY}
              </Text>
            </View>
            <View style={styles.kpiScoreBadge}>
              <Text style={styles.kpiScoreMain}>
                {currentQuarterKpi.totalScore.toFixed(1)}
              </Text>
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
          {[...currentQuarterKpi.leaveDeductions, ...currentQuarterKpi.lateDeductions].length > 0 ? (
            <View style={styles.kpiDeductionsBox}>
              <Text style={styles.kpiDeductionsTitle}>รายการหักคะแนนไตรมาสนี้</Text>
              {[...currentQuarterKpi.leaveDeductions, ...currentQuarterKpi.lateDeductions]
                .slice(0, 5)
                .map((d, idx) => (
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
              {formatPayrollPeriodRangeTh(
                latePayrollBounds.startYmd,
                latePayrollBounds.endYmd
              )}
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
                  {r.source === 'assignment' ? 'กะมอบหมาย' : 'ตารางงาน'} · {r.plan_label ?? '—'}
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
                  สายจริง {r.actual_late_minutes} นาที · สิทธิ์ − สายจริง:{' '}
                  {formatSignedMinutesTh(r.rights_minus_actual_minutes)}
                </Text>
              </View>
            ))
          )}
        </View>
          </>
        ) : null}

        {activeSection === 'hr' ? (
          <>
        <Text style={[styles.sectionTitle, themeStyles?.sectionTitle]}>ข้อมูลพนักงาน (HR)</Text>
        <Text style={[styles.sectionSub, themeStyles?.sectionSub]}>
          ข้อมูลพนักงานพื้นฐานจากระบบ HR
        </Text>
        {hrLoading ? (
          <ActivityIndicator
            style={{ marginVertical: 16 }}
            color={c.primary}
          />
        ) : !profile?.employee_id ? (
          <Text style={styles.muted}>
            ยังไม่ได้เชื่อมรหัสพนักงานในระบบ HR — ให้แอดมินตั้งค่า{' '}
            <Text style={styles.mono}>profiles.employee_id</Text> ให้ตรงกับแถวใน
            ตาราง employee
          </Text>
        ) : myHr ? (
          <View style={styles.hrCard}>
            <Text style={styles.hrName}>{directoryDisplayName(myHr)}</Text>
            {HR_DIRECTORY_FIELDS.map(({ key, label }) => (
              <View key={key} style={styles.hrRow}>
                <Text style={styles.hrKey}>{label}</Text>
                <Text style={styles.hrVal}>{formatDirectoryValue(myHr, key)}</Text>
              </View>
            ))}
          </View>
        ) : (
          <Text style={styles.muted}>
            ไม่พบข้อมูล HR สำหรับรหัสนี้ หรือสิทธิ์การอ่านถูกจำกัด
          </Text>
        )}
          </>
        ) : null}

        {activeSection === 'finance' ? (
          <>
        <ProfilePayslipCard
          userId={session?.user?.id ?? null}
          employeeId={profile?.employee_id ?? null}
          employeeName={payslipEmployeeName}
          employeeMeta={payslipEmployeeMeta}
          paymentMethod={myHr?.bank || myHr?.account_number ? 'โอนผ่านบัญชีธนาคาร' : null}
          bankName={myHr?.bank ?? null}
          bankAccount={myHr?.account_number ?? null}
        />

        <ProfileClaimsCard
          userId={session?.user?.id ?? null}
          profile={profile ?? null}
          myHr={myHr}
          onSubmitted={() => {
            void onPullRefresh();
          }}
        />
          </>
        ) : null}

        {activeSection === 'teamDirectory' && managerScope && profile?.role === 'manager' ? (
          <>
            <Text style={[styles.sectionTitle, themeStyles?.sectionTitle]}>พนักงานในสาขา</Text>
            <Text style={[styles.sectionSub, themeStyles?.sectionSub]}>
              แสดงเฉพาะพนักงานที่อยู่สาขาเดียวกับคุณ (ตามสิทธิ์ระบบ)
            </Text>
            {dirList.map((row) => (
              <Pressable
                key={row.id}
                style={styles.listRow}
                onPress={() => setDetailEmployee(row)}>
                <Text style={styles.listTitle}>{directoryDisplayName(row)}</Text>
                <Text style={styles.listMeta}>
                  {row.position ?? '—'} · {row.branch ?? '—'}
                </Text>
              </Pressable>
            ))}
            {dirList.length === 0 && !hrLoading ? (
              <Text style={styles.muted}>ไม่มีรายการในสาขา</Text>
            ) : null}
          </>
        ) : null}

        {activeSection === 'adminDirectory' && admin ? (
          <>
            <Text style={[styles.sectionTitle, themeStyles?.sectionTitle]}>พนักงานทั้งหมด (แอดมิน)</Text>
            <Text style={[styles.sectionSub, themeStyles?.sectionSub]}>
              แตะรายการเพื่อแก้ไขข้อมูล HR / รหัส legacy
            </Text>
            {dirList.map((row) => (
              <Pressable
                key={row.id}
                style={styles.listRow}
                onPress={() => {
                  setEditEmployeeId(row.id);
                  setEditPreview(directoryToAdminPreview(row));
                }}>
                <Text style={styles.listTitle}>{directoryDisplayName(row)}</Text>
                <Text style={styles.listMeta}>
                  #{row.employee_no ?? '—'} · {row.branch ?? '—'}
                </Text>
              </Pressable>
            ))}
            {dirList.length === 0 && !hrLoading ? (
              <Text style={styles.muted}>ไม่มีข้อมูล employee_directory</Text>
            ) : null}
          </>
        ) : null}

        {activeSection === 'security' ? (
          <>
        <Pressable style={styles.secondary} onPress={() => setShowPw((v) => !v)}>
          <Text style={styles.secondaryText}>
            {showPw ? 'ปิดการเปลี่ยนรหัส' : 'เปลี่ยนรหัสผ่าน'}
          </Text>
        </Pressable>

        {showPw && (
          <View style={styles.box}>
            <TextInput
              style={styles.input}
              placeholder="รหัสผ่านใหม่"
              secureTextEntry
              value={pw1}
              onChangeText={setPw1}
            />
            <TextInput
              style={styles.input}
              placeholder="ยืนยันรหัสผ่าน"
              secureTextEntry
              value={pw2}
              onChangeText={setPw2}
            />
            <Pressable style={styles.primary} onPress={changePassword}>
              <Text style={styles.primaryText}>ยืนยันเปลี่ยนรหัส</Text>
            </Pressable>
          </View>
        )}

        <Pressable style={styles.logout} onPress={logout}>
          <Text style={styles.logoutText}>ออกจากระบบ</Text>
        </Pressable>
          </>
        ) : null}
          </>
        )}
      </ScrollView>

      <Modal
        visible={detailEmployee !== null}
        animationType="slide"
        transparent
        onRequestClose={() => setDetailEmployee(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>ข้อมูลพนักงาน</Text>
            <ScrollView style={styles.modalScroll}>
              {detailEmployee
                ? HR_DIRECTORY_FIELDS.map(({ key, label }) => (
                    <View key={key} style={styles.hrRow}>
                      <Text style={styles.hrKey}>{label}</Text>
                      <Text style={styles.hrVal}>
                        {formatDirectoryValue(detailEmployee, key)}
                      </Text>
                    </View>
                  ))
                : null}
            </ScrollView>
            <Pressable
              style={styles.modalClose}
              onPress={() => setDetailEmployee(null)}>
              <Text style={styles.modalCloseText}>ปิด</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        visible={leaveHistoryOpen}
        animationType="slide"
        transparent
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
                leaveHistoryRows.map((row) => {
                  const tone = leaveStatusTone(row.status);
                  return (
                    <View key={`modal-${row.id}`} style={styles.leaveHistoryRow}>
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
                          <Text style={styles.leaveHistoryType}>
                            {leaveTypeLabelTh(row.leave_type)}
                          </Text>
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
                        <Text style={styles.leaveHistoryReason}>
                          {row.reason?.trim() || row.supplementary_note?.trim() || 'ไม่ระบุเหตุผล'}
                        </Text>
                        <Text style={styles.leaveHistoryCreated}>
                          ส่งคำขอ {formatCreatedAtTh(row.created_at)}
                        </Text>
                        {row.is_kpi_exempt ? (
                          <Text style={styles.leaveHistoryAttach}>ปรับโดยแอดมิน/HR · ไม่นับ KPI</Text>
                        ) : null}
                        {row.medical_certificate_url || row.supplementary_document_url ? (
                          <Text style={styles.leaveHistoryAttach}>มีเอกสารแนบ</Text>
                        ) : null}
                      </View>
                    </View>
                  );
                })
              )}
            </ScrollView>
            <Pressable style={styles.modalClose} onPress={() => setLeaveHistoryOpen(false)}>
              <Text style={styles.modalCloseText}>ปิด</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <AdminEmployeeEditModal
        visible={editEmployeeId !== null}
        employeeId={editEmployeeId}
        preview={editPreview}
        branches={branches}
        allProfiles={adminProfilesList}
        onClose={() => {
          setEditEmployeeId(null);
          setEditPreview(null);
        }}
        onSaved={async () => {
          await loadHr();
          await reloadAdminProfiles();
          await refreshProfile();
        }}
      />

      <Modal
        visible={avatarCropOpen}
        animationType="slide"
        transparent
        onRequestClose={() => {
          if (avatarCropSaving) return;
          setAvatarCropOpen(false);
        }}>
        <View style={styles.modalBackdrop}>
          <View style={styles.cropCard}>
            <Text style={styles.modalTitle}>จัดตำแหน่งรูปโปรไฟล์</Text>
            <Text style={styles.cropHint}>
              ลากรูปด้วยนิ้ว/เมาส์โดยตรง และ pinch (2 นิ้ว) เพื่อซูม แล้วกดบันทึก
            </Text>
            <GestureDetector gesture={cropGesture}>
              <View
                style={styles.cropFrame}
                {...(Platform.OS === 'web'
                  ? ({ onWheel: handleCropWheel } as unknown as Record<string, unknown>)
                  : {})}>
                {avatarDraftUri ? (
                  <View style={{ pointerEvents: 'none' }}>
                    <Image
                      source={{ uri: avatarDraftUri }}
                      style={[
                        styles.cropPreviewImage,
                        {
                          width: cropPreviewW,
                          height: cropPreviewH,
                          transform: [{ translateX: cropOffsetX }, { translateY: cropOffsetY }],
                        },
                      ]}
                    />
                  </View>
                ) : null}
                <View style={[styles.cropOverlayRing, { pointerEvents: 'none' }]} />
              </View>
            </GestureDetector>
            <View style={styles.cropActionRow}>
              <Pressable
                style={[styles.modalClose, styles.cropCenterBtn]}
                onPress={() => {
                  if (avatarCropSaving) return;
                  setCropOffsetX(0);
                  setCropOffsetY(0);
                }}
                disabled={avatarCropSaving}>
                <Text style={styles.modalCloseText}>จัดกึ่งกลางอัตโนมัติ</Text>
              </Pressable>
            </View>
            <View style={styles.cropActionRow}>
              <Pressable
                style={[styles.modalClose, styles.cropCancelBtn]}
                onPress={() => {
                  if (avatarCropSaving) return;
                  setAvatarCropOpen(false);
                  setAvatarDraftUri(null);
                }}
                disabled={avatarCropSaving}>
                <Text style={styles.modalCloseText}>ยกเลิก</Text>
              </Pressable>
              <Pressable
                style={[styles.primary, styles.cropSaveBtn, avatarCropSaving && styles.disabled]}
                onPress={saveCroppedAvatar}
                disabled={avatarCropSaving}>
                {avatarCropSaving ? (
                  <ActivityIndicator color={c.onAccent} />
                ) : (
                  <Text style={styles.primaryText}>บันทึกรูปนี้</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

function createProfileStyles(theme: AppTheme) {
  const c = theme.colors;
  const r = theme.radius;
  const s = theme.spacing;
  const sectionAccent =
    c.canvas === '#F8FAF1'
      ? { borderLeftWidth: 4, borderLeftColor: c.primaryMuted, paddingLeft: 10 }
      : {};

  return StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.canvas },
  screenContent: { padding: s.screen, paddingBottom: s.scrollBottom },
  profileMenuHero: {
    padding: 16,
    borderRadius: r.xl,
    backgroundColor: c.surfaceElevated,
    borderWidth: 1,
    borderColor: c.borderSoft,
    marginBottom: 14,
  },
  profileMenuHeroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  profileMenuHeroText: { flex: 1, minWidth: 0 },
  profileMenuHeroTitle: {
    fontSize: 20,
    fontWeight: '900',
    color: c.text,
  },
  profileMenuHeroSub: {
    marginTop: 3,
    fontSize: 13,
    color: c.textMuted,
  },
  profileMenuHeroRole: {
    alignSelf: 'flex-start',
    marginTop: 8,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: c.primaryLight,
    color: c.primaryDark,
    fontSize: 12,
    fontWeight: '800',
    overflow: 'hidden',
  },
  profileMenuHeroHint: {
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: c.borderSoft,
    fontSize: 12,
    lineHeight: 18,
    color: c.textMuted,
  },
  profileMenuGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  profileMenuCard: {
    flexGrow: 1,
    flexBasis: '47%',
    minWidth: 156,
    padding: 14,
    borderRadius: r.lg,
    backgroundColor: c.surfaceElevated,
    borderWidth: 1,
    borderColor: c.borderSoft,
    minHeight: 148,
  },
  profileMenuIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: c.primaryLight,
    borderWidth: 1,
    borderColor: c.primaryMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  profileMenuTitle: {
    fontSize: 15,
    fontWeight: '900',
    color: c.text,
  },
  profileMenuSub: {
    marginTop: 6,
    fontSize: 12,
    lineHeight: 17,
    color: c.textMuted,
  },
  profileSectionHeader: {
    padding: 14,
    borderRadius: r.lg,
    backgroundColor: c.surfaceElevated,
    borderWidth: 1,
    borderColor: c.borderSoft,
    marginBottom: 14,
  },
  profileBackBtn: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingVertical: 8,
    paddingHorizontal: 11,
    borderRadius: 999,
    backgroundColor: c.primaryLight,
    borderWidth: 1,
    borderColor: c.primaryMuted,
    marginBottom: 12,
  },
  profileBackBtnText: {
    color: c.primaryDark,
    fontSize: 12,
    fontWeight: '800',
  },
  profileSectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    ...sectionAccent,
  },
  profileSectionIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: c.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileSectionTitleText: { flex: 1, minWidth: 0 },
  profileSectionTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: c.text,
  },
  profileSectionSub: {
    marginTop: 3,
    fontSize: 12,
    lineHeight: 17,
    color: c.textMuted,
  },
  avatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
  },
  avatarActions: { flex: 1, gap: 6 },
  avatarBtn: {
    backgroundColor: c.primaryLight,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: r.sm,
    borderWidth: 1,
    borderColor: c.border,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  avatarBtnText: { color: c.primaryDark, fontWeight: '700' },
  avatarHint: { fontSize: 11, color: c.textMuted },
  label: { fontWeight: '600', marginTop: 12, marginBottom: 4, color: c.textSecondary },
  readonly: { fontSize: 16, color: c.text },
  input: {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: r.sm,
    padding: 12,
    backgroundColor: c.surfaceElevated,
    fontSize: 16,
    color: c.text,
  },
  primary: {
    marginTop: 12,
    backgroundColor: c.primary,
    paddingVertical: 12,
    borderRadius: r.md,
    alignItems: 'center',
  },
  primaryText: { color: c.onAccent, fontWeight: '700' },
  wellbeingNav: {
    marginTop: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: r.md,
    backgroundColor: c.riverLight,
    borderWidth: 1,
    borderColor: c.border,
  },
  wellbeingNavText: { fontSize: 15, fontWeight: '700', color: c.river },
  wellbeingNavHint: { fontSize: 12, color: c.textMuted, marginTop: 4 },
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
  secondary: { marginTop: 8, alignItems: 'center', padding: 8 },
  secondaryText: { color: c.primaryDark, fontWeight: '600' },
  box: { marginTop: 10, gap: s.gap },
  logout: {
    marginTop: 22,
    borderWidth: 1,
    borderColor: c.errorBg,
    paddingVertical: 12,
    borderRadius: r.sm,
    alignItems: 'center',
    backgroundColor: c.surface,
  },
  logoutText: { color: c.error, fontWeight: '700' },
  sectionTitle: {
    marginTop: 20,
    fontSize: 17,
    fontWeight: '700',
    color: c.text,
    ...sectionAccent,
  },
  sectionSub: { fontSize: 12, color: c.textMuted, marginTop: 4, marginBottom: 10 },
  themeSettingsSub: {
    marginTop: 6,
    marginBottom: 12,
    fontSize: 13,
    lineHeight: 19,
    color: c.textMuted,
  },
  themeChoiceGrid: {
    gap: 10,
  },
  themeChoiceCard: {
    padding: 14,
    borderRadius: r.lg,
    backgroundColor: c.surfaceElevated,
    borderWidth: 1,
    borderColor: c.borderSoft,
  },
  themeChoiceTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  themeSwatchRow: {
    flexDirection: 'row',
    gap: 7,
  },
  themeSwatch: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.55)',
  },
  themeChoiceTitle: {
    fontSize: 15,
    fontWeight: '900',
    color: c.text,
  },
  themeChoiceSub: {
    marginTop: 4,
    fontSize: 12,
    color: c.textMuted,
    lineHeight: 17,
  },
  themeSettingsHint: {
    marginTop: 12,
    padding: 12,
    borderRadius: r.md,
    backgroundColor: c.primaryLight,
    borderWidth: 1,
    borderColor: c.primaryMuted,
    color: c.primaryDark,
    fontSize: 12,
    lineHeight: 18,
  },
  muted: { fontSize: 14, color: c.textMuted, lineHeight: 20 },
  mono: { fontFamily: 'monospace', fontSize: 12, color: c.textSecondary },
  hrCard: {
    backgroundColor: c.surface,
    borderRadius: r.md,
    borderWidth: 1,
    borderColor: c.borderSoft,
    padding: s.card,
  },
  hrName: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 10,
    color: c.primaryDark,
  },
  hrRow: {
    flexDirection: 'row',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: c.borderSoft,
    gap: 8,
  },
  hrKey: { width: 130, fontSize: 12, color: c.textMuted, fontWeight: '600' },
  hrVal: { flex: 1, fontSize: 13, color: c.text },
  listRow: {
    backgroundColor: c.surface,
    padding: s.card,
    borderRadius: r.md,
    borderWidth: 1,
    borderColor: c.borderSoft,
    marginBottom: s.gap,
  },
  listTitle: { fontWeight: '700', fontSize: 15, color: c.text },
  listMeta: { fontSize: 12, color: c.textMuted, marginTop: 4 },
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
  notifPrefRow: {
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: c.borderSoft,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  notifPrefRowNoBorder: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  notifPrefTextWrap: { flex: 1 },
  notifPrefTitle: { color: c.text, fontWeight: '700', fontSize: 13 },
  notifPrefHint: { color: c.textMuted, fontSize: 11, marginTop: 2 },
  cropCard: {
    backgroundColor: c.surface,
    borderRadius: r.xl,
    padding: 16,
    borderWidth: 1,
    borderColor: c.borderSoft,
    gap: 10,
  },
  cropHint: { fontSize: 12, color: c.textMuted, marginBottom: 4 },
  cropFrame: {
    width: 260,
    height: 260,
    borderRadius: 130,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: c.primary,
    alignSelf: 'center',
    backgroundColor: c.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cropPreviewImage: {
    position: 'absolute',
  },
  cropOverlayRing: {
    position: 'absolute',
    width: 260,
    height: 260,
    borderRadius: 130,
    borderWidth: 2,
    borderColor: c.borderSoft,
  },
  cropActionRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  cropCenterBtn: { marginTop: 0, width: '100%' },
  cropCancelBtn: { flex: 1, marginTop: 0 },
  cropSaveBtn: { flex: 1, marginTop: 0 },
  });
}
