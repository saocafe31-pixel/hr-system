import { useCallback, useEffect, useMemo, useState } from 'react';
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
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppLoadingScreen } from '@/components/AppLoadingScreen';
import { DatePickerField } from '@/components/DatePickerField';
import { UserAvatar } from '@/components/UserAvatar';
import type { AppTheme } from '@/constants/Theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { isAdmin, isManagerOrAdmin, useAuth, useRole } from '@/contexts/AuthContext';
import { useCuteToast } from '@/contexts/CuteToastContext';
import {
  companyHolidayMapByDate,
  fetchCompanyHolidayDates,
} from '@/lib/companyHolidays';
import {
  buildAssignmentByUserDate,
  buildHolidayByUserDate,
  deleteEmployeeHolidayDatesForPairs,
  deleteScheduleAssignmentsForPairs,
  resolvedScheduleDayStatusForUser,
} from '@/lib/scheduleDayResolution';
import { leaveTypeLabelTh } from '@/lib/leaveAttendanceChat';
import { dateToBangkokYmd } from '@/lib/taskHelpers';
import { supabase } from '@/lib/supabase';
import type {
  Branch,
  CompanyHolidayDateRow,
  EmployeeDirectory,
  EmployeeHolidayDateRow,
  LeaveRequestRow,
  Profile,
  WorkScheduleAssignmentRow,
  WorkScheduleRow,
  WorkShiftRow,
} from '@/lib/types';

type AssignmentWithShift = WorkScheduleAssignmentRow & {
  work_shifts: Pick<WorkShiftRow, 'name' | 'start_time' | 'end_time'> | null;
};

/** select เดียวกันทั้งโหลดรายการหลักและโหลดรายละเอียดตามพนักงาน */
const WORK_SCHEDULE_ASSIGNMENT_SELECT =
  'id, user_id, work_date, shift_id, allowed_branch_id, created_by, created_at, work_shifts(name, start_time, end_time)';
const ASSIGNMENT_PAGE_SIZE = 1000;
const WEEKDAY_LABELS_TH = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];

type SchedulePerson = Profile & { avatar_url?: string | null; employee_id?: string | null };
type EmployeeDirLite = Pick<
  EmployeeDirectory,
  'id' | 'legacy_user_id' | 'employee_no' | 'name' | 'surname' | 'nickname' | 'position'
>;
type ScheduleEmployeeDisplay = {
  realName: string;
  nickname: string | null;
  label: string;
};
type CalendarDetailFilter = 'all' | 'holiday' | 'leave' | 'work';
type ScheduleDayLeaveEntry = {
  leave_id: string;
  user_id: string;
  leave_type: LeaveRequestRow['leave_type'];
  reason: string | null;
  starts_on: string;
  ends_on: string;
};

function scheduleEmployeeDisplayFromParts(
  realName: string,
  nickname: string | null,
  fallback: string
): ScheduleEmployeeDisplay {
  const real = realName.trim();
  const nick = nickname?.trim() || null;
  let label = fallback;
  if (real && nick) label = `${real}, ${nick}`;
  else if (real) label = real;
  else if (nick) label = nick;
  return { realName: real, nickname: nick, label };
}

function resolveEmployeeForProfile(
  profile: Pick<SchedulePerson, 'id' | 'employee_id' | 'email' | 'employee_code'>,
  byEmployeeId: Map<string, EmployeeDirLite>,
  byLegacyEmail: Map<string, EmployeeDirLite>,
  byEmployeeNo: Map<string, EmployeeDirLite>
): EmployeeDirLite | undefined {
  if (profile.email) {
    const hit = byLegacyEmail.get(profile.email.trim().toLowerCase());
    if (hit) return hit;
  }
  if (profile.id) {
    const hit = byLegacyEmail.get(profile.id.trim().toLowerCase());
    if (hit) return hit;
  }
  if (profile.employee_id) {
    const hit = byEmployeeId.get(String(profile.employee_id));
    if (hit) return hit;
  }
  const code = profile.employee_code?.trim();
  if (code) {
    const hit = byEmployeeNo.get(code);
    if (hit) return hit;
  }
  return undefined;
}

function scheduleEmployeeDisplay(
  profile: Pick<SchedulePerson, 'id' | 'email'>,
  emp?: Pick<EmployeeDirLite, 'name' | 'surname' | 'nickname'>
): ScheduleEmployeeDisplay {
  const first = (emp?.name ?? '').trim();
  const last = (emp?.surname ?? '').trim();
  const real = `${first} ${last}`.trim();
  const nick = emp?.nickname?.trim() || null;
  const fallback = profile.email?.trim() || profile.id.slice(0, 8);
  return scheduleEmployeeDisplayFromParts(real, nick, fallback);
}

function buildDirectoryLookupMaps(dirRows: EmployeeDirLite[]) {
  const byEmployeeId = new Map<string, EmployeeDirLite>();
  const byLegacyEmail = new Map<string, EmployeeDirLite>();
  const byEmployeeNo = new Map<string, EmployeeDirLite>();
  for (const row of dirRows) {
    if (row.id) byEmployeeId.set(String(row.id), row);
    const legacy = row.legacy_user_id?.trim().toLowerCase();
    if (legacy) byLegacyEmail.set(legacy, row);
    if (row.employee_no != null) byEmployeeNo.set(String(row.employee_no), row);
  }
  return { byEmployeeId, byLegacyEmail, byEmployeeNo };
}

async function fetchScheduleDirectoryRows(
  isAdminUser: boolean,
  userRole: string | null
): Promise<EmployeeDirLite[]> {
  const select =
    'id,legacy_user_id,employee_no,name,surname,nickname,position' as const;
  if (isAdminUser) {
    const { data, error } = await supabase.rpc('admin_list_employee_directory_rows');
    if (error) throw error;
    return ((data ?? []) as EmployeeDirLite[]) ?? [];
  }
  if (userRole === 'manager') {
    const { data, error } = await supabase.rpc('manager_list_team_directory_rows');
    if (error) throw error;
    return ((data ?? []) as EmployeeDirLite[]) ?? [];
  }
  const { data } = await supabase.from('employee_directory').select(select);
  return ((data ?? []) as EmployeeDirLite[]) ?? [];
}

function roleLabelTh(role?: string | null): string {
  if (role === 'admin') return 'แอดมิน';
  if (role === 'manager') return 'ผู้จัดการ';
  return 'พนักงาน';
}

function looksLikeMissingShiftsMigration(err: {
  message?: string;
  code?: string;
} | null): boolean {
  const m = err?.message ?? '';
  const code = err?.code ?? '';
  if (!m) return false;
  const namesShift =
    m.includes('work_shifts') || m.includes('work_schedule_assignments');
  const looksCache =
    /schema cache|Could not find the table|PGRST205|PGRST204/i.test(m) ||
    code === 'PGRST205' ||
    code === 'PGRST204';
  return namesShift && looksCache;
}

/** ส่งค่าให้คอลัมน์ time ของ Postgres (HH:MM:SS) */
function toPgTime(hhmm: string): string {
  const t = hhmm.trim();
  if (/^\d{1,2}:\d{2}:\d{2}$/.test(t)) return t;
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) return `${t}:00`;
  const h = String(Number(m[1])).padStart(2, '0');
  const min = m[2];
  return `${h}:${min}:00`;
}

function ymdOfDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

function dateFromYmd(ymd: string): Date {
  return new Date(`${ymd}T12:00:00+07:00`);
}

function daysInMonth(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

function monthTitleTh(d: Date): string {
  return new Intl.DateTimeFormat('th-TH-u-ca-gregory-nu-latn', {
    month: 'long',
    year: 'numeric',
  }).format(d);
}

function formatSelectedDateTh(ymd: string): string {
  return new Intl.DateTimeFormat('th-TH-u-ca-gregory-nu-latn', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(dateFromYmd(ymd));
}

function formatShortDateTh(ymd: string): string {
  return new Intl.DateTimeFormat('th-TH-u-ca-gregory-nu-latn', {
    day: 'numeric',
    month: 'short',
  }).format(dateFromYmd(ymd));
}

function formatHolidayDateListTh(ymds: string[]): string {
  const sorted = [...new Set(ymds)].sort();
  if (sorted.length === 0) return '—';
  if (sorted.length <= 4) {
    return sorted.map(formatShortDateTh).join(', ');
  }
  return `${sorted
    .slice(0, 4)
    .map(formatShortDateTh)
    .join(', ')} และอีก ${sorted.length - 4} วัน`;
}

function listYmdRange(startYmd: string, endYmd: string): string[] {
  const out: string[] = [];
  const d = dateFromYmd(startYmd);
  const end = dateFromYmd(endYmd).getTime();
  while (d.getTime() <= end) {
    out.push(ymdOfDate(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

function calendarCellsForMonth(month: Date): Array<string | null> {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const pad = first.getDay();
  const total = daysInMonth(first);
  const cells: Array<string | null> = [];
  for (let i = 0; i < pad; i += 1) cells.push(null);
  for (let day = 1; day <= total; day += 1) {
    cells.push(ymdOfDate(new Date(first.getFullYear(), first.getMonth(), day)));
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

async function fetchAllScheduleAssignments(): Promise<{
  data: AssignmentWithShift[] | null;
  error: { message?: string; code?: string } | null;
}> {
  const all: AssignmentWithShift[] = [];
  for (let from = 0; ; from += ASSIGNMENT_PAGE_SIZE) {
    const to = from + ASSIGNMENT_PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from('work_schedule_assignments')
      .select(WORK_SCHEDULE_ASSIGNMENT_SELECT)
      .order('work_date', { ascending: false })
      .range(from, to);
    if (error) return { data: null, error };
    const page = ((data ?? []) as unknown as AssignmentWithShift[]);
    all.push(...page);
    if (page.length < ASSIGNMENT_PAGE_SIZE) break;
  }
  return { data: all, error: null };
}

async function fetchAllHolidayDates(): Promise<{
  data: EmployeeHolidayDateRow[] | null;
  error: { message?: string; code?: string } | null;
}> {
  const all: EmployeeHolidayDateRow[] = [];
  for (let from = 0; ; from += ASSIGNMENT_PAGE_SIZE) {
    const to = from + ASSIGNMENT_PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from('employee_holiday_dates')
      .select('id, user_id, holiday_date, created_by, created_at')
      .order('holiday_date', { ascending: false })
      .range(from, to);
    if (error) return { data: null, error };
    const page = (data as EmployeeHolidayDateRow[]) ?? [];
    all.push(...page);
    if (page.length < ASSIGNMENT_PAGE_SIZE) break;
  }
  return { data: all, error: null };
}

async function fetchAllApprovedLeaves(): Promise<{
  data: LeaveRequestRow[] | null;
  error: { message?: string; code?: string } | null;
}> {
  const all: LeaveRequestRow[] = [];
  const select =
    'id, user_id, leave_type, starts_on, ends_on, reason, status, created_at' as const;
  for (let from = 0; ; from += ASSIGNMENT_PAGE_SIZE) {
    const to = from + ASSIGNMENT_PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from('leave_requests')
      .select(select)
      .eq('status', 'approved')
      .order('starts_on', { ascending: false })
      .range(from, to);
    if (error) return { data: null, error };
    const page = (data as LeaveRequestRow[]) ?? [];
    all.push(...page);
    if (page.length < ASSIGNMENT_PAGE_SIZE) break;
  }
  return { data: all, error: null };
}

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

export default function ScheduleScreen() {
  const toast = useCuteToast();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const role = useRole();
  const mgr = isManagerOrAdmin(role);
  const admin = isAdmin(role);
  const { theme } = useAppTheme();
  const c = theme.colors;
  const s = theme.spacing;
  const styles = useMemo(() => createScheduleStyles(theme), [theme]);

  const [rows, setRows] = useState<WorkScheduleRow[]>([]);
  const [shifts, setShifts] = useState<WorkShiftRow[]>([]);
  const [assignments, setAssignments] = useState<AssignmentWithShift[]>([]);
  const [holidayDates, setHolidayDates] = useState<EmployeeHolidayDateRow[]>([]);
  const [approvedLeaves, setApprovedLeaves] = useState<LeaveRequestRow[]>([]);
  const [companyHolidays, setCompanyHolidays] = useState<CompanyHolidayDateRow[]>([]);
  const [companyHolidayModuleMissing, setCompanyHolidayModuleMissing] = useState(false);
  const [people, setPeople] = useState<SchedulePerson[]>([]);
  const [positionByProfileId, setPositionByProfileId] = useState<Record<string, string>>({});
  const [nicknameByProfileId, setNicknameByProfileId] = useState<Record<string, string>>({});
  const [employeeDisplayByProfileId, setEmployeeDisplayByProfileId] = useState<
    Record<string, ScheduleEmployeeDisplay>
  >({});
  const [branches, setBranches] = useState<Pick<Branch, 'id' | 'branch_name' | 'branch_code'>[]>([]);
  const [loading, setLoading] = useState(true);

  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');

  const [shiftOpen, setShiftOpen] = useState(false);
  const [shiftName, setShiftName] = useState('');
  const [shiftStart, setShiftStart] = useState('09:00');
  const [shiftEnd, setShiftEnd] = useState('18:00');

  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkShiftId, setBulkShiftId] = useState<string | null>(null);
  const [bulkPickMonth, setBulkPickMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [bulkPickDates, setBulkPickDates] = useState<Record<string, boolean>>({});
  const [bulkAllowedBranchId, setBulkAllowedBranchId] = useState<number | null>(null);
  const [bulkUserIds, setBulkUserIds] = useState<Record<string, boolean>>({});
  const [bulkSaving, setBulkSaving] = useState(false);
  const [shiftModuleMissing, setShiftModuleMissing] = useState(false);
  const [listRefreshing, setListRefreshing] = useState(false);
  const [editingAssignment, setEditingAssignment] = useState<AssignmentWithShift | null>(null);
  const [editAsnOpen, setEditAsnOpen] = useState(false);
  const [editAsnShiftId, setEditAsnShiftId] = useState<string | null>(null);
  const [editAsnBranchId, setEditAsnBranchId] = useState<number | null>(null);
  const [editAsnDate, setEditAsnDate] = useState<Date | null>(null);
  const [editAsnSaving, setEditAsnSaving] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<WorkScheduleRow | null>(null);
  const [editScheduleOpen, setEditScheduleOpen] = useState(false);
  const [editScheduleTitle, setEditScheduleTitle] = useState('');
  const [editScheduleStartAt, setEditScheduleStartAt] = useState('');
  const [editScheduleEndAt, setEditScheduleEndAt] = useState('');
  const [editScheduleSaving, setEditScheduleSaving] = useState(false);
  const [editingShift, setEditingShift] = useState<WorkShiftRow | null>(null);
  const [editShiftOpen, setEditShiftOpen] = useState(false);
  const [editShiftName, setEditShiftName] = useState('');
  const [editShiftStart, setEditShiftStart] = useState('09:00');
  const [editShiftEnd, setEditShiftEnd] = useState('18:00');
  const [editShiftSaving, setEditShiftSaving] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{
    kind: 'assignment' | 'schedule' | 'shift';
    id: string;
    label: string;
  } | null>(null);
  const [deletingNow, setDeletingNow] = useState(false);
  const [selectedAssignmentUserId, setSelectedAssignmentUserId] = useState<string | null>(null);
  const [assignmentPickerOpen, setAssignmentPickerOpen] = useState(false);
  const [assignmentSearch, setAssignmentSearch] = useState('');
  const [assignmentDetailOpen, setAssignmentDetailOpen] = useState(false);
  /** มอบหมายทั้งหมดของพนักงานที่เปิดโมดัล — โหลดแยกเพื่อไม่พลาดรายการ (เดิมรายการหลักจำกัด 120 แถว) */
  const [detailSheetAssignments, setDetailSheetAssignments] = useState<
    AssignmentWithShift[] | null
  >(null);
  const [detailSheetLoading, setDetailSheetLoading] = useState(false);
  /** เพิ่มหลัง `load()` เพื่อให้โมดัลรายละเอียดรีโหลดรายการเมื่อรีเฟรช/ลบ/แก้ไข */
  const [detailFetchNonce, setDetailFetchNonce] = useState(0);
  const [selectedDetailAssignmentIds, setSelectedDetailAssignmentIds] = useState<Record<string, boolean>>({});
  const [bulkEditAsnOpen, setBulkEditAsnOpen] = useState(false);
  const [bulkEditAsnShiftId, setBulkEditAsnShiftId] = useState<string | null>(null);
  const [bulkEditAsnBranchId, setBulkEditAsnBranchId] = useState<number | null>(null);
  const [bulkEditAsnSaving, setBulkEditAsnSaving] = useState(false);
  const [bulkDeleteAsnConfirmOpen, setBulkDeleteAsnConfirmOpen] = useState(false);
  const [bulkDeleteAsnSaving, setBulkDeleteAsnSaving] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedCalendarYmd, setSelectedCalendarYmd] = useState(() =>
    dateToBangkokYmd(new Date())
  );
  const [calendarDetailOpen, setCalendarDetailOpen] = useState(false);
  const [calendarDetailFilter, setCalendarDetailFilter] = useState<CalendarDetailFilter>('all');
  const [holidayOpen, setHolidayOpen] = useState(false);
  const [holidayPickMonth, setHolidayPickMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [holidayPickDates, setHolidayPickDates] = useState<Record<string, boolean>>({});
  const [holidayUserIds, setHolidayUserIds] = useState<Record<string, boolean>>({});
  const [holidaySaving, setHolidaySaving] = useState(false);
  const [holidayModuleMissing, setHolidayModuleMissing] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('work_schedules')
      .select('*')
      .order('start_at', { ascending: true });
    if (error) {
      toast.error('โหลดตารางไม่สำเร็จ', error.message);
    } else {
      setRows((data as WorkScheduleRow[]) ?? []);
    }

    const { data: sh, error: shErr } = await supabase
      .from('work_shifts')
      .select('*')
      .order('name');
    const { data: asn, error: asnErr } = await fetchAllScheduleAssignments();

    const missing =
      looksLikeMissingShiftsMigration(shErr) ||
      looksLikeMissingShiftsMigration(asnErr);
    setShiftModuleMissing(missing);

    if (missing) {
      setShifts([]);
      setAssignments([]);
    } else {
      if (!shErr) {
        setShifts((sh as WorkShiftRow[]) ?? []);
      } else {
        toast.error('โหลดกะไม่สำเร็จ', shErr.message);
      }
      if (!asnErr) {
        setAssignments(asn ?? []);
      } else {
        toast.error('โหลดมอบหมายไม่สำเร็จ', asnErr.message);
      }
    }

    const { data: pe } = await supabase
      .from('profiles')
      .select('id, email, full_name, role, branch_id, employee_code, phone, employee_id, avatar_url')
      .in('role', ['employee', 'manager', 'admin'])
      .order('full_name', { ascending: true });
    let list = (pe as SchedulePerson[]) ?? [];
    const uid = session?.user?.id;
    if (!admin && role === 'manager' && uid) {
      const { data: reps } = await supabase
        .from('manager_direct_reports')
        .select('subordinate_id')
        .eq('manager_id', uid);
      const subIds = new Set(
        (reps as { subordinate_id?: string }[] | null)
          ?.map((r) => r.subordinate_id)
          .filter((x): x is string => !!x) ?? []
      );
      list = list.filter((p) => p.id === uid || subIds.has(p.id));
    }
    setPeople(list);
    let dirRows: EmployeeDirLite[] = [];
    try {
      dirRows = await fetchScheduleDirectoryRows(admin, role);
    } catch (dirErr) {
      const msg = dirErr instanceof Error ? dirErr.message : String(dirErr);
      toast.error('โหลดข้อมูลพนักงานไม่สำเร็จ', msg);
    }
    const { byEmployeeId, byLegacyEmail, byEmployeeNo } = buildDirectoryLookupMaps(dirRows);
    const nextPosByProfileId: Record<string, string> = {};
    const nextNicknameByProfileId: Record<string, string> = {};
    const nextEmployeeDisplayByProfileId: Record<string, ScheduleEmployeeDisplay> = {};
    for (const p of list) {
      const emp = resolveEmployeeForProfile(p, byEmployeeId, byLegacyEmail, byEmployeeNo);
      const pos = emp?.position?.trim();
      const nick = emp?.nickname?.trim();
      if (pos) nextPosByProfileId[p.id] = pos;
      if (nick) nextNicknameByProfileId[p.id] = nick;
      nextEmployeeDisplayByProfileId[p.id] = scheduleEmployeeDisplay(p, emp);
    }
    setPositionByProfileId(nextPosByProfileId);
    setNicknameByProfileId(nextNicknameByProfileId);
    setEmployeeDisplayByProfileId(nextEmployeeDisplayByProfileId);
    const { data: br } = await supabase
      .from('branch_information')
      .select('id, branch_name, branch_code')
      .order('branch_name');
    setBranches((br as Pick<Branch, 'id' | 'branch_name' | 'branch_code'>[]) ?? []);

    const { data: holRows, error: holErr } = await fetchAllHolidayDates();
    if (holErr) {
      const missingHol =
        holErr.message?.includes('employee_holiday_dates') &&
        (/schema cache|Could not find the table|PGRST205/i.test(holErr.message) ||
          holErr.code === 'PGRST205');
      setHolidayModuleMissing(!!missingHol);
      if (!missingHol) {
        toast.error('โหลดวันหยุดไม่สำเร็จ', holErr.message);
      }
      setHolidayDates([]);
    } else {
      setHolidayModuleMissing(false);
      setHolidayDates(holRows ?? []);
    }

    const { data: leaveRows, error: leaveErr } = await fetchAllApprovedLeaves();
    if (leaveErr) {
      toast.error('โหลดการลาไม่สำเร็จ', leaveErr.message);
      setApprovedLeaves([]);
    } else {
      setApprovedLeaves(leaveRows ?? []);
    }

    try {
      const companyRows = await fetchCompanyHolidayDates();
      setCompanyHolidays(companyRows);
      setCompanyHolidayModuleMissing(false);
    } catch (companyErr) {
      const msg = companyErr instanceof Error ? companyErr.message : String(companyErr);
      const missingCompany =
        msg.includes('company_holiday_dates') &&
        (/schema cache|Could not find the table|PGRST205/i.test(msg) ||
          (companyErr as { code?: string })?.code === 'PGRST205');
      setCompanyHolidayModuleMissing(!!missingCompany);
      if (!missingCompany) {
        toast.error('โหลดวันหยุดบริษัทไม่สำเร็จ', msg);
      }
      setCompanyHolidays([]);
    }

    setDetailFetchNonce((n) => n + 1);
  }, [toast, admin, role, session?.user?.id]);

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

  const peopleLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of people) {
      m.set(
        p.id,
        employeeDisplayByProfileId[p.id]?.label ?? p.email ?? p.id.slice(0, 8)
      );
    }
    return m;
  }, [employeeDisplayByProfileId, people]);
  const peopleById = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const branchLabel = useMemo(() => {
    const m = new Map<number, string>();
    for (const b of branches) {
      m.set(b.id, b.branch_name || b.branch_code || `สาขา ${b.id}`);
    }
    return m;
  }, [branches]);
  const visiblePeopleIds = useMemo(() => new Set(people.map((p) => p.id)), [people]);
  const visibleAssignments = useMemo(
    () => assignments.filter((a) => visiblePeopleIds.has(a.user_id)),
    [assignments, visiblePeopleIds]
  );
  const holidayByUserDate = useMemo(
    () => buildHolidayByUserDate(holidayDates, visiblePeopleIds),
    [holidayDates, visiblePeopleIds]
  );
  const assignmentByUserDate = useMemo(
    () => buildAssignmentByUserDate(visibleAssignments, visiblePeopleIds),
    [visibleAssignments, visiblePeopleIds]
  );
  const leaveEntriesByDate = useMemo(() => {
    const byDateUser = new Map<string, ScheduleDayLeaveEntry>();
    for (const leave of approvedLeaves) {
      if (!visiblePeopleIds.has(leave.user_id)) continue;
      for (const ymd of listYmdRange(leave.starts_on, leave.ends_on)) {
        byDateUser.set(`${ymd}|${leave.user_id}`, {
          leave_id: leave.id,
          user_id: leave.user_id,
          leave_type: leave.leave_type,
          reason: leave.reason,
          starts_on: leave.starts_on,
          ends_on: leave.ends_on,
        });
      }
    }
    const map = new Map<string, ScheduleDayLeaveEntry[]>();
    for (const [key, entry] of byDateUser) {
      const ymd = key.split('|')[0] ?? '';
      if (!ymd) continue;
      const list = map.get(ymd) ?? [];
      list.push(entry);
      map.set(ymd, list);
    }
    for (const [ymd, list] of map.entries()) {
      map.set(
        ymd,
        [...list].sort((a, b) =>
          (peopleLabel.get(a.user_id) ?? '').localeCompare(
            peopleLabel.get(b.user_id) ?? '',
            'th'
          )
        )
      );
    }
    return map;
  }, [approvedLeaves, peopleLabel, visiblePeopleIds]);
  const leaveUserIdsByDate = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const [ymd, entries] of leaveEntriesByDate) {
      map.set(ymd, new Set(entries.map((e) => e.user_id)));
    }
    return map;
  }, [leaveEntriesByDate]);
  const assignmentsByDate = useMemo(() => {
    const map = new Map<string, AssignmentWithShift[]>();
    for (const row of visibleAssignments) {
      if (leaveUserIdsByDate.get(row.work_date)?.has(row.user_id)) continue;
      const status = resolvedScheduleDayStatusForUser(
        row.user_id,
        row.work_date,
        holidayByUserDate,
        assignmentByUserDate
      );
      if (status !== 'work') continue;
      map.set(row.work_date, [...(map.get(row.work_date) ?? []), row]);
    }
    for (const [ymd, list] of map.entries()) {
      map.set(
        ymd,
        [...list].sort((a, b) => {
          const aTime = a.work_shifts?.start_time ?? '';
          const bTime = b.work_shifts?.start_time ?? '';
          return (
            aTime.localeCompare(bTime) ||
            (peopleLabel.get(a.user_id) ?? '').localeCompare(
              peopleLabel.get(b.user_id) ?? '',
              'th'
            )
          );
        })
      );
    }
    return map;
  }, [peopleLabel, visibleAssignments, holidayByUserDate, assignmentByUserDate, leaveUserIdsByDate]);
  const calendarCells = useMemo(() => calendarCellsForMonth(calendarMonth), [calendarMonth]);
  const selectedDayAssignments = useMemo(
    () => assignmentsByDate.get(selectedCalendarYmd) ?? [],
    [assignmentsByDate, selectedCalendarYmd]
  );
  const selectedDayAssignmentGroups = useMemo(() => {
    const groups = new Map<
      string,
      { branchName: string; assignments: AssignmentWithShift[] }
    >();
    for (const row of selectedDayAssignments) {
      const key = row.allowed_branch_id != null ? String(row.allowed_branch_id) : 'none';
      const branchName =
        row.allowed_branch_id != null
          ? branchLabel.get(row.allowed_branch_id) ?? `สาขา #${row.allowed_branch_id}`
          : 'ไม่จำกัดสาขา';
      const current = groups.get(key) ?? { branchName, assignments: [] };
      current.assignments.push(row);
      groups.set(key, current);
    }
    return [...groups.values()].sort((a, b) => a.branchName.localeCompare(b.branchName, 'th'));
  }, [branchLabel, selectedDayAssignments]);
  const holidaysByDate = useMemo(() => {
    const map = new Map<string, EmployeeHolidayDateRow[]>();
    for (const row of holidayDates) {
      if (!visiblePeopleIds.has(row.user_id)) continue;
      const status = resolvedScheduleDayStatusForUser(
        row.user_id,
        row.holiday_date,
        holidayByUserDate,
        assignmentByUserDate
      );
      if (status !== 'holiday') continue;
      const list = map.get(row.holiday_date) ?? [];
      list.push(row);
      map.set(row.holiday_date, list);
    }
    return map;
  }, [holidayDates, visiblePeopleIds, holidayByUserDate, assignmentByUserDate]);
  const companyHolidaysByDate = useMemo(
    () => companyHolidayMapByDate(companyHolidays),
    [companyHolidays]
  );
  const selectedCompanyHoliday = useMemo(
    () => companyHolidaysByDate.get(selectedCalendarYmd) ?? null,
    [companyHolidaysByDate, selectedCalendarYmd]
  );
  const selectedDayHolidayRows = useMemo(
    () => holidaysByDate.get(selectedCalendarYmd) ?? [],
    [holidaysByDate, selectedCalendarYmd]
  );
  const selectedDayHolidayGroups = useMemo(() => {
    const groups = new Map<string, { branchName: string; userIds: string[] }>();
    for (const row of selectedDayHolidayRows) {
      const person = peopleById.get(row.user_id);
      const branchId = person?.branch_id;
      const key = branchId != null ? String(branchId) : 'none';
      const branchName =
        branchId != null ? branchLabel.get(branchId) ?? `สาขา #${branchId}` : 'ไม่ระบุสาขา';
      const current = groups.get(key) ?? { branchName, userIds: [] };
      current.userIds.push(row.user_id);
      groups.set(key, current);
    }
    for (const g of groups.values()) {
      g.userIds.sort((a, b) =>
        (peopleLabel.get(a) ?? '').localeCompare(peopleLabel.get(b) ?? '', 'th')
      );
    }
    return [...groups.values()].sort((a, b) => a.branchName.localeCompare(b.branchName, 'th'));
  }, [branchLabel, peopleById, peopleLabel, selectedDayHolidayRows]);
  const selectedDayLeaveRows = useMemo(
    () => leaveEntriesByDate.get(selectedCalendarYmd) ?? [],
    [leaveEntriesByDate, selectedCalendarYmd]
  );
  const selectedDayLeaveGroups = useMemo(() => {
    const groups = new Map<string, { branchName: string; entries: ScheduleDayLeaveEntry[] }>();
    for (const entry of selectedDayLeaveRows) {
      const person = peopleById.get(entry.user_id);
      const branchId = person?.branch_id;
      const key = branchId != null ? String(branchId) : 'none';
      const branchName =
        branchId != null ? branchLabel.get(branchId) ?? `สาขา #${branchId}` : 'ไม่ระบุสาขา';
      const current = groups.get(key) ?? { branchName, entries: [] };
      current.entries.push(entry);
      groups.set(key, current);
    }
    return [...groups.values()].sort((a, b) => a.branchName.localeCompare(b.branchName, 'th'));
  }, [branchLabel, peopleById, selectedDayLeaveRows]);
  const holidayPickDateList = useMemo(
    () =>
      Object.entries(holidayPickDates)
        .filter(([, on]) => on)
        .map(([ymd]) => ymd)
        .sort(),
    [holidayPickDates]
  );
  const holidayPickCalendarCells = useMemo(
    () => calendarCellsForMonth(holidayPickMonth),
    [holidayPickMonth]
  );
  const bulkPickDateList = useMemo(
    () =>
      Object.entries(bulkPickDates)
        .filter(([, on]) => on)
        .map(([ymd]) => ymd)
        .sort(),
    [bulkPickDates]
  );
  const bulkPickCalendarCells = useMemo(
    () => calendarCellsForMonth(bulkPickMonth),
    [bulkPickMonth]
  );
  const assignmentUsers = useMemo(
    () =>
      people
        .map((p) => ({
          id: p.id,
          label:
            employeeDisplayByProfileId[p.id]?.label ??
            peopleLabel.get(p.id) ??
            p.id.slice(0, 8),
          avatarUrl: p.avatar_url ?? null,
          subtitle:
            positionByProfileId[p.id] ||
            `${roleLabelTh(p.role)} · ${p.employee_code?.trim() || '—'}`,
          nickname: nicknameByProfileId[p.id] || null,
          count: visibleAssignments.filter((a) => a.user_id === p.id).length,
        }))
        .sort((a, b) => a.label.localeCompare(b.label, 'th')),
    [
      people,
      employeeDisplayByProfileId,
      peopleLabel,
      positionByProfileId,
      nicknameByProfileId,
      visibleAssignments,
    ]
  );
  const filteredAssignmentUsers = useMemo(() => {
    const q = assignmentSearch.trim().toLowerCase();
    if (!q) return assignmentUsers;
    return assignmentUsers.filter((u) => u.label.toLowerCase().includes(q));
  }, [assignmentSearch, assignmentUsers]);
  const selectedAssignments = useMemo(() => {
    if (!selectedAssignmentUserId) return [];
    return visibleAssignments.filter((a) => a.user_id === selectedAssignmentUserId);
  }, [selectedAssignmentUserId, visibleAssignments]);

  useEffect(() => {
    if (!assignmentDetailOpen || !selectedAssignmentUserId) {
      setDetailSheetAssignments(null);
      setDetailSheetLoading(false);
      return;
    }
    const uid = selectedAssignmentUserId;
    let cancelled = false;
    setDetailSheetAssignments(null);
    setDetailSheetLoading(true);
    void (async () => {
      const { data, error } = await supabase
        .from('work_schedule_assignments')
        .select(WORK_SCHEDULE_ASSIGNMENT_SELECT)
        .eq('user_id', uid)
        .order('work_date', { ascending: false });
      if (cancelled) return;
      setDetailSheetLoading(false);
      if (error) {
        toast.error('โหลดมอบหมายของพนักงานไม่สำเร็จ', error.message);
        setDetailSheetAssignments(null);
        return;
      }
      setDetailSheetAssignments((data ?? []) as unknown as AssignmentWithShift[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [assignmentDetailOpen, selectedAssignmentUserId, detailFetchNonce, toast]);

  const assignmentDetailRows = useMemo(() => {
    if (detailSheetAssignments != null) return detailSheetAssignments;
    return selectedAssignments;
  }, [detailSheetAssignments, selectedAssignments]);
  const selectedDetailAssignments = useMemo(
    () => assignmentDetailRows.filter((a) => selectedDetailAssignmentIds[a.id]),
    [assignmentDetailRows, selectedDetailAssignmentIds]
  );
  const allDetailRowsSelected =
    assignmentDetailRows.length > 0 &&
    assignmentDetailRows.every((a) => selectedDetailAssignmentIds[a.id]);

  function shiftCalendarMonth(delta: number) {
    setCalendarMonth((prev) => {
      const next = new Date(prev.getFullYear(), prev.getMonth() + delta, 1);
      setSelectedCalendarYmd((selected) => {
        const selectedDay = dateFromYmd(selected).getDate();
        const day = Math.min(selectedDay, daysInMonth(next));
        return ymdOfDate(new Date(next.getFullYear(), next.getMonth(), day));
      });
      return next;
    });
  }

  function openCalendarDetail(filter: CalendarDetailFilter = 'all') {
    setCalendarDetailFilter(filter);
    setCalendarDetailOpen(true);
  }

  function jumpCalendarToday() {
    const now = new Date();
    setCalendarMonth(new Date(now.getFullYear(), now.getMonth(), 1));
    setSelectedCalendarYmd(dateToBangkokYmd(now));
    openCalendarDetail('all');
  }

  function openAssignmentDetail(userId: string) {
    setSelectedDetailAssignmentIds({});
    setSelectedAssignmentUserId(userId);
    setAssignmentDetailOpen(true);
  }

  function closeAssignmentDetail() {
    setAssignmentDetailOpen(false);
    setSelectedDetailAssignmentIds({});
  }

  function toggleDetailAssignment(id: string) {
    setSelectedDetailAssignmentIds((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function toggleAllDetailAssignments() {
    if (allDetailRowsSelected) {
      setSelectedDetailAssignmentIds({});
      return;
    }
    setSelectedDetailAssignmentIds(
      Object.fromEntries(assignmentDetailRows.map((a) => [a.id, true]))
    );
  }

  function openBulkEditAssignments() {
    const first = selectedDetailAssignments[0];
    if (!first) return;
    setBulkEditAsnShiftId(first.shift_id);
    setBulkEditAsnBranchId(first.allowed_branch_id ?? null);
    setBulkEditAsnOpen(true);
  }

  useEffect(() => {
    if (assignmentUsers.length === 0) {
      setSelectedAssignmentUserId(null);
      return;
    }
    if (!selectedAssignmentUserId) return;
    const exists = assignmentUsers.some((u) => u.id === selectedAssignmentUserId);
    if (!exists) setSelectedAssignmentUserId(null);
  }, [assignmentUsers, selectedAssignmentUserId]);

  useEffect(() => {
    setSelectedDetailAssignmentIds((prev) => {
      const valid = new Set(assignmentDetailRows.map((a) => a.id));
      const entries = Object.entries(prev).filter(([id, on]) => on && valid.has(id));
      if (entries.length === Object.values(prev).filter(Boolean).length) return prev;
      return Object.fromEntries(entries);
    });
  }, [assignmentDetailRows]);

  async function saveSchedule() {
    if (!session?.user?.id || !userId || !startAt.trim() || !endAt.trim()) {
      toast.info('ข้อมูลไม่ครบ', 'เลือกพนักงานและกรอกเวลาเริ่ม/สิ้นสุด (รูปแบบ ISO)');
      return;
    }
    const { error } = await supabase.from('work_schedules').insert({
      user_id: userId,
      start_at: startAt.trim(),
      end_at: endAt.trim(),
      title: title.trim() || null,
      created_by: session.user.id,
    });
    if (error) {
      toast.error('บันทึกไม่สำเร็จ', error.message);
      return;
    }
    setOpen(false);
    setUserId(null);
    setTitle('');
    setStartAt('');
    setEndAt('');
    await load();
    toast.success('บันทึกตารางแล้ว', 'เพิ่มกะงานแบบเวลาเต็ม (legacy) เรียบร้อย');
  }

  async function saveShift() {
    if (!session?.user?.id || !shiftName.trim()) {
      toast.info('ชื่อกะ', 'กรุณากรอกชื่อกะ');
      return;
    }
    if (shiftModuleMissing) {
      toast.info(
        'ฐานข้อมูลยังไม่พร้อม',
        'รัน migration 20260415200000_leave_late_shifts.sql บน Supabase แล้วรีโหลดหน้านี้'
      );
      return;
    }
    const { error } = await supabase.from('work_shifts').insert({
      name: shiftName.trim(),
      start_time: toPgTime(shiftStart),
      end_time: toPgTime(shiftEnd),
      created_by: session.user.id,
    });
    if (error) {
      if (looksLikeMissingShiftsMigration(error)) {
        setShiftModuleMissing(true);
        toast.error(
          'บันทึกกะไม่สำเร็จ',
          'ยังไม่มีตาราง work_shifts — รัน migration ในโฟลเดอร์ supabase/migrations แล้วเปิด API schema ใหม่'
        );
      } else {
        toast.error('บันทึกกะไม่สำเร็จ', error.message);
      }
      return;
    }
    setShiftOpen(false);
    setShiftName('');
    setShiftStart('09:00');
    setShiftEnd('18:00');
    await load();
    toast.success('เพิ่มกะแล้ว', 'ใช้มอบหมายรายวันได้เลย');
  }

  function openBulkSetup() {
    if (shiftModuleMissing) {
      toast.info(
        'ฐานข้อมูล',
        'รัน migration ก่อน จึงจะมอบหมายได้ — ดูกล่องแจ้งเตือนด้านบน'
      );
      return;
    }
    setBulkPickDates({ [selectedCalendarYmd]: true });
    setBulkPickMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1));
    setBulkUserIds({});
    setBulkAllowedBranchId(null);
    setBulkShiftId((prev) => prev ?? shifts[0]?.id ?? null);
    setBulkOpen(true);
  }

  function toggleBulkPickDate(ymd: string) {
    setBulkPickDates((prev) => {
      const next = { ...prev };
      if (next[ymd]) delete next[ymd];
      else next[ymd] = true;
      return next;
    });
  }

  function shiftBulkPickMonth(delta: number) {
    setBulkPickMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));
  }

  async function saveBulkAssignments() {
    if (shiftModuleMissing) {
      toast.info(
        'ฐานข้อมูลยังไม่พร้อม',
        'รัน migration 20260415200000_leave_late_shifts.sql บน Supabase ก่อน'
      );
      return;
    }
    if (!session?.user?.id || !bulkShiftId) {
      toast.info('ข้อมูลไม่ครบ', 'เลือกกะและวันที่จากปฏิทิน');
      return;
    }
    const days = bulkPickDateList;
    if (days.length === 0) {
      toast.info('วันที่', 'เลือกอย่างน้อย 1 วันจากปฏิทิน');
      return;
    }
    const uids = Object.keys(bulkUserIds).filter((k) => bulkUserIds[k]);
    if (uids.length === 0) {
      toast.info('พนักงาน', 'เลือกอย่างน้อย 1 คน');
      return;
    }
    const nowIso = new Date().toISOString();
    const chunk: {
      user_id: string;
      work_date: string;
      shift_id: string;
      allowed_branch_id: number | null;
      created_by: string;
      created_at: string;
    }[] = [];
    for (const uid of uids) {
      for (const d of days) {
        chunk.push({
          user_id: uid,
          work_date: d,
          shift_id: bulkShiftId,
          allowed_branch_id: bulkAllowedBranchId,
          created_by: session.user.id,
          created_at: nowIso,
        });
      }
    }
    setBulkSaving(true);
    try {
      const batchSize = 80;
      for (let i = 0; i < chunk.length; i += batchSize) {
        const part = chunk.slice(i, i + batchSize);
        const { error } = await supabase
          .from('work_schedule_assignments')
          .upsert(part, { onConflict: 'user_id,work_date' });
        if (error) throw new Error(error.message);
      }
      await deleteEmployeeHolidayDatesForPairs(
        chunk.map((row) => ({ user_id: row.user_id, holiday_date: row.work_date }))
      );
      setBulkOpen(false);
      setBulkUserIds({});
      setBulkPickDates({});
      setBulkAllowedBranchId(null);
      await load();
      toast.success('มอบหมายแล้ว', `รวม ${chunk.length} แถว — ทับวันหยุดเดิมของวันเดียวกันแล้ว`);
    } catch (e) {
      toast.error(
        'มอบหมายไม่สำเร็จ',
        e instanceof Error ? e.message : String(e)
      );
    } finally {
      setBulkSaving(false);
    }
  }

  function openHolidaySetup() {
    if (holidayModuleMissing) {
      toast.info(
        'ฐานข้อมูล',
        'รัน migration employee_holiday_dates ก่อน จึงจะตั้งวันหยุดได้'
      );
      return;
    }
    setHolidayPickDates({ [selectedCalendarYmd]: true });
    setHolidayUserIds({});
    setHolidayPickMonth(
      new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1)
    );
    setHolidayOpen(true);
  }

  function toggleHolidayPickDate(ymd: string) {
    setHolidayPickDates((prev) => {
      const next = { ...prev };
      if (next[ymd]) delete next[ymd];
      else next[ymd] = true;
      return next;
    });
  }

  function shiftHolidayPickMonth(delta: number) {
    setHolidayPickMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));
  }

  async function saveHolidayDates() {
    if (!session?.user?.id) return;
    if (holidayModuleMissing) {
      toast.info('ฐานข้อมูล', 'รัน migration employee_holiday_dates ก่อน');
      return;
    }
    const uids = Object.keys(holidayUserIds).filter((k) => holidayUserIds[k]);
    const dates = holidayPickDateList;
    if (uids.length === 0) {
      toast.info('พนักงาน', 'เลือกอย่างน้อย 1 คน');
      return;
    }
    if (dates.length === 0) {
      toast.info('วันหยุด', 'เลือกอย่างน้อย 1 วันจากปฏิทิน');
      return;
    }
    setHolidaySaving(true);
    try {
      const nowIso = new Date().toISOString();
      const rows = uids.flatMap((user_id) =>
        dates.map((holiday_date) => ({
          user_id,
          holiday_date,
          created_by: session.user.id,
          created_at: nowIso,
        }))
      );
      const batchSize = 80;
      for (let i = 0; i < rows.length; i += batchSize) {
        const part = rows.slice(i, i + batchSize);
        const { error } = await supabase
          .from('employee_holiday_dates')
          .upsert(part, { onConflict: 'user_id,holiday_date' });
        if (error) throw new Error(error.message);
      }
      await deleteScheduleAssignmentsForPairs(
        rows.map((row) => ({ user_id: row.user_id, work_date: row.holiday_date }))
      );
      setHolidayOpen(false);
      setHolidayUserIds({});
      setHolidayPickDates({});
      await load();
      toast.success(
        'บันทึกวันหยุดแล้ว',
        `${uids.length} คน · ${dates.length} วัน — ทับมอบหมายกะเดิมของวันเดียวกันแล้ว`
      );
    } catch (e) {
      toast.error('บันทึกวันหยุดไม่สำเร็จ', e instanceof Error ? e.message : String(e));
    } finally {
      setHolidaySaving(false);
    }
  }

  function openEditAssignment(a: AssignmentWithShift) {
    setEditingAssignment(a);
    setEditAsnShiftId(a.shift_id);
    setEditAsnBranchId(a.allowed_branch_id ?? null);
    setEditAsnDate(new Date(`${a.work_date}T12:00:00+07:00`));
    setEditAsnOpen(true);
  }

  async function saveEditedAssignment() {
    if (!editingAssignment || !editAsnShiftId || !editAsnDate) {
      toast.info('ข้อมูลไม่ครบ', 'เลือกวันและกะที่ต้องการ');
      return;
    }
    setEditAsnSaving(true);
    try {
      const ymd = dateToBangkokYmd(editAsnDate);
      const nowIso = new Date().toISOString();
      const { error } = await supabase
        .from('work_schedule_assignments')
        .update({
          work_date: ymd,
          shift_id: editAsnShiftId,
          allowed_branch_id: editAsnBranchId,
          created_at: nowIso,
        })
        .eq('id', editingAssignment.id);
      if (error) throw new Error(error.message);
      await deleteEmployeeHolidayDatesForPairs([
        { user_id: editingAssignment.user_id, holiday_date: ymd },
      ]);
      setEditAsnOpen(false);
      setEditingAssignment(null);
      await load();
      toast.success('แก้ไขมอบหมายแล้ว', 'อัปเดตข้อมูลเรียบร้อย');
    } catch (e) {
      toast.error('แก้ไขไม่สำเร็จ', e instanceof Error ? e.message : String(e));
    } finally {
      setEditAsnSaving(false);
    }
  }

  async function saveBulkEditedAssignments() {
    if (!mgr || selectedDetailAssignments.length === 0 || !bulkEditAsnShiftId) return;
    setBulkEditAsnSaving(true);
    try {
      const ids = selectedDetailAssignments.map((a) => a.id);
      const { error } = await supabase
        .from('work_schedule_assignments')
        .update({
          shift_id: bulkEditAsnShiftId,
          allowed_branch_id: bulkEditAsnBranchId,
        })
        .in('id', ids);
      if (error) throw new Error(error.message);
      setBulkEditAsnOpen(false);
      setSelectedDetailAssignmentIds({});
      await load();
      toast.success('แก้ไขมอบหมายแล้ว', `อัปเดต ${ids.length} รายการเรียบร้อย`);
    } catch (e) {
      toast.error('แก้ไขหลายรายการไม่สำเร็จ', e instanceof Error ? e.message : String(e));
    } finally {
      setBulkEditAsnSaving(false);
    }
  }

  async function deleteSelectedAssignments() {
    if (!mgr || selectedDetailAssignments.length === 0 || bulkDeleteAsnSaving) return;
    setBulkDeleteAsnSaving(true);
    try {
      const ids = selectedDetailAssignments.map((a) => a.id);
      const { error } = await supabase.from('work_schedule_assignments').delete().in('id', ids);
      if (error) throw new Error(error.message);
      setBulkDeleteAsnConfirmOpen(false);
      setSelectedDetailAssignmentIds({});
      await load();
      toast.success('ลบมอบหมายแล้ว', `ลบ ${ids.length} รายการเรียบร้อย`);
    } catch (e) {
      toast.error('ลบหลายรายการไม่สำเร็จ', e instanceof Error ? e.message : String(e));
    } finally {
      setBulkDeleteAsnSaving(false);
    }
  }

  function askDeleteAssignment(a: AssignmentWithShift) {
    setDeleteTarget({
      kind: 'assignment',
      id: a.id,
      label: `${a.work_date} · ${a.work_shifts?.name ?? 'กะ'}`,
    });
    setConfirmDeleteOpen(true);
  }

  async function deleteAssignment(a: AssignmentWithShift) {
    if (!mgr) return;
    const { error } = await supabase.from('work_schedule_assignments').delete().eq('id', a.id);
    if (error) {
      toast.error('ลบไม่สำเร็จ', error.message);
      return;
    }
    await load();
    toast.success('ลบมอบหมายแล้ว');
  }

  function openEditSchedule(item: WorkScheduleRow) {
    setEditingSchedule(item);
    setEditScheduleTitle(item.title ?? '');
    setEditScheduleStartAt(item.start_at);
    setEditScheduleEndAt(item.end_at);
    setEditScheduleOpen(true);
  }

  async function saveEditedSchedule() {
    if (!editingSchedule || !editScheduleStartAt.trim() || !editScheduleEndAt.trim()) {
      toast.info('ข้อมูลไม่ครบ', 'กรอกเวลาเริ่ม/สิ้นสุด');
      return;
    }
    setEditScheduleSaving(true);
    try {
      const { error } = await supabase
        .from('work_schedules')
        .update({
          title: editScheduleTitle.trim() || null,
          start_at: editScheduleStartAt.trim(),
          end_at: editScheduleEndAt.trim(),
        })
        .eq('id', editingSchedule.id);
      if (error) throw new Error(error.message);
      setEditScheduleOpen(false);
      setEditingSchedule(null);
      await load();
      toast.success('แก้ไขตารางแล้ว');
    } catch (e) {
      toast.error('แก้ไขไม่สำเร็จ', e instanceof Error ? e.message : String(e));
    } finally {
      setEditScheduleSaving(false);
    }
  }

  function askDeleteSchedule(item: WorkScheduleRow) {
    setDeleteTarget({
      kind: 'schedule',
      id: item.id,
      label: item.title || 'ตาราง ISO',
    });
    setConfirmDeleteOpen(true);
  }

  async function deleteSchedule(item: WorkScheduleRow) {
    if (!mgr) return;
    const { error } = await supabase.from('work_schedules').delete().eq('id', item.id);
    if (error) {
      toast.error('ลบไม่สำเร็จ', error.message);
      return;
    }
    await load();
    toast.success('ลบตารางแล้ว');
  }

  function openEditShift(item: WorkShiftRow) {
    setEditingShift(item);
    setEditShiftName(item.name);
    setEditShiftStart(item.start_time.slice(0, 5));
    setEditShiftEnd(item.end_time.slice(0, 5));
    setEditShiftOpen(true);
  }

  async function saveEditedShift() {
    if (!editingShift || !editShiftName.trim()) {
      toast.info('ข้อมูลไม่ครบ', 'กรุณากรอกชื่อกะ');
      return;
    }
    setEditShiftSaving(true);
    try {
      const { error } = await supabase
        .from('work_shifts')
        .update({
          name: editShiftName.trim(),
          start_time: toPgTime(editShiftStart),
          end_time: toPgTime(editShiftEnd),
        })
        .eq('id', editingShift.id);
      if (error) throw new Error(error.message);
      setEditShiftOpen(false);
      setEditingShift(null);
      await load();
      toast.success('แก้ไขกะแล้ว');
    } catch (e) {
      toast.error('แก้ไขกะไม่สำเร็จ', e instanceof Error ? e.message : String(e));
    } finally {
      setEditShiftSaving(false);
    }
  }

  function askDeleteShift(item: WorkShiftRow) {
    setDeleteTarget({
      kind: 'shift',
      id: item.id,
      label: `${item.name} (${item.start_time.slice(0, 5)}-${item.end_time.slice(0, 5)})`,
    });
    setConfirmDeleteOpen(true);
  }

  async function deleteShift(item: WorkShiftRow) {
    if (!mgr) return;
    const { error } = await supabase.from('work_shifts').delete().eq('id', item.id);
    if (error) {
      toast.error('ลบกะไม่สำเร็จ', error.message);
      return;
    }
    await load();
    toast.success('ลบกะแล้ว');
  }

  async function confirmDeleteNow() {
    if (!deleteTarget || deletingNow) return;
    setDeletingNow(true);
    try {
      if (deleteTarget.kind === 'assignment') {
        const target = assignments.find((x) => x.id === deleteTarget.id);
        if (target) await deleteAssignment(target);
      } else if (deleteTarget.kind === 'schedule') {
        const target = rows.find((x) => x.id === deleteTarget.id);
        if (target) await deleteSchedule(target);
      } else {
        const target = shifts.find((x) => x.id === deleteTarget.id);
        if (target) await deleteShift(target);
      }
      setConfirmDeleteOpen(false);
      setDeleteTarget(null);
    } finally {
      setDeletingNow(false);
    }
  }

  const modalSheetPad = { paddingBottom: Math.max(insets.bottom, 14) + 8 };

  if (loading) {
    return (
      <AppLoadingScreen
        title="กำลังโหลดตารางงาน"
        subtitle="กำลังเตรียมกะ รายชื่อพนักงาน และสาขาที่เข้าได้"
      />
    );
  }

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={listRefreshing}
            onRefresh={async () => {
              setListRefreshing(true);
              try {
                await load();
              } finally {
                setListRefreshing(false);
              }
            }}
            tintColor={c.primary}
          />
        }>
      <Text style={styles.hint}>
        จัดการกะ template + มอบหมายรายวัน และดูปฏิทินว่าพนักงานเข้าเวลากะไหน/สาขาใด
      </Text>

      {shiftModuleMissing ? (
        <View style={styles.schemaWarn}>
          <Text style={styles.schemaWarnTitle}>ยังไม่มีตารางกะใน Supabase</Text>
          <Text style={styles.schemaWarnBody}>
            รันไฟล์ migration 20260415200000_leave_late_shifts.sql (ในโฟลเดอร์
            supabase/migrations) บนโปรเจกต์ของคุณ จากนั้นใน Dashboard: Database →
            Reload schema หรือรอสักครู่ แล้วดึงลงมารีเฟรชหน้านี้
          </Text>
        </View>
      ) : null}

      {mgr ? (
        <View style={styles.mgrRow}>
          <Pressable
            style={[styles.addBtnAlt, shiftModuleMissing && styles.btnDisabled]}
            onPress={() => {
              if (shiftModuleMissing) {
                toast.info(
                  'ฐานข้อมูล',
                  'รัน migration ก่อน จึงจะเพิ่มกะได้ — ดูกล่องแจ้งเตือนด้านบน'
                );
                return;
              }
              setShiftOpen(true);
            }}>
            <Text style={styles.addBtnAltText}>+ กะ</Text>
          </Pressable>
          <Pressable
            style={[styles.addBtnAlt, shiftModuleMissing && styles.btnDisabled]}
            onPress={openBulkSetup}>
            <Text style={styles.addBtnAltText}>มอบหมาย</Text>
          </Pressable>
          <Pressable
            style={[styles.addBtnAlt, holidayModuleMissing && styles.btnDisabled]}
            onPress={openHolidaySetup}>
            <Text style={styles.addBtnAltText}>วันหยุด</Text>
          </Pressable>
        </View>
      ) : (
        <Text style={styles.muted}>
          มอบหมายกะรายวันและแก้กะ — เฉพาะผู้จัดการ/แอดมิน
        </Text>
      )}

      <Text style={styles.section}>ปฏิทินตารางงานรายวัน</Text>
      <View style={styles.calendarCard}>
        <View style={styles.calendarHeader}>
          <Pressable style={styles.calendarNavBtn} onPress={() => shiftCalendarMonth(-1)}>
            <Text style={styles.calendarNavText}>‹</Text>
          </Pressable>
          <View style={styles.calendarHeaderCenter}>
            <Text style={styles.calendarTitle}>{monthTitleTh(calendarMonth)}</Text>
            <Text style={styles.calendarSubtitle}>
              เลือกวันที่เพื่อดูพนักงาน กะ และสาขาที่เข้าได้
            </Text>
          </View>
          <Pressable style={styles.calendarNavBtn} onPress={() => shiftCalendarMonth(1)}>
            <Text style={styles.calendarNavText}>›</Text>
          </Pressable>
        </View>
        <Pressable style={styles.calendarTodayBtn} onPress={jumpCalendarToday}>
          <Text style={styles.calendarTodayText}>วันนี้</Text>
        </Pressable>
        <View style={styles.calendarWeekRow}>
          {WEEKDAY_LABELS_TH.map((label) => (
            <Text key={label} style={styles.calendarWeekText}>
              {label}
            </Text>
          ))}
        </View>
        <View style={styles.calendarGrid}>
          {calendarCells.map((ymd, index) => {
            const count = ymd ? assignmentsByDate.get(ymd)?.length ?? 0 : 0;
            const holidayCount = ymd ? holidaysByDate.get(ymd)?.length ?? 0 : 0;
            const leaveCount = ymd ? leaveEntriesByDate.get(ymd)?.length ?? 0 : 0;
            const companyHoliday = ymd ? companyHolidaysByDate.get(ymd) : undefined;
            const selected = ymd === selectedCalendarYmd;
            const today = ymd === dateToBangkokYmd(new Date());
            return (
              <Pressable
                key={`${ymd ?? 'blank'}-${index}`}
                style={[
                  styles.calendarCell,
                  !ymd && styles.calendarCellBlank,
                  count > 0 && styles.calendarCellHasWork,
                  today && styles.calendarCellToday,
                  selected && styles.calendarCellSelected,
                ]}
                disabled={!ymd}
                onPress={() => {
                  if (!ymd) return;
                  setSelectedCalendarYmd(ymd);
                  openCalendarDetail('all');
                }}>
                {ymd ? (
                  <>
                    <Text
                      style={[
                        styles.calendarDayText,
                        selected && styles.calendarDayTextSelected,
                      ]}>
                      {dateFromYmd(ymd).getDate()}
                    </Text>
                    {count > 0 ? (
                      <Text
                        style={[
                          styles.calendarCountText,
                          selected && styles.calendarDayTextSelected,
                        ]}>
                        {count} คน
                      </Text>
                    ) : null}
                    {companyHoliday ? (
                      <Text
                        style={[
                          styles.calendarCompanyHolidayText,
                          selected && styles.calendarCompanyHolidayTextSelected,
                        ]}
                        numberOfLines={1}>
                        {companyHoliday.title}
                      </Text>
                    ) : null}
                    {holidayCount > 0 ? (
                      <Text
                        style={[
                          styles.calendarHolidayCountText,
                          selected && styles.calendarDayTextSelected,
                        ]}>
                        หยุด {holidayCount}
                      </Text>
                    ) : null}
                    {leaveCount > 0 ? (
                      <Text
                        style={[
                          styles.calendarLeaveCountText,
                          selected && styles.calendarDayTextSelected,
                        ]}>
                        ลา {leaveCount}
                      </Text>
                    ) : null}
                  </>
                ) : null}
              </Pressable>
            );
          })}
        </View>
        <View style={styles.calendarSelectedSummary}>
          <View style={styles.calendarSelectedBody}>
            <Text style={styles.dayDetailTitle}>{formatSelectedDateTh(selectedCalendarYmd)}</Text>
            <Text style={styles.dayDetailEmpty}>
              {selectedCompanyHoliday
                ? `วันหยุดบริษัท: ${selectedCompanyHoliday.title}`
                : selectedDayAssignments.length > 0
                  ? `มีพนักงานเข้างาน ${selectedDayAssignments.length} คน`
                  : 'ไม่มีพนักงานถูกมอบหมายในวันนี้'}
              {!selectedCompanyHoliday && selectedDayAssignments.length > 0
                ? ''
                : selectedCompanyHoliday && selectedDayAssignments.length > 0
                  ? ` · เข้างาน ${selectedDayAssignments.length} คน`
                  : ''}
              {selectedDayHolidayRows.length > 0
                ? `${selectedCompanyHoliday || selectedDayAssignments.length > 0 ? ' · ' : ''}หยุด ${selectedDayHolidayRows.length} คน`
                : ''}
              {selectedDayLeaveRows.length > 0
                ? `${selectedCompanyHoliday || selectedDayAssignments.length > 0 || selectedDayHolidayRows.length > 0 ? ' · ' : ''}ลา ${selectedDayLeaveRows.length} คน`
                : ''}
            </Text>
          </View>
          <Pressable style={styles.calendarDetailBtn} onPress={() => openCalendarDetail('all')}>
            <Text style={styles.calendarDetailBtnText}>ดูรายละเอียด</Text>
          </Pressable>
        </View>
      </View>

      <Text style={styles.section}>มอบหมายล่าสุด</Text>
      {visibleAssignments.length === 0 ? (
        <Text style={styles.empty}>ยังไม่มีมอบหมายรายวัน</Text>
      ) : (
        <>
          <Text style={styles.hint}>
            แสดงรายชื่อพนักงานทั้งหมด — กดชื่อเพื่อดูมอบหมายรายวันของคนนั้น (โหลดครบทุกแถวจากระบบ; เรียงวันที่ล่าสุดก่อน)
          </Text>
          <Pressable style={styles.pickEmployeeBtn} onPress={() => setAssignmentPickerOpen(true)}>
            <Text style={styles.pickEmployeeBtnText}>
              {selectedAssignmentUserId
                ? `พนักงาน: ${peopleLabel.get(selectedAssignmentUserId) ?? selectedAssignmentUserId.slice(0, 8)}`
                : 'เลือกพนักงานเพื่อดูรายละเอียด'}
            </Text>
          </Pressable>
          <View style={styles.assignmentUserCardWrap}>
            {assignmentUsers.map((u) => {
              const active = selectedAssignmentUserId === u.id;
              return (
                <Pressable
                  key={u.id}
                  style={[styles.assignmentUserCard, active && styles.assignmentUserCardOn]}
                  onPress={() => openAssignmentDetail(u.id)}>
                  <View style={styles.pickerEmployeeRow}>
                    <UserAvatar uri={u.avatarUrl ?? undefined} label={u.label} size={42} />
                    <View style={styles.pickerEmployeeBody}>
                      <Text style={[styles.assignmentUserCardName, active && styles.assignmentUserCardNameOn]}>
                        {u.label}
                      </Text>
                      <Text style={styles.assignmentUserCardMeta}>{u.subtitle}</Text>
                      <Text style={styles.assignmentUserCardMeta}>มอบหมาย {u.count} รายการ</Text>
                    </View>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </>
      )}

      <Text style={styles.section}>กะ (template)</Text>
      {shifts.length === 0 ? (
        <Text style={styles.empty}>ยังไม่มีกะ — ให้ผู้จัดการเพิ่ม</Text>
      ) : (
        shifts.map((sh) => (
          <View key={sh.id} style={styles.card}>
            <Text style={styles.cardTitle}>{sh.name}</Text>
            <Text style={styles.cardMeta}>
              {sh.start_time.slice(0, 5)} – {sh.end_time.slice(0, 5)}
            </Text>
            {mgr ? (
              <View style={styles.cardActions}>
                <Pressable onPress={() => openEditShift(sh)}>
                  <Text style={styles.linkBtn}>แก้ไข</Text>
                </Pressable>
                <Pressable onPress={() => askDeleteShift(sh)}>
                  <Text style={styles.linkBtnDanger}>ลบ</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        ))
      )}

      </ScrollView>

      <Modal
        visible={calendarDetailOpen}
        animationType="slide"
        transparent
        statusBarTranslucent
        presentationStyle="overFullScreen"
        onRequestClose={() => setCalendarDetailOpen(false)}>
        <View style={[styles.backdrop, WEB_MODAL_BACKDROP]}>
          <Pressable style={styles.backdropHit} onPress={() => setCalendarDetailOpen(false)} />
          <View style={[styles.modal, modalSheetPad]}>
            <Text style={styles.modalTitle}>
              ตารางงาน {formatSelectedDateTh(selectedCalendarYmd)}
            </Text>
            <Text style={styles.cardMeta}>
              แสดงแยกตามสาขา พร้อมรายชื่อพนักงาน ตำแหน่ง และกะงาน
            </Text>
            <View style={styles.detailFilterRow}>
              {(
                [
                  { key: 'all' as const, label: 'ทั้งหมด' },
                  { key: 'holiday' as const, label: 'วันหยุด' },
                  { key: 'leave' as const, label: 'ลา' },
                  { key: 'work' as const, label: 'มาทำงาน' },
                ] as const
              ).map((opt) => {
                const active = calendarDetailFilter === opt.key;
                return (
                  <Pressable
                    key={opt.key}
                    style={[
                      styles.detailFilterChip,
                      active && opt.key === 'holiday' && styles.detailFilterChipHolidayOn,
                      active && opt.key === 'leave' && styles.detailFilterChipLeaveOn,
                      active && opt.key !== 'holiday' && opt.key !== 'leave' && styles.detailFilterChipOn,
                    ]}
                    onPress={() => setCalendarDetailFilter(opt.key)}>
                    <Text
                      style={[
                        styles.detailFilterChipText,
                        active && opt.key === 'holiday' && styles.detailFilterChipTextHolidayOn,
                        active && opt.key === 'leave' && styles.detailFilterChipTextLeaveOn,
                        active &&
                          opt.key !== 'holiday' &&
                          opt.key !== 'leave' &&
                          styles.detailFilterChipTextOn,
                      ]}>
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <ScrollView
              style={styles.modalScroll}
              contentContainerStyle={styles.modalScrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator>
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
              {(calendarDetailFilter === 'all' || calendarDetailFilter === 'holiday') &&
              selectedDayHolidayGroups.length > 0 ? (
                <View style={styles.scheduleHolidaySection}>
                  <Text style={styles.scheduleHolidaySectionTitle}>วันหยุด</Text>
                  {selectedDayHolidayGroups.map((group) => (
                    <View key={`hol-${group.branchName}`} style={styles.scheduleHolidayGroup}>
                      <View style={styles.scheduleHolidayHeader}>
                        <Text style={styles.scheduleHolidayTitle}>{group.branchName}</Text>
                        <Text style={styles.scheduleHolidayCount}>
                          หยุด {group.userIds.length} คน
                        </Text>
                      </View>
                      {group.userIds.map((uid) => {
                        const person = peopleById.get(uid);
                        const display = employeeDisplayByProfileId[uid];
                        const name =
                          display?.label ??
                          peopleLabel.get(uid) ??
                          person?.email ??
                          uid.slice(0, 8);
                        const subtitle =
                          positionByProfileId[uid] ||
                          `${roleLabelTh(person?.role)} · ${person?.employee_code?.trim() || '—'}`;
                        return (
                          <View key={uid} style={styles.scheduleBranchEmployeeRow}>
                            <UserAvatar
                              uri={person?.avatar_url ?? undefined}
                              label={name}
                              size={40}
                            />
                            <View style={styles.scheduleEmployeeBody}>
                              <Text style={styles.scheduleEmployeeName}>{name}</Text>
                              <Text style={styles.scheduleEmployeeMeta}>{subtitle}</Text>
                              <Text style={styles.scheduleHolidayBadge}>วันหยุด</Text>
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  ))}
                </View>
              ) : null}
              {calendarDetailFilter === 'holiday' && selectedDayHolidayRows.length === 0 ? (
                <Text style={styles.empty}>ไม่มีพนักงานหยุดในวันนี้</Text>
              ) : null}
              {calendarDetailFilter === 'leave' && selectedDayLeaveRows.length === 0 ? (
                <Text style={styles.empty}>ไม่มีพนักงานลาในวันนี้</Text>
              ) : null}
              {calendarDetailFilter === 'work' && selectedDayAssignments.length === 0 ? (
                <Text style={styles.empty}>ไม่มีพนักงานถูกมอบหมายเข้างานในวันนี้</Text>
              ) : null}
              {calendarDetailFilter === 'all' &&
              selectedDayAssignments.length === 0 &&
              selectedDayHolidayRows.length === 0 &&
              selectedDayLeaveRows.length === 0 ? (
                <Text style={styles.empty}>ไม่มีพนักงานถูกมอบหมาย หยุด หรือลาในวันนี้</Text>
              ) : null}
              {(calendarDetailFilter === 'all' || calendarDetailFilter === 'leave') &&
              selectedDayLeaveGroups.length > 0 ? (
                <View style={styles.scheduleLeaveSection}>
                  <Text style={styles.scheduleLeaveSectionTitle}>ลา</Text>
                  {selectedDayLeaveGroups.map((group) => (
                    <View key={`lv-${group.branchName}`} style={styles.scheduleLeaveGroup}>
                      <View style={styles.scheduleLeaveHeader}>
                        <Text style={styles.scheduleLeaveTitle}>{group.branchName}</Text>
                        <Text style={styles.scheduleLeaveCount}>
                          ลา {group.entries.length} คน
                        </Text>
                      </View>
                      {group.entries.map((entry) => {
                        const person = peopleById.get(entry.user_id);
                        const display = employeeDisplayByProfileId[entry.user_id];
                        const name =
                          display?.label ??
                          peopleLabel.get(entry.user_id) ??
                          person?.email ??
                          entry.user_id.slice(0, 8);
                        const subtitle =
                          positionByProfileId[entry.user_id] ||
                          `${roleLabelTh(person?.role)} · ${person?.employee_code?.trim() || '—'}`;
                        const leaveRange =
                          entry.starts_on === entry.ends_on
                            ? formatShortDateTh(entry.starts_on)
                            : `${formatShortDateTh(entry.starts_on)} – ${formatShortDateTh(entry.ends_on)}`;
                        return (
                          <View key={`${entry.leave_id}-${entry.user_id}`} style={styles.scheduleBranchEmployeeRow}>
                            <UserAvatar
                              uri={person?.avatar_url ?? undefined}
                              label={name}
                              size={40}
                            />
                            <View style={styles.scheduleEmployeeBody}>
                              <Text style={styles.scheduleEmployeeName}>{name}</Text>
                              <Text style={styles.scheduleEmployeeMeta}>{subtitle}</Text>
                              <Text style={styles.scheduleLeaveBadge}>
                                {leaveTypeLabelTh(entry.leave_type)} · อนุมัติแล้ว
                              </Text>
                              <Text style={styles.scheduleLeaveMeta}>ช่วงลา {leaveRange}</Text>
                              {entry.reason?.trim() ? (
                                <Text style={styles.scheduleLeaveReason} numberOfLines={2}>
                                  {entry.reason.trim()}
                                </Text>
                              ) : null}
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  ))}
                </View>
              ) : null}
              {(calendarDetailFilter === 'all' || calendarDetailFilter === 'work') &&
              selectedDayAssignments.length > 0 ? (
                <View style={styles.scheduleWorkSection}>
                  {calendarDetailFilter === 'all' ? (
                    <Text style={styles.scheduleWorkSectionTitle}>มาทำงาน</Text>
                  ) : null}
                  {selectedDayAssignmentGroups.map((group) => (
                  <View key={group.branchName} style={styles.scheduleBranchGroup}>
                    <View style={styles.scheduleBranchHeader}>
                      <Text style={styles.scheduleBranchTitle}>{group.branchName}</Text>
                      <Text style={styles.scheduleBranchCount}>
                        เข้างาน {group.assignments.length} คน
                      </Text>
                    </View>
                    {group.assignments.map((a) => {
                      const person = peopleById.get(a.user_id);
                      const display = employeeDisplayByProfileId[a.user_id];
                      const name =
                        display?.label ??
                        peopleLabel.get(a.user_id) ??
                        person?.email ??
                        a.user_id.slice(0, 8);
                      const subtitle =
                        positionByProfileId[a.user_id] ||
                        `${roleLabelTh(person?.role)} · ${person?.employee_code?.trim() || '—'}`;
                      const shiftName = a.work_shifts?.name ?? 'กะ';
                      const shiftTime = `${a.work_shifts?.start_time?.slice(0, 5) ?? '?'}-${
                        a.work_shifts?.end_time?.slice(0, 5) ?? '?'
                      }`;
                      return (
                        <View key={a.id} style={styles.scheduleBranchEmployeeRow}>
                          <UserAvatar
                            uri={person?.avatar_url ?? undefined}
                            label={name}
                            size={40}
                          />
                          <View style={styles.scheduleEmployeeBody}>
                            <Text style={styles.scheduleEmployeeName}>{name}</Text>
                            <Text style={styles.scheduleEmployeeMeta}>{subtitle}</Text>
                            <Text style={styles.scheduleEmployeeShift}>
                              {shiftName} {shiftTime}
                            </Text>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                ))}
                </View>
              ) : null}
            </ScrollView>
            <View style={styles.actions}>
              <Pressable onPress={() => setCalendarDetailOpen(false)}>
                <Text style={{ color: c.text }}>ปิด</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={assignmentPickerOpen}
        animationType="slide"
        transparent
        statusBarTranslucent
        presentationStyle="overFullScreen"
        onRequestClose={() => setAssignmentPickerOpen(false)}>
        <View style={[styles.backdrop, WEB_MODAL_BACKDROP]}>
          <Pressable style={styles.backdropHit} onPress={() => setAssignmentPickerOpen(false)} />
          <View style={[styles.modal, modalSheetPad]}>
            <Text style={styles.modalTitle}>เลือกพนักงาน</Text>
            <TextInput
              style={styles.input}
              placeholder="ค้นหาชื่อพนักงาน..."
              placeholderTextColor={c.textMuted}
              value={assignmentSearch}
              onChangeText={setAssignmentSearch}
            />
            <FlatList
              style={styles.listTall}
              data={filteredAssignmentUsers}
              keyExtractor={(item) => item.id}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => {
                const selected = selectedAssignmentUserId === item.id;
                  return (
                  <Pressable
                    style={[styles.row, selected && styles.rowOn]}
                    onPress={() => {
                      openAssignmentDetail(item.id);
                      setAssignmentPickerOpen(false);
                    }}>
                    <View style={styles.pickerEmployeeRow}>
                      <UserAvatar uri={item.avatarUrl ?? undefined} label={item.label} size={40} />
                      <View style={styles.pickerEmployeeBody}>
                        <Text style={{ color: c.text, fontWeight: selected ? '700' : '500' }}>
                          {item.label}
                        </Text>
                        <Text style={styles.pickerEmployeeMeta}>{item.subtitle}</Text>
                        <Text style={styles.pickerEmployeeMeta}>มอบหมาย {item.count} รายการ</Text>
                      </View>
                    </View>
                  </Pressable>
                  );
              }}
              ListEmptyComponent={
                <Text style={styles.empty}>
                  {assignmentUsers.length === 0 ? 'ยังไม่มีรายชื่อพนักงานในขอบเขต' : 'ไม่พบรายชื่อที่ค้นหา'}
                </Text>
              }
            />
            <View style={styles.actions}>
              <Pressable
                onPress={() => {
                  setSelectedAssignmentUserId(null);
                  setAssignmentPickerOpen(false);
                }}>
                <Text style={{ color: c.text }}>ล้างการเลือก</Text>
              </Pressable>
              <Pressable onPress={() => setAssignmentPickerOpen(false)}>
                <Text style={{ color: c.text }}>ปิด</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={assignmentDetailOpen}
        animationType="slide"
        transparent
        statusBarTranslucent
        presentationStyle="overFullScreen"
        onRequestClose={closeAssignmentDetail}>
        <View style={[styles.backdrop, WEB_MODAL_BACKDROP]}>
          <Pressable style={styles.backdropHit} onPress={closeAssignmentDetail} />
          <View style={[styles.modal, modalSheetPad]}>
            <Text style={styles.modalTitle}>
              รายละเอียดของ{' '}
              {selectedAssignmentUserId
                ? peopleLabel.get(selectedAssignmentUserId) ?? selectedAssignmentUserId.slice(0, 8)
                : '-'}
            </Text>
            {mgr && assignmentDetailRows.length > 0 ? (
              <View style={styles.multiActionBar}>
                <Pressable style={styles.multiSelectBtn} onPress={toggleAllDetailAssignments}>
                  <Text style={styles.multiSelectBtnText}>
                    {allDetailRowsSelected ? 'ยกเลิกทั้งหมด' : 'เลือกทั้งหมด'}
                  </Text>
                </Pressable>
                <Text style={styles.multiSelectedText}>
                  เลือก {selectedDetailAssignments.length} รายการ
                </Text>
                <Pressable
                  style={[
                    styles.multiEditBtn,
                    selectedDetailAssignments.length === 0 && styles.btnDisabled,
                  ]}
                  disabled={selectedDetailAssignments.length === 0}
                  onPress={openBulkEditAssignments}>
                  <Text style={styles.multiEditBtnText}>แก้ไขที่เลือก</Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.multiDeleteBtn,
                    selectedDetailAssignments.length === 0 && styles.btnDisabled,
                  ]}
                  disabled={selectedDetailAssignments.length === 0}
                  onPress={() => setBulkDeleteAsnConfirmOpen(true)}>
                  <Text style={styles.multiDeleteBtnText}>ลบที่เลือก</Text>
                </Pressable>
              </View>
            ) : null}
            <ScrollView
              style={styles.modalScroll}
              contentContainerStyle={styles.modalScrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator>
              {detailSheetLoading && detailSheetAssignments === null ? (
                <ActivityIndicator
                  size="large"
                  color={c.primary}
                  style={{ marginVertical: 24 }}
                />
              ) : assignmentDetailRows.length === 0 ? (
                <Text style={styles.empty}>พนักงานคนนี้ยังไม่มีมอบหมายรายวัน</Text>
              ) : (
                assignmentDetailRows.map((a) => (
                  <View key={a.id} style={styles.card}>
                    <View style={styles.assignmentDetailHead}>
                      {mgr ? (
                        <Pressable
                          style={[
                            styles.assignmentCheckbox,
                            selectedDetailAssignmentIds[a.id] && styles.assignmentCheckboxOn,
                          ]}
                          onPress={() => toggleDetailAssignment(a.id)}
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: !!selectedDetailAssignmentIds[a.id] }}>
                          <Text style={styles.assignmentCheckboxText}>
                            {selectedDetailAssignmentIds[a.id] ? '✓' : ''}
                          </Text>
                        </Pressable>
                      ) : null}
                      <Text style={[styles.cardTitle, styles.assignmentDetailTitle]}>
                        {a.work_date} · {a.work_shifts?.name ?? 'กะ'}
                      </Text>
                    </View>
                    <Text style={styles.cardMeta}>
                      {a.work_shifts?.start_time?.slice(0, 5) ?? '?'} –{' '}
                      {a.work_shifts?.end_time?.slice(0, 5) ?? '?'}
                    </Text>
                    <Text style={styles.cardMeta}>
                      สาขาเข้า:{' '}
                      {a.allowed_branch_id != null
                        ? branchLabel.get(a.allowed_branch_id) ?? `#${a.allowed_branch_id}`
                        : 'ไม่จำกัด'}
                    </Text>
                    {mgr ? (
                      <View style={styles.cardActions}>
                        <Pressable
                          onPress={() => {
                            setAssignmentDetailOpen(false);
                            openEditAssignment(a);
                          }}>
                          <Text style={styles.linkBtn}>แก้ไข</Text>
                        </Pressable>
                        <Pressable
                          onPress={() => {
                            setAssignmentDetailOpen(false);
                            askDeleteAssignment(a);
                          }}>
                          <Text style={styles.linkBtnDanger}>ลบ</Text>
                        </Pressable>
                      </View>
                    ) : null}
                  </View>
                ))
              )}
            </ScrollView>
            <View style={styles.actions}>
              <Pressable onPress={closeAssignmentDetail}>
                <Text style={{ color: c.text }}>ปิด</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={bulkEditAsnOpen}
        animationType="slide"
        transparent
        statusBarTranslucent
        presentationStyle="overFullScreen"
        onRequestClose={() => !bulkEditAsnSaving && setBulkEditAsnOpen(false)}>
        <View style={[styles.backdrop, WEB_MODAL_BACKDROP]}>
          <Pressable
            style={styles.backdropHit}
            onPress={() => !bulkEditAsnSaving && setBulkEditAsnOpen(false)}
          />
          <View style={[styles.modal, modalSheetPad]}>
            <ScrollView
              style={styles.modalScroll}
              contentContainerStyle={styles.modalScrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator>
              <Text style={styles.modalTitle}>
                แก้ไขมอบหมายหลายรายการ ({selectedDetailAssignments.length})
              </Text>
              <Text style={styles.cardMeta}>
                การแก้ไขหลายรายการจะปรับเฉพาะ “กะ” และ “สาขาที่เข้าได้” ของรายการที่เลือก
              </Text>
              <Text style={styles.label}>กะ</Text>
              {shifts.map((sh) => (
                <Pressable
                  key={sh.id}
                  style={[styles.row, bulkEditAsnShiftId === sh.id && styles.rowOn]}
                  onPress={() => setBulkEditAsnShiftId(sh.id)}>
                  <Text style={{ color: c.text }}>
                    {sh.name} ({sh.start_time.slice(0, 5)}–{sh.end_time.slice(0, 5)})
                  </Text>
                </Pressable>
              ))}
              <Text style={styles.label}>สาขาที่เข้าได้</Text>
              <Pressable
                style={[styles.row, bulkEditAsnBranchId == null && styles.rowOn]}
                onPress={() => setBulkEditAsnBranchId(null)}>
                <Text style={{ color: c.text }}>ไม่จำกัดสาขา</Text>
              </Pressable>
              {branches.map((br) => (
                <Pressable
                  key={String(br.id)}
                  style={[styles.row, bulkEditAsnBranchId === br.id && styles.rowOn]}
                  onPress={() => setBulkEditAsnBranchId(br.id)}>
                  <Text style={{ color: c.text }}>
                    {br.branch_name || br.branch_code || `สาขา ${br.id}`}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
            <View style={styles.actions}>
              <Pressable onPress={() => setBulkEditAsnOpen(false)} disabled={bulkEditAsnSaving}>
                <Text style={{ color: c.text }}>ยกเลิก</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.save,
                  (bulkEditAsnSaving || !bulkEditAsnShiftId) && { opacity: 0.6 },
                ]}
                onPress={() => void saveBulkEditedAssignments()}
                disabled={bulkEditAsnSaving || !bulkEditAsnShiftId}>
                <Text style={styles.saveText}>
                  {bulkEditAsnSaving ? 'กำลังบันทึก…' : 'บันทึกหลายรายการ'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={bulkDeleteAsnConfirmOpen}
        transparent
        animationType="fade"
        statusBarTranslucent
        presentationStyle="overFullScreen"
        onRequestClose={() => !bulkDeleteAsnSaving && setBulkDeleteAsnConfirmOpen(false)}>
        <View style={[styles.backdrop, WEB_MODAL_BACKDROP]}>
          <Pressable
            style={styles.backdropHit}
            onPress={() => !bulkDeleteAsnSaving && setBulkDeleteAsnConfirmOpen(false)}
          />
          <View style={[styles.modal, modalSheetPad]}>
            <Text style={styles.modalTitle}>ยืนยันลบหลายรายการ</Text>
            <Text style={styles.cardMeta}>
              ต้องการลบมอบหมายที่เลือก {selectedDetailAssignments.length} รายการใช่ไหม
            </Text>
            <View style={styles.actions}>
              <Pressable
                onPress={() => setBulkDeleteAsnConfirmOpen(false)}
                disabled={bulkDeleteAsnSaving}>
                <Text style={{ color: c.text }}>ยกเลิก</Text>
              </Pressable>
              <Pressable
                style={[styles.deleteBtn, bulkDeleteAsnSaving && { opacity: 0.6 }]}
                onPress={() => void deleteSelectedAssignments()}
                disabled={bulkDeleteAsnSaving}>
                <Text style={styles.deleteBtnText}>
                  {bulkDeleteAsnSaving ? 'กำลังลบ…' : 'ยืนยันลบ'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={open}
        animationType="slide"
        transparent
        statusBarTranslucent
        presentationStyle="overFullScreen"
        onRequestClose={() => setOpen(false)}>
        <View style={[styles.backdrop, WEB_MODAL_BACKDROP]}>
          <Pressable
            style={styles.backdropHit}
            onPress={() => setOpen(false)}
            accessibilityRole="button"
            accessibilityLabel="ปิด"
          />
          <View style={[styles.modal, modalSheetPad]}>
            <Text style={styles.modalTitle}>เพิ่มตารางงาน (ISO)</Text>
            <TextInput
              style={styles.input}
              placeholder="หัวข้อ (ถ้ามี)"
              placeholderTextColor={c.textMuted}
              value={title}
              onChangeText={setTitle}
            />
            <TextInput
              style={styles.input}
              placeholder="เริ่ม (ISO datetime)"
              placeholderTextColor={c.textMuted}
              value={startAt}
              onChangeText={setStartAt}
            />
            <TextInput
              style={styles.input}
              placeholder="สิ้นสุด (ISO datetime)"
              placeholderTextColor={c.textMuted}
              value={endAt}
              onChangeText={setEndAt}
            />
            <Text style={styles.label}>พนักงาน</Text>
            <FlatList
              style={styles.list}
              data={people}
              keyExtractor={(p) => p.id}
              renderItem={({ item: p }) => {
                const label =
                  employeeDisplayByProfileId[p.id]?.label ??
                  peopleLabel.get(p.id) ??
                  p.id.slice(0, 8);
                const meta =
                  positionByProfileId[p.id] ||
                  `${roleLabelTh(p.role)} · ${p.employee_code?.trim() || '—'}`;
                return (
                  <Pressable
                    style={[styles.row, userId === p.id && styles.rowOn]}
                    onPress={() => setUserId(p.id)}>
                    <View style={styles.pickerEmployeeRow}>
                      <UserAvatar uri={p.avatar_url ?? undefined} label={label} size={36} />
                      <View style={styles.pickerEmployeeBody}>
                        <Text style={{ color: c.text, fontWeight: userId === p.id ? '800' : '500' }}>
                          {label}
                        </Text>
                        <Text style={styles.pickerEmployeeMeta}>{meta}</Text>
                      </View>
                    </View>
                  </Pressable>
                );
              }}
            />
            <View style={styles.actions}>
              <Pressable onPress={() => setOpen(false)}>
                <Text style={{ color: c.text }}>ยกเลิก</Text>
              </Pressable>
              <Pressable style={styles.save} onPress={saveSchedule}>
                <Text style={styles.saveText}>บันทึก</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={shiftOpen}
        animationType="slide"
        transparent
        statusBarTranslucent
        presentationStyle="overFullScreen"
        onRequestClose={() => setShiftOpen(false)}>
        <View style={[styles.backdrop, WEB_MODAL_BACKDROP]}>
          <Pressable
            style={styles.backdropHit}
            onPress={() => setShiftOpen(false)}
            accessibilityRole="button"
            accessibilityLabel="ปิด"
          />
          <View style={[styles.modal, modalSheetPad]}>
            <Text style={styles.modalTitle}>เพิ่มกะ (template)</Text>
            <TextInput
              style={styles.input}
              placeholder="ชื่อกะ เช่น กะเช้า"
              placeholderTextColor={c.textMuted}
              value={shiftName}
              onChangeText={setShiftName}
            />
            <TextInput
              style={styles.input}
              placeholder="เริ่ม HH:MM"
              placeholderTextColor={c.textMuted}
              value={shiftStart}
              onChangeText={setShiftStart}
            />
            <TextInput
              style={styles.input}
              placeholder="สิ้นสุด HH:MM"
              placeholderTextColor={c.textMuted}
              value={shiftEnd}
              onChangeText={setShiftEnd}
            />
            <View style={styles.actions}>
              <Pressable onPress={() => setShiftOpen(false)}>
                <Text style={{ color: c.text }}>ยกเลิก</Text>
              </Pressable>
              <Pressable style={styles.save} onPress={saveShift}>
                <Text style={styles.saveText}>บันทึก</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={bulkOpen}
        animationType="slide"
        transparent
        statusBarTranslucent
        presentationStyle="overFullScreen"
        onRequestClose={() => setBulkOpen(false)}>
        <View style={[styles.backdrop, WEB_MODAL_BACKDROP]}>
          <Pressable
            style={styles.backdropHit}
            onPress={() => !bulkSaving && setBulkOpen(false)}
            accessibilityRole="button"
            accessibilityLabel="ปิด"
          />
          <View style={[styles.modal, modalSheetPad]}>
            <Text style={styles.modalTitle}>มอบหมายกะหลายวัน</Text>
            <ScrollView
              style={styles.modalScroll}
              contentContainerStyle={styles.modalScrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator>
              <Text style={styles.label}>กะ</Text>
              {shifts.map((sh) => (
                <Pressable
                  key={sh.id}
                  style={[styles.row, bulkShiftId === sh.id && styles.rowOn]}
                  onPress={() => setBulkShiftId(sh.id)}>
                  <Text style={{ color: c.text }}>
                    {sh.name} ({sh.start_time.slice(0, 5)}–{sh.end_time.slice(0, 5)})
                  </Text>
                </Pressable>
              ))}
              <Text style={styles.label}>วันที่มอบหมาย</Text>
              <Text style={styles.cardMeta}>
                แตะวันที่ในปฏิทินเพื่อเลือกหลายวันได้ (ไม่จำเป็นต้องต่อเนื่อง)
              </Text>
              <Text style={styles.holidayPickSummary}>
                {bulkPickDateList.length > 0
                  ? formatHolidayDateListTh(bulkPickDateList)
                  : 'ยังไม่ได้เลือกวัน — แตะวันที่ในปฏิทินด้านล่าง'}
              </Text>
              <View style={styles.holidayMiniCalendar}>
                <View style={styles.calendarHeader}>
                  <Pressable
                    style={styles.calendarNavBtn}
                    onPress={() => shiftBulkPickMonth(-1)}
                    disabled={bulkSaving}>
                    <Text style={styles.calendarNavText}>‹</Text>
                  </Pressable>
                  <Text style={styles.calendarTitle}>{monthTitleTh(bulkPickMonth)}</Text>
                  <Pressable
                    style={styles.calendarNavBtn}
                    onPress={() => shiftBulkPickMonth(1)}
                    disabled={bulkSaving}>
                    <Text style={styles.calendarNavText}>›</Text>
                  </Pressable>
                </View>
                <View style={styles.calendarWeekRow}>
                  {WEEKDAY_LABELS_TH.map((label) => (
                    <Text key={`bp-${label}`} style={styles.calendarWeekText}>
                      {label}
                    </Text>
                  ))}
                </View>
                <View style={styles.calendarGrid}>
                  {bulkPickCalendarCells.map((ymd, index) => {
                    const picked = ymd ? !!bulkPickDates[ymd] : false;
                    const hasAssignment = ymd && (assignmentsByDate.get(ymd)?.length ?? 0) > 0;
                    return (
                      <Pressable
                        key={`bp-cell-${ymd ?? 'blank'}-${index}`}
                        style={[
                          styles.calendarCell,
                          !ymd && styles.calendarCellBlank,
                          hasAssignment && !picked && styles.bulkPickCellSaved,
                          picked && styles.bulkPickCellOn,
                        ]}
                        disabled={!ymd || bulkSaving}
                        onPress={() => ymd && toggleBulkPickDate(ymd)}>
                        {ymd ? (
                          <Text
                            style={[
                              styles.calendarDayText,
                              picked && styles.bulkPickCellTextOn,
                            ]}>
                            {dateFromYmd(ymd).getDate()}
                          </Text>
                        ) : null}
                      </Pressable>
                    );
                  })}
                </View>
              </View>
              <Text style={styles.label}>สาขาที่เข้าได้ (ตามตาราง)</Text>
              <Pressable
                style={[styles.row, bulkAllowedBranchId == null && styles.rowOn]}
                onPress={() => setBulkAllowedBranchId(null)}>
                <Text style={{ color: c.text }}>ไม่จำกัดสาขา</Text>
              </Pressable>
              {branches.map((br) => (
                <Pressable
                  key={String(br.id)}
                  style={[styles.row, bulkAllowedBranchId === br.id && styles.rowOn]}
                  onPress={() => setBulkAllowedBranchId(br.id)}>
                  <Text style={{ color: c.text }}>
                    {(br.branch_name || br.branch_code || `สาขา ${br.id}`) +
                      (br.branch_code ? ` (${br.branch_code})` : '')}
                  </Text>
                </Pressable>
              ))}
              <Text style={styles.label}>พนักงาน (แตะเลือกหลายคน)</Text>
              {people.map((p) => {
                const on = !!bulkUserIds[p.id];
                const label =
                  employeeDisplayByProfileId[p.id]?.label ??
                  peopleLabel.get(p.id) ??
                  p.id.slice(0, 8);
                const meta =
                  positionByProfileId[p.id] ||
                  `${roleLabelTh(p.role)} · ${p.employee_code?.trim() || '—'}`;
                return (
                  <Pressable
                    key={p.id}
                    style={[styles.row, on && styles.rowOn]}
                    onPress={() =>
                      setBulkUserIds((prev) => ({ ...prev, [p.id]: !on }))
                    }>
                    <View style={styles.pickerEmployeeRow}>
                      <UserAvatar uri={p.avatar_url ?? undefined} label={label} size={36} />
                      <View style={styles.pickerEmployeeBody}>
                        <Text style={{ color: c.text, fontWeight: on ? '800' : '500' }}>
                          {(on ? '✓ ' : '') + label}
                        </Text>
                        <Text style={styles.pickerEmployeeMeta}>{meta}</Text>
                      </View>
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
            <View style={styles.actions}>
              <Pressable onPress={() => setBulkOpen(false)} disabled={bulkSaving}>
                <Text style={{ color: c.text }}>ยกเลิก</Text>
              </Pressable>
              <Pressable
                style={[styles.save, bulkSaving && { opacity: 0.6 }]}
                onPress={saveBulkAssignments}
                disabled={bulkSaving}>
                <Text style={styles.saveText}>
                  {bulkSaving ? 'กำลังบันทึก…' : 'บันทึก'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={holidayOpen}
        animationType="slide"
        transparent
        statusBarTranslucent
        presentationStyle="overFullScreen"
        onRequestClose={() => !holidaySaving && setHolidayOpen(false)}>
        <View style={[styles.backdrop, WEB_MODAL_BACKDROP]}>
          <Pressable
            style={styles.backdropHit}
            onPress={() => !holidaySaving && setHolidayOpen(false)}
            accessibilityRole="button"
            accessibilityLabel="ปิด"
          />
          <View style={[styles.modal, modalSheetPad]}>
            <ScrollView
              style={styles.modalScroll}
              contentContainerStyle={styles.modalScrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator>
              <Text style={styles.modalTitle}>ตั้งวันหยุด</Text>
              <Text style={styles.cardMeta}>
                เลือกวันที่จากปฏิทินได้หลายวัน (แต่ละวันที่เลือกจะเป็นวันหยุดเฉพาะวันนั้น
                ไม่ซ้ำทุกสัปดาห์) แล้วเลือกพนักงานที่ต้องการ
              </Text>
              <Text style={styles.label}>วันที่เลือก</Text>
              <Text style={styles.holidayPickSummary}>
                {holidayPickDateList.length > 0
                  ? formatHolidayDateListTh(holidayPickDateList)
                  : 'ยังไม่ได้เลือกวัน — แตะวันที่ในปฏิทินด้านล่าง'}
              </Text>
              <View style={styles.holidayMiniCalendar}>
                <View style={styles.calendarHeader}>
                  <Pressable
                    style={styles.calendarNavBtn}
                    onPress={() => shiftHolidayPickMonth(-1)}
                    disabled={holidaySaving}>
                    <Text style={styles.calendarNavText}>‹</Text>
                  </Pressable>
                  <Text style={styles.calendarTitle}>{monthTitleTh(holidayPickMonth)}</Text>
                  <Pressable
                    style={styles.calendarNavBtn}
                    onPress={() => shiftHolidayPickMonth(1)}
                    disabled={holidaySaving}>
                    <Text style={styles.calendarNavText}>›</Text>
                  </Pressable>
                </View>
                <View style={styles.calendarWeekRow}>
                  {WEEKDAY_LABELS_TH.map((label) => (
                    <Text key={`hp-${label}`} style={styles.calendarWeekText}>
                      {label}
                    </Text>
                  ))}
                </View>
                <View style={styles.calendarGrid}>
                  {holidayPickCalendarCells.map((ymd, index) => {
                    const picked = ymd ? !!holidayPickDates[ymd] : false;
                    const hasSavedHoliday =
                      ymd && (holidaysByDate.get(ymd)?.length ?? 0) > 0;
                    return (
                      <Pressable
                        key={`hp-cell-${ymd ?? 'blank'}-${index}`}
                        style={[
                          styles.calendarCell,
                          !ymd && styles.calendarCellBlank,
                          hasSavedHoliday && !picked && styles.holidayPickCellSaved,
                          picked && styles.holidayPickCellOn,
                        ]}
                        disabled={!ymd || holidaySaving}
                        onPress={() => ymd && toggleHolidayPickDate(ymd)}>
                        {ymd ? (
                          <Text
                            style={[
                              styles.calendarDayText,
                              picked && styles.holidayPickCellTextOn,
                            ]}>
                            {dateFromYmd(ymd).getDate()}
                          </Text>
                        ) : null}
                      </Pressable>
                    );
                  })}
                </View>
              </View>
              <Text style={styles.label}>พนักงาน (เลือกได้หลายคน)</Text>
              {people.map((p) => {
                const on = !!holidayUserIds[p.id];
                const display = employeeDisplayByProfileId[p.id];
                const label =
                  display?.label ?? peopleLabel.get(p.id) ?? p.id.slice(0, 8);
                const meta =
                  positionByProfileId[p.id] ||
                  `${roleLabelTh(p.role)} · ${p.employee_code?.trim() || '—'}`;
                return (
                  <Pressable
                    key={p.id}
                    style={[styles.row, on && styles.rowOn]}
                    onPress={() =>
                      setHolidayUserIds((prev) => ({ ...prev, [p.id]: !prev[p.id] }))
                    }>
                    <View style={styles.pickerEmployeeRow}>
                      <UserAvatar uri={p.avatar_url ?? undefined} label={label} size={36} />
                      <View style={styles.pickerEmployeeBody}>
                        <Text style={{ color: c.text, fontWeight: on ? '800' : '500' }}>
                          {label}
                        </Text>
                        <Text style={styles.pickerEmployeeMeta}>{meta}</Text>
                      </View>
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
            <View style={styles.actions}>
              <Pressable onPress={() => setHolidayOpen(false)} disabled={holidaySaving}>
                <Text style={{ color: c.text }}>ยกเลิก</Text>
              </Pressable>
              <Pressable
                style={[styles.save, holidaySaving && { opacity: 0.6 }]}
                onPress={() => void saveHolidayDates()}
                disabled={holidaySaving}>
                <Text style={styles.saveText}>
                  {holidaySaving ? 'กำลังบันทึก…' : 'บันทึกวันหยุด'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={editAsnOpen}
        animationType="slide"
        transparent
        statusBarTranslucent
        presentationStyle="overFullScreen"
        onRequestClose={() => setEditAsnOpen(false)}>
        <View style={[styles.backdrop, WEB_MODAL_BACKDROP]}>
          <Pressable
            style={styles.backdropHit}
            onPress={() => !editAsnSaving && setEditAsnOpen(false)}
          />
          <View style={[styles.modal, modalSheetPad]}>
            <ScrollView
              style={styles.modalScroll}
              contentContainerStyle={styles.modalScrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator>
              <Text style={styles.modalTitle}>แก้ไขมอบหมาย</Text>
              <DatePickerField
                label="วันที่ทำงาน"
                value={editAsnDate}
                onChange={setEditAsnDate}
                disabled={editAsnSaving}
              />
              <Text style={styles.label}>กะ</Text>
              {shifts.map((sh) => (
                <Pressable
                  key={sh.id}
                  style={[styles.row, editAsnShiftId === sh.id && styles.rowOn]}
                  onPress={() => setEditAsnShiftId(sh.id)}>
                  <Text style={{ color: c.text }}>
                    {sh.name} ({sh.start_time.slice(0, 5)}–{sh.end_time.slice(0, 5)})
                  </Text>
                </Pressable>
              ))}
              <Text style={styles.label}>สาขาที่เข้าได้</Text>
              <Pressable
                style={[styles.row, editAsnBranchId == null && styles.rowOn]}
                onPress={() => setEditAsnBranchId(null)}>
                <Text style={{ color: c.text }}>ไม่จำกัดสาขา</Text>
              </Pressable>
              {branches.map((br) => (
                <Pressable
                  key={String(br.id)}
                  style={[styles.row, editAsnBranchId === br.id && styles.rowOn]}
                  onPress={() => setEditAsnBranchId(br.id)}>
                  <Text style={{ color: c.text }}>
                    {br.branch_name || br.branch_code || `สาขา ${br.id}`}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
            <View style={styles.actions}>
              <Pressable onPress={() => setEditAsnOpen(false)} disabled={editAsnSaving}>
                <Text style={{ color: c.text }}>ยกเลิก</Text>
              </Pressable>
              <Pressable
                style={[styles.save, editAsnSaving && { opacity: 0.6 }]}
                onPress={() => void saveEditedAssignment()}
                disabled={editAsnSaving}>
                <Text style={styles.saveText}>{editAsnSaving ? 'กำลังบันทึก…' : 'บันทึก'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={editScheduleOpen}
        animationType="slide"
        transparent
        statusBarTranslucent
        presentationStyle="overFullScreen"
        onRequestClose={() => setEditScheduleOpen(false)}>
        <View style={[styles.backdrop, WEB_MODAL_BACKDROP]}>
          <Pressable
            style={styles.backdropHit}
            onPress={() => !editScheduleSaving && setEditScheduleOpen(false)}
          />
          <View style={[styles.modal, modalSheetPad]}>
            <Text style={styles.modalTitle}>แก้ไขตาราง ISO</Text>
            <TextInput
              style={styles.input}
              placeholder="หัวข้อ (ถ้ามี)"
              placeholderTextColor={c.textMuted}
              value={editScheduleTitle}
              onChangeText={setEditScheduleTitle}
            />
            <TextInput
              style={styles.input}
              placeholder="เริ่ม (ISO datetime)"
              placeholderTextColor={c.textMuted}
              value={editScheduleStartAt}
              onChangeText={setEditScheduleStartAt}
            />
            <TextInput
              style={styles.input}
              placeholder="สิ้นสุด (ISO datetime)"
              placeholderTextColor={c.textMuted}
              value={editScheduleEndAt}
              onChangeText={setEditScheduleEndAt}
            />
            <View style={styles.actions}>
              <Pressable onPress={() => setEditScheduleOpen(false)} disabled={editScheduleSaving}>
                <Text style={{ color: c.text }}>ยกเลิก</Text>
              </Pressable>
              <Pressable
                style={[styles.save, editScheduleSaving && { opacity: 0.6 }]}
                onPress={() => void saveEditedSchedule()}
                disabled={editScheduleSaving}>
                <Text style={styles.saveText}>
                  {editScheduleSaving ? 'กำลังบันทึก…' : 'บันทึก'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={editShiftOpen}
        animationType="slide"
        transparent
        statusBarTranslucent
        presentationStyle="overFullScreen"
        onRequestClose={() => setEditShiftOpen(false)}>
        <View style={[styles.backdrop, WEB_MODAL_BACKDROP]}>
          <Pressable
            style={styles.backdropHit}
            onPress={() => !editShiftSaving && setEditShiftOpen(false)}
          />
          <View style={[styles.modal, modalSheetPad]}>
            <ScrollView
              style={styles.modalScroll}
              contentContainerStyle={styles.modalScrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator>
              <Text style={styles.modalTitle}>แก้ไขกะ</Text>
              <TextInput
                style={styles.input}
                placeholder="ชื่อกะ"
                placeholderTextColor={c.textMuted}
                value={editShiftName}
                onChangeText={setEditShiftName}
              />
              <TextInput
                style={styles.input}
                placeholder="เริ่ม HH:MM"
                placeholderTextColor={c.textMuted}
                value={editShiftStart}
                onChangeText={setEditShiftStart}
              />
              <TextInput
                style={styles.input}
                placeholder="สิ้นสุด HH:MM"
                placeholderTextColor={c.textMuted}
                value={editShiftEnd}
                onChangeText={setEditShiftEnd}
              />
            </ScrollView>
            <View style={styles.actions}>
              <Pressable onPress={() => setEditShiftOpen(false)} disabled={editShiftSaving}>
                <Text style={{ color: c.text }}>ยกเลิก</Text>
              </Pressable>
              <Pressable
                style={[styles.save, editShiftSaving && { opacity: 0.6 }]}
                onPress={() => void saveEditedShift()}
                disabled={editShiftSaving}>
                <Text style={styles.saveText}>
                  {editShiftSaving ? 'กำลังบันทึก…' : 'บันทึก'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={confirmDeleteOpen}
        transparent
        animationType="fade"
        statusBarTranslucent
        presentationStyle="overFullScreen"
        onRequestClose={() => !deletingNow && setConfirmDeleteOpen(false)}>
        <View style={[styles.backdrop, WEB_MODAL_BACKDROP]}>
          <Pressable
            style={styles.backdropHit}
            onPress={() => !deletingNow && setConfirmDeleteOpen(false)}
          />
          <View style={[styles.modal, modalSheetPad]}>
            <Text style={styles.modalTitle}>ยืนยันการลบ</Text>
            <Text style={styles.cardMeta}>
              ต้องการลบรายการนี้ใช่ไหม
              {deleteTarget?.label ? `\n${deleteTarget.label}` : ''}
            </Text>
            <View style={styles.actions}>
              <Pressable
                onPress={() => setConfirmDeleteOpen(false)}
                disabled={deletingNow}>
                <Text style={{ color: c.text }}>ยกเลิก</Text>
              </Pressable>
              <Pressable
                style={[styles.deleteBtn, deletingNow && { opacity: 0.6 }]}
                onPress={() => void confirmDeleteNow()}
                disabled={deletingNow}>
                <Text style={styles.deleteBtnText}>{deletingNow ? 'กำลังลบ…' : 'ยืนยันลบ'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function createScheduleStyles(theme: AppTheme) {
  const c = theme.colors;
  const r = theme.radius;
  const s = theme.spacing;
  const holiday = {
    main: '#DC2626',
    dark: '#991B1B',
    bg: '#FEF2F2',
    border: '#FECACA',
  };

  return StyleSheet.create({
  root: { flex: 1, backgroundColor: c.canvas },
  screen: { flex: 1, backgroundColor: c.canvas },
  content: { paddingBottom: s.scrollBottom },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  hint: { paddingHorizontal: s.screen, paddingTop: 6, color: c.textMuted, fontSize: 12 },
  muted: {
    marginHorizontal: s.screen,
    marginBottom: s.section,
    color: c.textMuted,
    fontSize: 13,
  },
  mgrRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: s.gapRow,
    paddingHorizontal: s.screen,
    marginBottom: s.section,
  },
  addBtn: {
    flexGrow: 1,
    minWidth: 100,
    backgroundColor: c.primary,
    padding: 10,
    borderRadius: r.sm,
    alignItems: 'center',
  },
  addBtnText: { color: c.onAccent, fontWeight: '700' },
  addBtnAlt: {
    flexGrow: 1,
    minWidth: 88,
    backgroundColor: c.surface,
    padding: 10,
    borderRadius: r.sm,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: c.border,
  },
  addBtnAltText: { color: c.primaryDark, fontWeight: '700' },
  btnDisabled: { opacity: 0.45 },
  schemaWarn: {
    marginHorizontal: s.screen,
    marginBottom: s.section,
    padding: s.card,
    borderRadius: r.md,
    backgroundColor: c.errorBg,
    borderWidth: 1,
    borderColor: c.error,
  },
  schemaWarnTitle: { fontWeight: '700', color: c.error, marginBottom: 6 },
  schemaWarnBody: { fontSize: 13, color: c.textSecondary, lineHeight: 20 },
  section: {
    fontWeight: '700',
    fontSize: 15,
    color: c.text,
    marginHorizontal: s.screen,
    marginTop: 10,
    marginBottom: 6,
  },
  calendarCard: {
    marginHorizontal: s.screen,
    marginBottom: s.section,
    padding: s.card,
    borderRadius: r.md,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.borderSoft,
  },
  calendarHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  calendarHeaderCenter: { flex: 1, minWidth: 0, alignItems: 'center' },
  calendarTitle: { color: c.text, fontSize: 16, fontWeight: '900' },
  calendarSubtitle: {
    color: c.textMuted,
    fontSize: 11,
    marginTop: 3,
    textAlign: 'center',
  },
  calendarNavBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: c.surfaceMuted,
    borderWidth: 1,
    borderColor: c.borderSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calendarNavText: { color: c.primaryDark, fontSize: 24, fontWeight: '900', lineHeight: 26 },
  calendarTodayBtn: {
    alignSelf: 'center',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: c.primaryLight,
    borderWidth: 1,
    borderColor: c.primaryMuted,
    marginBottom: 10,
  },
  calendarTodayText: { color: c.primaryDark, fontSize: 12, fontWeight: '800' },
  calendarWeekRow: {
    flexDirection: 'row',
    marginBottom: 6,
  },
  calendarWeekText: {
    flex: 1,
    textAlign: 'center',
    color: c.textMuted,
    fontSize: 11,
    fontWeight: '800',
  },
  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderColor: c.borderSoft,
    borderRadius: r.sm,
    overflow: 'hidden',
  },
  calendarCell: {
    width: `${100 / 7}%`,
    minHeight: 54,
    paddingVertical: 7,
    paddingHorizontal: 3,
    backgroundColor: c.surfaceMuted,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: c.borderSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calendarCellBlank: { opacity: 0.35 },
  calendarCellHasWork: { backgroundColor: 'rgba(166, 184, 116, 0.11)' },
  calendarCellToday: { borderColor: c.primaryMuted },
  calendarCellSelected: { backgroundColor: c.primary, borderColor: c.primary },
  calendarDayText: { color: c.text, fontSize: 13, fontWeight: '800' },
  calendarDayTextSelected: { color: c.onAccent },
  calendarCountText: { color: c.primaryDark, fontSize: 9, fontWeight: '800', marginTop: 3 },
  calendarHolidayCountText: { color: holiday.main, fontSize: 8, fontWeight: '800', marginTop: 2 },
  calendarLeaveCountText: { color: c.leaveSickBar, fontSize: 8, fontWeight: '800', marginTop: 2 },
  calendarCompanyHolidayText: {
    color: '#DC2626',
    fontSize: 7,
    fontWeight: '900',
    marginTop: 2,
    textAlign: 'center',
  },
  calendarCompanyHolidayTextSelected: {
    color: '#FEE2E2',
  },
  companyHolidayBanner: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
  },
  companyHolidayBannerLabel: {
    color: '#DC2626',
    fontSize: 12,
    fontWeight: '900',
    marginBottom: 4,
  },
  companyHolidayBannerTitle: {
    color: '#991B1B',
    fontSize: 17,
    fontWeight: '900',
  },
  companyHolidayBannerDesc: {
    color: c.textMuted,
    fontSize: 14,
    marginTop: 8,
    lineHeight: 20,
  },
  calendarSelectedSummary: {
    marginTop: 12,
    padding: 10,
    borderRadius: r.sm,
    backgroundColor: c.surfaceMuted,
    borderWidth: 1,
    borderColor: c.borderSoft,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  calendarSelectedBody: { flex: 1, minWidth: 0 },
  calendarDetailBtn: {
    borderRadius: 999,
    backgroundColor: c.primary,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  calendarDetailBtnText: { color: c.onAccent, fontSize: 12, fontWeight: '800' },
  dayDetailPanel: {
    marginTop: 12,
    padding: 10,
    borderRadius: r.sm,
    backgroundColor: c.surfaceMuted,
    borderWidth: 1,
    borderColor: c.borderSoft,
  },
  dayDetailTitle: { color: c.text, fontSize: 14, fontWeight: '900', marginBottom: 8 },
  dayDetailEmpty: { color: c.textMuted, fontSize: 12, lineHeight: 18 },
  dayAssignmentRow: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: c.borderSoft,
  },
  dayAssignmentBody: { flex: 1, minWidth: 0 },
  dayAssignmentName: { color: c.text, fontSize: 13, fontWeight: '800' },
  dayAssignmentMeta: { color: c.textMuted, fontSize: 11, marginTop: 3 },
  dayAssignmentBranch: { color: c.primaryDark, fontSize: 11, fontWeight: '800', marginTop: 4 },
  scheduleBranchGroup: {
    marginBottom: 12,
    borderRadius: r.md,
    borderWidth: 1,
    borderColor: c.borderSoft,
    backgroundColor: c.surface,
    overflow: 'hidden',
  },
  scheduleBranchHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: c.primaryLight,
    borderBottomWidth: 1,
    borderBottomColor: c.borderSoft,
  },
  scheduleBranchTitle: {
    flex: 1,
    minWidth: 0,
    color: c.primaryDark,
    fontSize: 14,
    fontWeight: '900',
  },
  scheduleBranchCount: {
    color: c.primaryDark,
    fontSize: 12,
    fontWeight: '800',
  },
  scheduleHolidaySection: {
    marginBottom: 14,
  },
  scheduleWorkSection: {
    marginBottom: 8,
  },
  scheduleWorkSectionTitle: {
    color: c.primaryDark,
    fontSize: 14,
    fontWeight: '900',
    marginBottom: 8,
  },
  detailFilterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  detailFilterChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: c.borderSoft,
    backgroundColor: c.surfaceMuted,
  },
  detailFilterChipOn: {
    backgroundColor: c.primaryLight,
    borderColor: c.primaryMuted,
  },
  detailFilterChipHolidayOn: {
    backgroundColor: holiday.bg,
    borderColor: holiday.border,
  },
  detailFilterChipText: {
    color: c.textMuted,
    fontSize: 13,
    fontWeight: '800',
  },
  detailFilterChipTextOn: {
    color: c.primaryDark,
  },
  detailFilterChipTextHolidayOn: {
    color: holiday.dark,
  },
  detailFilterChipLeaveOn: {
    backgroundColor: c.leaveSickBg,
    borderColor: c.leaveSickBar,
  },
  detailFilterChipTextLeaveOn: {
    color: c.leaveSickBar,
  },
  scheduleHolidaySectionTitle: {
    color: holiday.main,
    fontSize: 14,
    fontWeight: '900',
    marginBottom: 8,
  },
  scheduleHolidayGroup: {
    marginBottom: 10,
    borderRadius: r.md,
    borderWidth: 1,
    borderColor: holiday.border,
    backgroundColor: c.surface,
    overflow: 'hidden',
  },
  scheduleHolidayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: holiday.bg,
    borderBottomWidth: 1,
    borderBottomColor: holiday.border,
  },
  scheduleHolidayTitle: {
    flex: 1,
    minWidth: 0,
    color: holiday.dark,
    fontSize: 14,
    fontWeight: '900',
  },
  scheduleHolidayCount: {
    color: holiday.main,
    fontSize: 12,
    fontWeight: '800',
  },
  scheduleHolidayBadge: {
    marginTop: 4,
    color: holiday.main,
    fontSize: 11,
    fontWeight: '800',
  },
  scheduleLeaveSection: {
    marginBottom: 14,
  },
  scheduleLeaveSectionTitle: {
    color: c.leaveSickBar,
    fontSize: 14,
    fontWeight: '900',
    marginBottom: 8,
  },
  scheduleLeaveGroup: {
    marginBottom: 10,
    borderRadius: r.md,
    borderWidth: 1,
    borderColor: c.leaveSickBar,
    backgroundColor: c.surface,
    overflow: 'hidden',
  },
  scheduleLeaveHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: c.leaveSickBg,
    borderBottomWidth: 1,
    borderBottomColor: c.leaveSickBar,
  },
  scheduleLeaveTitle: {
    flex: 1,
    minWidth: 0,
    color: c.leaveSickBar,
    fontSize: 14,
    fontWeight: '900',
  },
  scheduleLeaveCount: {
    color: c.leaveSickBar,
    fontSize: 12,
    fontWeight: '800',
  },
  scheduleLeaveBadge: {
    marginTop: 4,
    color: c.leaveSickBar,
    fontSize: 11,
    fontWeight: '800',
  },
  scheduleLeaveMeta: {
    color: c.textMuted,
    fontSize: 11,
    marginTop: 3,
  },
  scheduleLeaveReason: {
    color: c.textSecondary,
    fontSize: 11,
    marginTop: 4,
    lineHeight: 16,
  },
  holidayPickSummary: {
    color: c.textSecondary,
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 10,
  },
  holidayMiniCalendar: {
    marginBottom: 14,
    padding: 8,
    borderRadius: r.md,
    borderWidth: 1,
    borderColor: c.borderSoft,
    backgroundColor: c.surfaceMuted,
  },
  holidayPickCellOn: {
    backgroundColor: holiday.main,
    borderColor: holiday.main,
  },
  holidayPickCellSaved: {
    backgroundColor: holiday.bg,
    borderColor: holiday.main,
  },
  holidayPickCellTextOn: {
    color: c.onAccent,
  },
  bulkPickCellOn: {
    backgroundColor: c.primary,
    borderColor: c.primary,
  },
  bulkPickCellSaved: {
    backgroundColor: c.primaryLight,
    borderColor: c.primaryMuted,
  },
  bulkPickCellTextOn: {
    color: c.onAccent,
  },
  scheduleBranchEmployeeRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: c.borderSoft,
  },
  scheduleDayCard: {
    padding: 12,
    marginBottom: 10,
    borderRadius: r.md,
    borderWidth: 1,
    borderColor: c.borderSoft,
    backgroundColor: c.surface,
  },
  scheduleShiftTitle: {
    color: c.primaryDark,
    fontSize: 14,
    fontWeight: '900',
    marginBottom: 10,
  },
  scheduleEmployeeRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  scheduleEmployeeBody: { flex: 1, minWidth: 0 },
  scheduleEmployeeName: { color: c.text, fontSize: 14, fontWeight: '900' },
  scheduleEmployeeMeta: { color: c.textMuted, fontSize: 12, marginTop: 4 },
  scheduleEmployeeShift: {
    color: c.text,
    fontSize: 12,
    fontWeight: '800',
    marginTop: 6,
  },
  scheduleEmployeeBranch: {
    color: c.primaryDark,
    fontSize: 12,
    fontWeight: '800',
    marginTop: 5,
  },
  card: {
    marginHorizontal: s.screen,
    marginBottom: s.section,
    padding: s.card,
    backgroundColor: c.surface,
    borderRadius: r.md,
    borderWidth: 1,
    borderColor: c.borderSoft,
  },
  cardTitle: { fontWeight: '700', color: c.text },
  cardMeta: { marginTop: 6, color: c.textSecondary, fontSize: 13 },
  cardActions: {
    marginTop: 10,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  multiActionBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
    padding: 10,
    borderRadius: r.md,
    backgroundColor: c.surfaceMuted,
    borderWidth: 1,
    borderColor: c.borderSoft,
  },
  multiSelectBtn: {
    borderRadius: r.sm,
    borderWidth: 1,
    borderColor: c.border,
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: c.surface,
  },
  multiSelectBtnText: { color: c.text, fontSize: 12, fontWeight: '700' },
  multiSelectedText: { color: c.textMuted, fontSize: 12, fontWeight: '700', marginRight: 'auto' },
  multiEditBtn: {
    borderRadius: r.sm,
    backgroundColor: c.primaryLight,
    borderWidth: 1,
    borderColor: c.primaryMuted,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  multiEditBtnText: { color: c.primaryDark, fontSize: 12, fontWeight: '800' },
  multiDeleteBtn: {
    borderRadius: r.sm,
    backgroundColor: c.errorBg,
    borderWidth: 1,
    borderColor: c.error,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  multiDeleteBtnText: { color: c.error, fontSize: 12, fontWeight: '800' },
  assignmentDetailHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  assignmentDetailTitle: { flex: 1, minWidth: 0 },
  assignmentCheckbox: {
    width: 26,
    height: 26,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  assignmentCheckboxOn: {
    backgroundColor: c.primary,
    borderColor: c.primaryMuted,
  },
  assignmentCheckboxText: { color: c.onAccent, fontSize: 15, fontWeight: '900' },
  assignmentUserWrap: {
    marginHorizontal: s.screen,
    marginBottom: 8,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  assignmentUserCardWrap: {
    marginHorizontal: s.screen,
    marginBottom: 8,
  },
  assignmentUserCard: {
    marginBottom: 8,
    padding: 10,
    borderRadius: r.md,
    borderWidth: 1,
    borderColor: c.borderSoft,
    backgroundColor: c.surface,
  },
  assignmentUserCardOn: {
    borderColor: c.primaryMuted,
    backgroundColor: c.primaryLight,
  },
  assignmentUserCardName: {
    color: c.text,
    fontWeight: '700',
    fontSize: 14,
  },
  assignmentUserCardNameOn: {
    color: c.primaryDark,
  },
  assignmentUserCardMeta: {
    marginTop: 3,
    color: c.textMuted,
    fontSize: 12,
  },
  assignmentUserChip: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.surface,
  },
  assignmentUserChipOn: {
    backgroundColor: c.primaryLight,
    borderColor: c.primaryMuted,
  },
  assignmentUserChipText: {
    color: c.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  assignmentUserChipTextOn: {
    color: c.primaryDark,
    fontWeight: '700',
  },
  pickEmployeeBtn: {
    marginHorizontal: s.screen,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: r.sm,
    backgroundColor: c.surface,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  pickEmployeeBtnText: {
    color: c.text,
    fontWeight: '600',
  },
  selectedEmployeeTitle: {
    marginHorizontal: s.screen,
    marginTop: 2,
    marginBottom: 8,
    color: c.textSecondary,
    fontWeight: '700',
  },
  pickerEmployeeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  pickerEmployeeBody: {
    flex: 1,
  },
  pickerEmployeeMeta: {
    marginTop: 3,
    color: c.textMuted,
    fontSize: 12,
  },
  linkBtn: { color: c.primaryDark, fontWeight: '700' },
  linkBtnDanger: { color: c.error, fontWeight: '700' },
  deleteBtn: {
    backgroundColor: c.error,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: r.sm,
  },
  deleteBtnText: { color: '#fff', fontWeight: '700' },
  empty: {
    textAlign: 'center',
    color: c.textMuted,
    marginTop: 8,
    marginBottom: 12,
    paddingHorizontal: s.screen,
  },
  backdrop: {
    flex: 1,
    backgroundColor: c.overlay,
    justifyContent: 'flex-end',
    position: 'relative',
  },
  backdropHit: {
    ...StyleSheet.absoluteFillObject,
  },
  modal: {
    backgroundColor: c.surfaceElevated,
    padding: 14,
    paddingTop: 16,
    borderTopLeftRadius: r.lg,
    borderTopRightRadius: r.lg,
    maxHeight: '90%',
    ...(Platform.OS === 'android' ? { elevation: 28 } : {}),
    ...(Platform.OS === 'ios'
      ? {
          shadowColor: '#000',
          shadowOpacity: 0.35,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: -4 },
        }
      : {}),
  },
  modalTitle: { fontSize: 18, fontWeight: '700', marginBottom: 10, color: c.text },
  input: {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: r.sm,
    padding: 10,
    marginBottom: 8,
    backgroundColor: c.surface,
    color: c.text,
  },
  label: { fontWeight: '600', marginBottom: 6, color: c.textSecondary },
  list: { maxHeight: 200, marginBottom: 12 },
  listTall: { maxHeight: 260, marginBottom: 12 },
  modalScroll: { maxHeight: 480 },
  modalScrollContent: { paddingBottom: 8 },
  row: {
    padding: 12,
    marginBottom: 8,
    borderRadius: r.sm,
    borderWidth: 1,
    borderColor: c.borderSoft,
    backgroundColor: c.surface,
  },
  rowOn: {
    backgroundColor: c.primaryLight,
    borderColor: c.primaryMuted,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    alignItems: 'center',
    marginTop: 4,
  },
  save: {
    backgroundColor: c.primary,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: r.sm,
  },
  saveText: { color: c.onAccent, fontWeight: '700' },
  });
}
