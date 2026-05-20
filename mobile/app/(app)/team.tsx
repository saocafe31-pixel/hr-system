import { useCallback, useEffect, useMemo, useState } from 'react';
import * as FileSystem from 'expo-file-system/legacy';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { DatePickerField } from '@/components/DatePickerField';
import { EmployeeScheduleCalendarCard } from '@/components/EmployeeScheduleCalendarCard';
import { FriendlyConfirmModal } from '@/components/FriendlyNoticeModal';
import { TaskProgressBar } from '@/components/TaskProgressBar';
import { UserAvatar } from '@/components/UserAvatar';
import { NatureTheme } from '@/constants/Theme';
import { isAdmin, isManagerOrAdmin, useAuth, useRole } from '@/contexts/AuthContext';
import { useCuteToast } from '@/contexts/CuteToastContext';
import {
  emitLeaveStatusChanged,
  emitTaskStatusChanged,
  onLeaveStatusChanged,
} from '@/lib/appSignals';
import { mapBranchInformationRows } from '@/lib/mapBranchInformation';
import {
  checklistProgress,
  dateToBangkokYmd,
  dateYmdToIsoBangkokEnd,
  dateYmdToIsoBangkokStart,
  notifyTaskStakeholders,
  priorityLabel,
  taskDoneIsOnTime,
  TASK_PRIORITY_OPTIONS,
  TASK_STATUS_TH,
} from '@/lib/taskHelpers';
import {
  assignDisplayHeadline,
  assignMatchesSearch,
  normalizeAssignPickRows,
  type AssignPickRow,
} from '@/lib/taskAssignPicklist';
import { humanizeSupabaseError, supabase } from '@/lib/supabase';
import type {
  AttendanceLog,
  Branch,
  EmployeeDirectory,
  LeaveRequestRow,
  Profile,
  TaskPriority,
  TaskRow,
} from '@/lib/types';

type TeamMemberCard = Profile & { nickname: string | null };
type ProfileExt = Profile & { employee_id?: string | null; avatar_url?: string | null };

const WEB_TEAM_ASSIGN_LAYER = Platform.select({
  web: {
    position: 'fixed' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 500_000,
  },
  default: {},
});
type AttendanceSummaryRow = {
  dateYmd: string;
  checkIn: string;
  checkOut: string;
  checkInIso?: string;
  checkOutIso?: string;
  employeeCode: string;
  checkInLocation: string;
};

const TASK_STATUSES = ['pending', 'in_progress', 'done', 'cancelled'] as const;

type TeamAssignChecklistLine = { id: string; text: string };

function newTeamAssignChecklistLineId(): string {
  return `tc-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

const LEAVE_TYPE_TH: Record<string, string> = {
  sick: 'ลาป่วย',
  personal: 'ลากิจ',
  vacation: 'ลาพักร้อน',
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

function period26to25(anchor: Date): { startYmd: string; endYmd: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(anchor);
  const year = Number(parts.find((p) => p.type === 'year')?.value ?? '0');
  const month = Number(parts.find((p) => p.type === 'month')?.value ?? '1');
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const two = (n: number) => String(n).padStart(2, '0');
  return {
    startYmd: `${prevYear}-${two(prevMonth)}-26`,
    endYmd: `${year}-${two(month)}-25`,
  };
}

function listYmd(startYmd: string, endYmd: string): string[] {
  const out: string[] = [];
  const d = ymdToDate(startYmd);
  const end = ymdToDate(endYmd).getTime();
  while (d.getTime() <= end) {
    out.push(ymdFromDate(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

function csvEscape(v: string): string {
  return `"${v.replaceAll('"', '""')}"`;
}

function htmlEscape(v: string): string {
  return v
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function fmtBangkokDateTimeCsv(iso: string): string {
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

function directoryDisplayName(row: EmployeeDirectory | null | undefined): string {
  if (!row) return '';
  const full = `${row.name ?? ''} ${row.surname ?? ''}`.trim();
  if (full) return full;
  if (row.nickname?.trim()) return row.nickname.trim();
  return '';
}

function pickBestProfileForEmployee(
  emp: EmployeeDirectory,
  profiles: ProfileExt[]
): ProfileExt | null {
  const legacy = emp.legacy_user_id?.trim().toLowerCase() ?? '';
  const empId = String(emp.id);
  const empNo = emp.employee_no != null ? String(emp.employee_no).trim() : '';
  const scored = profiles
    .map((p) => {
      let score = 0;
      const pEmail = p.email?.trim().toLowerCase() ?? '';
      const pEmpId = p.employee_id ? String(p.employee_id) : '';
      const pCode = p.employee_code?.trim() ?? '';
      if (legacy && pEmail === legacy) score += 100;
      if (pEmpId && pEmpId === empId) score += 80;
      if (empNo && pCode === empNo) score += 60;
      if (p.avatar_url) score += 5;
      return { p, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.p ?? null;
}

type AdminBranchGroup = {
  /** คีย์จัดกลุ่มจาก employee.branch + branch_code (ไม่ใช้ branch_information) */
  key: string;
  title: string;
  subtitle: string | null;
  count: number;
};

const EMP_BRANCH_KEY_SEP = '\u0001';

/** คีย์จัดกลุ่มตามข้อความสาขาใน employee (ชื่อสาขา + รหัสสาขา) */
function employeeBranchGroupKey(emp: EmployeeDirectory): string {
  const name = emp.branch?.trim() ?? '';
  const code = emp.branch_code?.trim() ?? '';
  if (!name && !code) return 'none';
  return `${name}${EMP_BRANCH_KEY_SEP}${code}`;
}

function employeeBranchCardTitle(emp: EmployeeDirectory): string {
  const name = emp.branch?.trim() ?? '';
  const code = emp.branch_code?.trim() ?? '';
  if (name) return name;
  if (code) return `รหัสสาขา ${code}`;
  return 'ยังไม่ระบุสาขา';
}

function employeeBranchCardSubtitle(emp: EmployeeDirectory): string | null {
  const name = emp.branch?.trim() ?? '';
  const code = emp.branch_code?.trim() ?? '';
  if (name && code) return `รหัส: ${code}`;
  return null;
}

export default function TeamScreen() {
  const { session } = useAuth();
  const router = useRouter();
  const toast = useCuteToast();
  const role = useRole();
  const admin = isAdmin(role);
  const managerScope = isManagerOrAdmin(role);
  const [profiles, setProfiles] = useState<TeamMemberCard[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState<TeamMemberCard | null>(null);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [branchId, setBranchId] = useState<number | null>(null);
  const [branchText, setBranchText] = useState('');
  const [positionText, setPositionText] = useState('');
  const [memberTasks, setMemberTasks] = useState<TaskRow[]>([]);
  const [memberLogs, setMemberLogs] = useState<AttendanceLog[]>([]);
  const [memberLeaves, setMemberLeaves] = useState<{ starts_on: string; ends_on: string }[]>([]);
  const [summaryAnchorDate, setSummaryAnchorDate] = useState<Date | null>(() => new Date());
  const [detailLoading, setDetailLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [assignTitle, setAssignTitle] = useState('');
  const [assignDesc, setAssignDesc] = useState('');
  const [assignPriority, setAssignPriority] = useState<TaskPriority>('normal');
  const [assignStartDate, setAssignStartDate] = useState<Date | null>(null);
  const [assignDueDate, setAssignDueDate] = useState<Date | null>(null);
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [assignChecklistLines, setAssignChecklistLines] = useState<TeamAssignChecklistLine[]>([
    { id: newTeamAssignChecklistLineId(), text: '' },
  ]);
  const [selectedAssigneeIds, setSelectedAssigneeIds] = useState<string[]>([]);
  const [assigning, setAssigning] = useState(false);
  const [employeeByProfileId, setEmployeeByProfileId] = useState<
    Record<string, EmployeeDirectory>
  >({});
  const [directoryRows, setDirectoryRows] = useState<EmployeeDirectory[]>([]);
  const [profilesRaw, setProfilesRaw] = useState<Profile[]>([]);
  const [editEmployee, setEditEmployee] = useState<EmployeeDirectory | null>(null);
  const [linkingEmployee, setLinkingEmployee] = useState<EmployeeDirectory | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [linkingBusy, setLinkingBusy] = useState(false);
  /** null = จอเลือกกลุ่มสาขา, อื่น = ดูรายชื่อในกลุ่ม (ผู้จัดการ & แอดมิน) */
  const [teamBranchKey, setTeamBranchKey] = useState<string | null>(null);
  const [mgrCanApproveLeave, setMgrCanApproveLeave] = useState(false);
  const [mgrCanManageSchedule, setMgrCanManageSchedule] = useState(false);
  const [pendingTeamLeaves, setPendingTeamLeaves] = useState<LeaveRequestRow[]>([]);
  const [subordinateProfileIds, setSubordinateProfileIds] = useState<string[]>([]);
  const [leaveActionId, setLeaveActionId] = useState<string | null>(null);
  const [teamAssignPicklist, setTeamAssignPicklist] = useState<AssignPickRow[]>([]);
  const [assignTeamSearch, setAssignTeamSearch] = useState('');
  const [memberTaskSearchQuery, setMemberTaskSearchQuery] = useState('');
  const [deleteMemberTaskId, setDeleteMemberTaskId] = useState<string | null>(null);
  const [deleteMemberBusy, setDeleteMemberBusy] = useState(false);

  const load = useCallback(async () => {
    const directoryReq = admin
      ? supabase.rpc('admin_list_employee_directory_rows')
      : role === 'manager'
        ? supabase.rpc('manager_list_team_directory_rows')
        : supabase
            .from('employee_directory')
            .select(
              'id,legacy_user_id,employee_no,name,surname,nickname,phone,branch,branch_code,branch_id'
            );
    const [{ data: p }, { data: b }, { data: dir }] = await Promise.all([
      supabase
        .from('profiles')
        .select(
          'id, email, full_name, role, branch_id, employee_code, phone, employee_id, avatar_url'
        )
        .order('full_name'),
      supabase.from('branch_information').select('*').order('branch_name'),
      directoryReq,
    ]);
    const raw = (p as Record<string, unknown>[]) ?? [];
    const dirRows = (dir as EmployeeDirectory[]) ?? [];
    const profileRows = raw as ProfileExt[];
    const byEmployeeId = new Map<string, EmployeeDirectory>();
    const byLegacy = new Map<string, EmployeeDirectory>();
    const byEmployeeNo = new Map<string, EmployeeDirectory>();
    for (const row of dirRows) {
      if (row.id) byEmployeeId.set(String(row.id), row);
      if (row.legacy_user_id) byLegacy.set(row.legacy_user_id.trim().toLowerCase(), row);
      if (row.employee_no != null) byEmployeeNo.set(String(row.employee_no), row);
    }
    const mapByProfile: Record<string, EmployeeDirectory> = {};
    const nextProfiles: TeamMemberCard[] = profileRows.map((pr) => {
      const byEmpId = pr.employee_id ? byEmployeeId.get(String(pr.employee_id)) : undefined;
      const byEmail = pr.email ? byLegacy.get(pr.email.trim().toLowerCase()) : undefined;
      const byCode = pr.employee_code ? byEmployeeNo.get(String(pr.employee_code).trim()) : undefined;
      const linked = byEmail ?? byEmpId ?? byCode;
      if (linked) mapByProfile[pr.id] = linked;
      return {
        ...pr,
        nickname: linked?.nickname ?? null,
      };
    });
    setProfiles(nextProfiles);
    setProfilesRaw(nextProfiles);
    setDirectoryRows(dirRows);
    setEmployeeByProfileId(mapByProfile);
    setBranches(mapBranchInformationRows((b as Record<string, unknown>[]) ?? []));

    setMgrCanApproveLeave(false);
    setMgrCanManageSchedule(false);
    setPendingTeamLeaves([]);
    setSubordinateProfileIds([]);
    setTeamAssignPicklist([]);
    if (admin) {
      const { data: lv } = await supabase
        .from('leave_requests')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(200);
      setPendingTeamLeaves((lv as LeaveRequestRow[]) ?? []);
      const { data: pickRpc, error: pickErr } = await supabase.rpc('task_assign_picklist');
      if (!pickErr && pickRpc != null) {
        setTeamAssignPicklist(normalizeAssignPickRows(pickRpc));
      }
    } else if (role === 'manager' && session?.user?.id) {
      const [{ data: sc }, { data: reps }] = await Promise.all([
        supabase
          .from('manager_scopes')
          .select('can_approve_leave, can_manage_schedule')
          .eq('manager_id', session.user.id)
          .maybeSingle(),
        supabase
          .from('manager_direct_reports')
          .select('subordinate_id')
          .eq('manager_id', session.user.id),
      ]);
      const canL = !!(sc as { can_approve_leave?: boolean } | null)?.can_approve_leave;
      const canS = !!(sc as { can_manage_schedule?: boolean } | null)?.can_manage_schedule;
      setMgrCanApproveLeave(canL);
      setMgrCanManageSchedule(canS);
      const ids = (reps as { subordinate_id?: string }[] | null)
        ?.map((r) => r.subordinate_id)
        .filter((x): x is string => !!x) ?? [];
      setSubordinateProfileIds(ids);
      if (canL && ids.length > 0) {
        const { data: lv } = await supabase
          .from('leave_requests')
          .select('*')
          .eq('status', 'pending')
          .in('user_id', ids)
          .order('created_at', { ascending: false });
        setPendingTeamLeaves((lv as LeaveRequestRow[]) ?? []);
      }
      const subSet = new Set(ids);
      const { data: pickRpc, error: pickErr } = await supabase.rpc('task_assign_picklist');
      if (!pickErr && pickRpc != null) {
        const all = normalizeAssignPickRows(pickRpc);
        setTeamAssignPicklist(all.filter((r) => subSet.has(r.profile_id)));
      } else {
        const fallback: AssignPickRow[] = profileRows
          .filter((pr) => subSet.has(pr.id))
          .map((pr) => ({
            profile_id: pr.id,
            account_email: pr.email ?? null,
            hr_user_id: null,
            full_name: pr.full_name ?? null,
            employee_id: pr.employee_id ? String(pr.employee_id) : null,
            hr_name: null,
            hr_surname: null,
            hr_nickname: null,
          }));
        setTeamAssignPicklist(fallback);
      }
    }
  }, [admin, managerScope, role, session?.user?.id]);

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

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  useEffect(() => {
    if (!managerScope) setTeamBranchKey(null);
  }, [managerScope]);

  useEffect(() => {
    if (!edit) {
      setMemberTaskSearchQuery('');
      setDeleteMemberTaskId(null);
      setDeleteMemberBusy(false);
      setMemberTasks([]);
    }
  }, [edit]);

  function openEdit(member: TeamMemberCard, linked: EmployeeDirectory) {
    setEdit(member);
    setEditEmployee(linked);
    setFullName(directoryDisplayName(linked) || member.full_name || '');
    setPhone(linked?.phone ?? member.phone ?? '');
    setCode(linked?.employee_no != null ? String(linked.employee_no) : member.employee_code ?? '');
    setBranchId(
      linked?.branch_id != null && !Number.isNaN(Number(linked.branch_id))
        ? Number(linked.branch_id)
        : member.branch_id != null && !Number.isNaN(member.branch_id)
          ? member.branch_id
          : null
    );
    setBranchText(linked?.branch ?? '');
    setPositionText(linked?.position ?? '');
    setAssignTitle('');
    setAssignDesc('');
    setAssignPriority('normal');
    setAssignStartDate(null);
    setAssignDueDate(null);
    setAssignModalOpen(false);
    setAssignChecklistLines([{ id: newTeamAssignChecklistLineId(), text: '' }]);
    setSelectedAssigneeIds([member.id]);
    setSummaryAnchorDate(new Date());
    setMemberTaskSearchQuery('');
  }

  function updateAssignChecklistLine(id: string, text: string) {
    setAssignChecklistLines((prev) => prev.map((l) => (l.id === id ? { ...l, text } : l)));
  }

  function removeAssignChecklistLine(id: string) {
    setAssignChecklistLines((prev) => {
      const next = prev.filter((l) => l.id !== id);
      return next.length ? next : [{ id: newTeamAssignChecklistLineId(), text: '' }];
    });
  }

  const period = useMemo(
    () => period26to25(summaryAnchorDate ?? new Date()),
    [summaryAnchorDate]
  );

  const loadMemberDetail = useCallback(async () => {
    if (!edit) return;
    setDetailLoading(true);
    try {
      const startIso = new Date(`${period.startYmd}T00:00:00+07:00`).toISOString();
      const endIso = new Date(`${period.endYmd}T23:59:59+07:00`).toISOString();
      const [{ data: mine }, { data: delegated }, { data: logs }, { data: lv }] = await Promise.all([
        supabase
          .from('tasks')
          .select(
            'id,title,description,assigned_to,assigned_by,status,due_at,start_at,priority,created_at,task_checklist_items(*),task_attachments(*)'
          )
          .eq('assigned_to', edit.id)
          .order('created_at', { ascending: false })
          .limit(80),
        supabase
          .from('tasks')
          .select(
            'id,title,description,assigned_to,assigned_by,status,due_at,start_at,priority,created_at,task_checklist_items(*),task_attachments(*)'
          )
          .eq('assigned_by', edit.id)
          .order('created_at', { ascending: false })
          .limit(80),
        supabase
          .from('attendance_logs')
          .select('*')
          .eq('user_id', edit.id)
          .gte('created_at', startIso)
          .lte('created_at', endIso)
          .in('kind', ['check_in', 'check_out'])
          .order('created_at', { ascending: true }),
        supabase
          .from('leave_requests')
          .select('starts_on,ends_on')
          .eq('user_id', edit.id)
          .in('status', ['pending', 'approved'])
          .lte('starts_on', period.endYmd)
          .gte('ends_on', period.startYmd),
      ]);
      const merged = [...((mine as TaskRow[]) ?? []), ...((delegated as TaskRow[]) ?? [])];
      const uniqueById = new Map<string, TaskRow>();
      for (const t of merged) uniqueById.set(t.id, t);
      setMemberTasks([...uniqueById.values()]);
      setMemberLogs((logs as AttendanceLog[]) ?? []);
      setMemberLeaves((lv as { starts_on: string; ends_on: string }[]) ?? []);
    } finally {
      setDetailLoading(false);
    }
  }, [edit, period.endYmd, period.startYmd]);

  useEffect(() => {
    if (!edit) return;
    void loadMemberDetail();
  }, [edit, loadMemberDetail]);

  useEffect(() => {
    const channel = supabase
      .channel('team_live_refresh')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'profiles' },
        () => {
          void load();
          if (edit) void loadMemberDetail();
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'employee' },
        () => {
          void load();
          if (edit) void loadMemberDetail();
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tasks' },
        () => {
          if (edit) void loadMemberDetail();
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'leave_requests' },
        () => {
          void load();
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [edit, load, loadMemberDetail]);

  useEffect(() => {
    const off = onLeaveStatusChanged((payload) => {
      setPendingTeamLeaves((prev) => prev.filter((lv) => lv.id !== payload.leaveId));
      void load();
      if (edit) void loadMemberDetail();
    });
    return off;
  }, [edit, load, loadMemberDetail]);

  const summaryRows = useMemo<AttendanceSummaryRow[]>(() => {
    if (!edit) return [];
    const leaveDays = new Set<string>();
    for (const lv of memberLeaves) {
      for (const ymd of listYmd(lv.starts_on, lv.ends_on)) leaveDays.add(ymd);
    }
    const logByDate = new Map<string, { checkIn?: AttendanceLog; checkOut?: AttendanceLog }>();
    for (const lg of memberLogs) {
      const ymd = ymdFromDate(new Date(lg.created_at));
      const row = logByDate.get(ymd) ?? {};
      if (lg.kind === 'check_in' && !row.checkIn) row.checkIn = lg;
      if (lg.kind === 'check_out') row.checkOut = lg;
      logByDate.set(ymd, row);
    }
    return listYmd(period.startYmd, period.endYmd).map((ymd) => {
      if (leaveDays.has(ymd)) {
        return {
          dateYmd: ymd,
          checkIn: 'ลา',
          checkOut: 'ลา',
          employeeCode: code.trim() || '-',
          checkInLocation: 'ลา',
        };
      }
      const day = logByDate.get(ymd);
      const location =
        day?.checkIn?.note?.trim() ||
        (day?.checkIn?.branch_id != null
          ? branches.find((b) => b.id === day.checkIn?.branch_id)?.branch_name ?? ''
          : '');
      return {
        dateYmd: ymd,
        checkIn: day?.checkIn
          ? new Date(day.checkIn.created_at).toLocaleTimeString('th-TH', {
              hour: '2-digit',
              minute: '2-digit',
            })
          : '',
        checkOut: day?.checkOut
          ? new Date(day.checkOut.created_at).toLocaleTimeString('th-TH', {
              hour: '2-digit',
              minute: '2-digit',
            })
          : '',
        checkInIso: day?.checkIn?.created_at,
        checkOutIso: day?.checkOut?.created_at,
        employeeCode: code.trim() || '-',
        checkInLocation: location,
      };
    });
  }, [branches, code, edit, memberLeaves, memberLogs, period.endYmd, period.startYmd]);

  const filteredMemberTasks = useMemo(() => {
    const q = memberTaskSearchQuery.trim().toLowerCase();
    if (!q) return memberTasks;
    return memberTasks.filter((t) => {
      const hay = `${t.title ?? ''} ${t.description ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [memberTasks, memberTaskSearchQuery]);

  const memberTaskDashboard = useMemo(() => {
    const nowMs = Date.now();
    const total = filteredMemberTasks.length;
    const active = filteredMemberTasks.filter(
      (t) => t.status === 'pending' || t.status === 'in_progress'
    ).length;
    const done = filteredMemberTasks.filter((t) => t.status === 'done').length;
    const cancelled = filteredMemberTasks.filter((t) => t.status === 'cancelled').length;
    const overdue = filteredMemberTasks.filter((t) => {
      if (!t.due_at) return false;
      if (t.status === 'done' || t.status === 'cancelled') return false;
      return new Date(t.due_at).getTime() < nowMs;
    }).length;
    const completionRate = total > 0 ? Math.round((done / total) * 100) : 0;

    let onTime = 0;
    let doneLate = 0;
    for (const t of filteredMemberTasks) {
      if (t.status !== 'done' || !t.due_at) continue;
      if (taskDoneIsOnTime(t)) onTime += 1;
      else doneLate += 1;
    }
    const overdueQuality = overdue + doneLate;
    const onTimeRateBase = onTime + overdueQuality;
    const onTimeRate = onTimeRateBase > 0 ? Math.round((onTime / onTimeRateBase) * 100) : 0;

    return {
      total,
      active,
      overdue,
      done,
      cancelled,
      completionRate,
      onTimeRate,
      onTime,
      overdueQuality,
    };
  }, [filteredMemberTasks]);

  const memberDeadlineSummary = useMemo(() => {
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

    const summary = {
      today: { total: 0, done: 0 },
      week: { total: 0, done: 0 },
      month: { total: 0, done: 0 },
    };
    for (const t of filteredMemberTasks) {
      if (!t.due_at) continue;
      const due = new Date(t.due_at);
      const done = t.status === 'done';
      if (due >= todayStart && due < todayEnd) {
        summary.today.total += 1;
        if (done) summary.today.done += 1;
      }
      if (due >= weekStart && due < weekEnd) {
        summary.week.total += 1;
        if (done) summary.week.done += 1;
      }
      if (due >= monthStart && due < monthEnd) {
        summary.month.total += 1;
        if (done) summary.month.done += 1;
      }
    }
    const pct = (d: number, t: number) => (t > 0 ? Math.round((d / t) * 100) : 0);
    return {
      today: { ...summary.today, pct: pct(summary.today.done, summary.today.total) },
      week: { ...summary.week, pct: pct(summary.week.done, summary.week.total) },
      month: { ...summary.month, pct: pct(summary.month.done, summary.month.total) },
      performancePct: Math.round(
        memberTaskDashboard.completionRate * 0.6 + memberTaskDashboard.onTimeRate * 0.4
      ),
    };
  }, [
    filteredMemberTasks,
    memberTaskDashboard.completionRate,
    memberTaskDashboard.onTimeRate,
  ]);

  const memberTaskStatusBars = useMemo(() => {
    const total = filteredMemberTasks.length;
    const pending = filteredMemberTasks.filter((t) => t.status === 'pending').length;
    const inProgress = filteredMemberTasks.filter((t) => t.status === 'in_progress').length;
    const done = filteredMemberTasks.filter((t) => t.status === 'done').length;
    const cancelled = filteredMemberTasks.filter((t) => t.status === 'cancelled').length;
    const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);
    return [
      { key: 'pending', label: 'รอดำเนินการ', count: pending, pct: pct(pending) },
      { key: 'in_progress', label: 'กำลังทำ', count: inProgress, pct: pct(inProgress) },
      { key: 'done', label: 'เสร็จแล้ว', count: done, pct: pct(done) },
      { key: 'cancelled', label: 'ยกเลิก', count: cancelled, pct: pct(cancelled) },
    ] as const;
  }, [filteredMemberTasks]);

  const profileByEmployeeId = useMemo(() => {
    const map = new Map<string, TeamMemberCard>();
    for (const p of profiles) {
      const empId = (p as Profile & { employee_id?: string | null }).employee_id;
      if (empId) map.set(String(empId), p);
    }
    return map;
  }, [profiles]);

  const profileByEmail = useMemo(() => {
    const map = new Map<string, TeamMemberCard>();
    for (const p of profiles) {
      if (p.email) map.set(p.email.trim().toLowerCase(), p);
    }
    return map;
  }, [profiles]);

  const profileByEmployeeCode = useMemo(() => {
    const map = new Map<string, TeamMemberCard>();
    for (const p of profiles) {
      const code = p.employee_code?.trim();
      if (code) map.set(code, p);
    }
    return map;
  }, [profiles]);

  const bestProfileByEmployeeId = useMemo(() => {
    const map = new Map<string, TeamMemberCard>();
    for (const emp of directoryRows) {
      const best = pickBestProfileForEmployee(emp, profilesRaw as ProfileExt[]);
      if (best) map.set(emp.id, best as TeamMemberCard);
    }
    return map;
  }, [directoryRows, profilesRaw]);

  const unlinkedProfiles = useMemo(
    () =>
      profilesRaw.filter((p) => {
        const empId = (p as Profile & { employee_id?: string | null }).employee_id;
        return !empId;
      }),
    [profilesRaw]
  );

  const teamBranchGroups = useMemo((): AdminBranchGroup[] => {
    if (!managerScope) return [];
    const byKey = new Map<string, EmployeeDirectory[]>();
    for (const emp of directoryRows) {
      const key = employeeBranchGroupKey(emp);
      const arr = byKey.get(key) ?? [];
      arr.push(emp);
      byKey.set(key, arr);
    }
    const out: AdminBranchGroup[] = [];
    for (const [key, emps] of byKey) {
      const sample = emps[0];
      if (key === 'none') {
        out.push({
          key: 'none',
          title: 'ยังไม่ระบุสาขา',
          subtitle: null,
          count: emps.length,
        });
      } else {
        out.push({
          key,
          title: employeeBranchCardTitle(sample),
          subtitle: employeeBranchCardSubtitle(sample),
          count: emps.length,
        });
      }
    }
    out.sort((a, b) => {
      if (a.key === 'none') return 1;
      if (b.key === 'none') return -1;
      return a.title.localeCompare(b.title, 'th');
    });
    return out;
  }, [managerScope, directoryRows]);

  const displayDirectoryRows = useMemo(() => {
    if (teamBranchKey == null) return directoryRows;
    return directoryRows.filter((e) => employeeBranchGroupKey(e) === teamBranchKey);
  }, [teamBranchKey, directoryRows]);

  const teamBranchTitle = useMemo(() => {
    if (teamBranchKey == null) return '';
    const g = teamBranchGroups.find((x) => x.key === teamBranchKey);
    return g?.title ?? 'สาขา';
  }, [teamBranchGroups, teamBranchKey]);

  const filteredTeamAssignPicklist = useMemo(
    () => teamAssignPicklist.filter((row) => assignMatchesSearch(row, assignTeamSearch)),
    [teamAssignPicklist, assignTeamSearch]
  );

  const avatarUrlByProfileId = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const pr of profilesRaw) {
      m.set(pr.id, pr.avatar_url ?? null);
    }
    return m;
  }, [profilesRaw]);

  const managerTeamSectionStart = useMemo(() => {
    return 1 + (mgrCanApproveLeave ? 1 : 0) + (mgrCanManageSchedule ? 1 : 0);
  }, [mgrCanApproveLeave, mgrCanManageSchedule]);

  async function saveEdit() {
    if (!edit || !editEmployee) {
      toast.info('ยังไม่มีข้อมูล employee', 'พนักงานคนนี้ยังไม่เชื่อมกับตาราง employee');
      return;
    }
    const branchName = branchText.trim() || null;
    const nameParts = fullName.trim().split(/\s+/).filter(Boolean);
    const firstName = nameParts[0] ?? '';
    const surname = nameParts.slice(1).join(' ');
    const { error } = await supabase
      .from('employee')
      .update({
        Name: firstName || null,
        Surname: surname || null,
        nickname: editEmployee.nickname ?? null,
        'Employee ID': code.trim() ? Number(code.trim()) : null,
        'phone number': phone.trim() || null,
        position: positionText.trim() || null,
        branch_id: branchId,
        branch: branchName,
      })
      .eq('id', editEmployee.id);
    if (error) {
      toast.error('บันทึกไม่สำเร็จ', error.message);
      return;
    }
    await load();
    setEditEmployee((prev) =>
      prev
        ? {
            ...prev,
            name: firstName || null,
            surname: surname || null,
            employee_no: code.trim() ? Number(code.trim()) : null,
            phone: phone.trim() || null,
            position: positionText.trim() || null,
            branch_id: branchId,
            branch: branchName,
          }
        : prev
    );
    toast.success('บันทึกทีมแล้ว', 'อัปเดตข้อมูลในตาราง employee แล้ว');
  }

  async function linkEmployeeToProfile() {
    if (!linkingEmployee || !selectedProfileId) {
      toast.info('ยังเลือกไม่ครบ', 'กรุณาเลือกบัญชี profile ที่จะเชื่อม');
      return;
    }
    setLinkingBusy(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ employee_id: linkingEmployee.id })
        .eq('id', selectedProfileId);
      if (error) {
        toast.error('เชื่อมไม่สำเร็จ', error.message);
        return;
      }
      toast.success('เชื่อมบัญชีแล้ว', 'บันทึก profiles.employee_id เรียบร้อย');
      setLinkingEmployee(null);
      setSelectedProfileId(null);
      await load();
    } finally {
      setLinkingBusy(false);
    }
  }

  async function respondTeamLeave(leaveId: string, approve: boolean) {
    const actorId = session?.user?.id;
    if (!actorId) return;
    setLeaveActionId(leaveId);
    try {
      const { data, error } = await supabase.rpc('respond_leave_request', {
        p_leave_id: leaveId,
        p_approve: approve,
      });
      if (error) {
        toast.error('ดำเนินการไม่สำเร็จ', error.message);
        return;
      }
      const raw = data as { ok?: boolean; error?: string } | null;
      if (raw && raw.ok === false) {
        const msg =
          raw.error === 'forbidden'
            ? 'ไม่มีสิทธิ์อนุมัติลาหรือไม่ใช่ลูกทีมโดยตรง'
            : raw.error === 'not_pending_or_missing'
              ? 'คำขอนี้ไม่อยู่ในสถานะรออนุมัติแล้ว'
              : (raw.error ?? 'unknown');
        toast.error('ดำเนินการไม่สำเร็จ', msg);
        return;
      }
      toast.success(approve ? 'อนุมัติแล้ว' : 'ปฏิเสธแล้ว', 'อัปเดตสถานะคำขอลาแล้ว');
      setPendingTeamLeaves((prev) => prev.filter((lv) => lv.id !== leaveId));
      emitLeaveStatusChanged({
        leaveId,
        action: approve ? 'approved' : 'rejected',
        source: 'team',
      });
      const statusText = approve ? 'อนุมัติคำขอลาแล้ว' : 'ปฏิเสธคำขอลาแล้ว';
      await supabase.from('attendance_chat_messages').insert({
        user_id: actorId,
        body: `แจ้งลา: ${statusText} (รหัส ${leaveId.slice(0, 8)}…)`,
      });
      await load();
    } finally {
      setLeaveActionId(null);
    }
  }

  async function assignTaskToMember() {
    if (!edit || !session?.user?.id || !assignTitle.trim()) {
      toast.info('ข้อมูลยังไม่ครบ', 'กรอกชื่องานก่อนมอบหมาย');
      return;
    }
    if (selectedAssigneeIds.length === 0) {
      toast.info('ยังไม่เลือกผู้รับงาน', 'เลือกพนักงานอย่างน้อย 1 คน');
      return;
    }
    setAssigning(true);
    try {
      const startIso = assignStartDate
        ? dateYmdToIsoBangkokStart(dateToBangkokYmd(assignStartDate))
        : null;
      const dueIso = assignDueDate
        ? dateYmdToIsoBangkokEnd(dateToBangkokYmd(assignDueDate))
        : null;
      const labels = assignChecklistLines.map((l) => l.text.trim()).filter(Boolean);
      const mgrId = session.user.id;

      for (const assigneeId of selectedAssigneeIds) {
        const { data: taskId, error } = await supabase.rpc('create_manager_task_bundle', {
          p_title: assignTitle.trim(),
          p_description: assignDesc.trim() || null,
          p_priority: assignPriority,
          p_start_at: startIso,
          p_due_at: dueIso,
          p_assignee_ids: [assigneeId],
          p_primary_ids: [assigneeId],
          p_checklist_labels: labels.length > 0 ? labels : [],
        });

        if (error || taskId == null) {
          toast.error('มอบหมายไม่สำเร็จ', humanizeSupabaseError(error?.message ?? 'ไม่ได้รับรหัสงานจากเซิร์ฟเวอร์'));
          return;
        }

        const tid = String(taskId);

        try {
          await notifyTaskStakeholders(supabase, {
            taskId: tid,
            assignedTo: assigneeId,
            assignedBy: mgrId,
            title: assignTitle.trim(),
            message: 'มีงานใหม่จากหัวหน้า/ผู้มอบหมาย',
            notifyAssigneeIds: [assigneeId],
          });
        } catch {
          /* ignore */
        }

        emitTaskStatusChanged({ taskId: tid, status: 'pending', source: 'team' });
      }

      setAssignTitle('');
      setAssignDesc('');
      setAssignPriority('normal');
      setAssignStartDate(null);
      setAssignDueDate(null);
      setAssignChecklistLines([{ id: newTeamAssignChecklistLineId(), text: '' }]);
      setAssignModalOpen(false);
      toast.success('มอบหมายงานแล้ว', `สร้างงานให้ ${selectedAssigneeIds.length} คนเรียบร้อย`);
      await loadMemberDetail();
    } finally {
      setAssigning(false);
    }
  }

  function toggleAssignee(profileId: string) {
    setSelectedAssigneeIds((prev) =>
      prev.includes(profileId) ? prev.filter((x) => x !== profileId) : [...prev, profileId]
    );
  }

  async function updateMemberTaskStatus(taskId: string, status: (typeof TASK_STATUSES)[number]) {
    const patch: Record<string, unknown> = { status };
    if (status === 'done') {
      patch.completed_at = dateYmdToIsoBangkokEnd(dateToBangkokYmd(new Date()));
    } else {
      patch.completed_at = null;
    }
    const { error } = await supabase.from('tasks').update(patch).eq('id', taskId);
    if (error) {
      toast.error('อัปเดตสถานะไม่สำเร็จ', error.message);
      return;
    }
    emitTaskStatusChanged({
      taskId,
      status,
      source: 'team',
    });
    await loadMemberDetail();
  }

  async function confirmDeleteMemberTask() {
    if (deleteMemberBusy) return;
    if (!admin) return;
    const id = deleteMemberTaskId;
    if (!id) return;
    setDeleteMemberBusy(true);
    const { error } = await supabase.from('tasks').delete().eq('id', id);
    setDeleteMemberBusy(false);
    setDeleteMemberTaskId(null);
    if (error) {
      toast.error('ลบงานไม่สำเร็จ', humanizeSupabaseError(error.message));
      return;
    }
    emitTaskStatusChanged({ taskId: id, status: 'deleted', source: 'team' });
    toast.success('ลบงานแล้ว', 'รายการถูกลบจากระบบ');
    await loadMemberDetail();
  }

  async function exportCsv() {
    if (!edit || summaryRows.length === 0) return;
    setExporting(true);
    try {
      const header = ['วันที่', 'เวลาเข้างาน', 'เวลาออกงาน', 'รหัสพนักงาน', 'สถานที่เข้างาน'];
      const lines = [header.map(csvEscape).join(',')];
      for (const row of summaryRows) {
        lines.push(
          [
            row.dateYmd,
            row.checkInIso ? fmtBangkokDateTimeCsv(row.checkInIso) : row.checkIn || '',
            row.checkOutIso ? fmtBangkokDateTimeCsv(row.checkOutIso) : row.checkOut || '',
            row.employeeCode,
            row.checkInLocation || '',
          ]
            .map(csvEscape)
            .join(',')
        );
      }
      const content = `\uFEFF${lines.join('\n')}`;
      const filename = `team-attendance-${edit.employee_code || edit.id}-${period.startYmd}-${period.endYmd}.csv`;
      if (Platform.OS === 'web') {
        const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        const uri = `${FileSystem.cacheDirectory}${filename}`;
        await FileSystem.writeAsStringAsync(uri, content, {
          encoding: FileSystem.EncodingType.UTF8,
        });
        if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri);
      }
    } finally {
      setExporting(false);
    }
  }

  async function exportPdf() {
    if (!edit || summaryRows.length === 0) return;
    setExporting(true);
    try {
      const rowsHtml = summaryRows
        .map(
          (row) => `<tr>
          <td>${htmlEscape(row.dateYmd)}</td>
          <td>${htmlEscape(
            row.checkInIso ? fmtBangkokDateTimeCsv(row.checkInIso) : row.checkIn
          )}</td>
          <td>${htmlEscape(
            row.checkOutIso ? fmtBangkokDateTimeCsv(row.checkOutIso) : row.checkOut
          )}</td>
          <td>${htmlEscape(row.employeeCode)}</td>
          <td>${htmlEscape(row.checkInLocation || '')}</td>
        </tr>`
        )
        .join('');
      const html = `<!doctype html><html><head><meta charset="utf-8" />
      <style>
      body{font-family:Arial,sans-serif;padding:16px;color:#1f2d25}
      table{width:100%;border-collapse:collapse;font-size:11px}
      th,td{border:1px solid #ccd8cf;padding:6px;text-align:left}
      th{background:#e6f1e8}
      </style></head><body>
      <h3>สรุปเวลาเข้า-ออกงาน: ${htmlEscape(
        edit.full_name || edit.email || edit.id
      )}</h3>
      <p>ช่วง ${htmlEscape(period.startYmd)} ถึง ${htmlEscape(period.endYmd)}</p>
      <table><thead><tr>
      <th>วันที่</th><th>เวลาเข้างาน</th><th>เวลาออกงาน</th><th>รหัสพนักงาน</th><th>สถานที่เข้างาน</th>
      </tr></thead><tbody>${rowsHtml}</tbody></table></body></html>`;
      if (Platform.OS === 'web') {
        const w = window.open('', '_blank');
        if (w) {
          w.document.write(html);
          w.document.close();
          w.print();
        }
      } else {
        const pdf = await Print.printToFileAsync({ html });
        if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(pdf.uri);
      }
    } finally {
      setExporting(false);
    }
  }

  function renderPendingLeaveCards() {
    if (pendingTeamLeaves.length === 0) {
      return <Text style={styles.mutedSmall}>ไม่มีคำขอรออนุมัติ</Text>;
    }
    return pendingTeamLeaves.map((lv) => {
      const who =
        profiles.find((p) => p.id === lv.user_id)?.full_name ||
        profiles.find((p) => p.id === lv.user_id)?.email ||
        lv.user_id.slice(0, 8);
      const busy = leaveActionId === lv.id;
      return (
        <View key={lv.id} style={styles.leaveCard}>
          <Text style={styles.leaveWho}>{who}</Text>
          <Text style={styles.leaveMeta}>
            {LEAVE_TYPE_TH[lv.leave_type] ?? lv.leave_type} · {lv.starts_on} → {lv.ends_on}
          </Text>
          {lv.reason ? (
            <Text style={styles.leaveReason} numberOfLines={3}>
              {lv.reason}
            </Text>
          ) : null}
          <View style={styles.leaveActions}>
            <Pressable
              style={[styles.leaveBtn, styles.leaveBtnReject, busy && styles.disabled]}
              disabled={busy}
              onPress={() => void respondTeamLeave(lv.id, false)}>
              <Text style={styles.leaveBtnRejectText}>ปฏิเสธ</Text>
            </Pressable>
            <Pressable
              style={[styles.leaveBtn, styles.leaveBtnOk, busy && styles.disabled]}
              disabled={busy}
              onPress={() => void respondTeamLeave(lv.id, true)}>
              <Text style={styles.leaveBtnOkText}>
                {busy ? 'กำลังบันทึก...' : 'อนุมัติ'}
              </Text>
            </Pressable>
          </View>
        </View>
      );
    });
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={NatureTheme.colors.primary} />
      </View>
    );
  }

  const showTeamBranchPicker = managerScope && teamBranchKey == null;

  const adminTopSections = admin ? (
    <View style={styles.managerTop}>
      <Text style={styles.h2}>1 · อนุมัติลา</Text>
      <Text style={styles.mutedSmall}>คำขอลาทั้งหมดที่รอดำเนินการในระบบ</Text>
      {renderPendingLeaveCards()}
      <Text style={[styles.h2, { marginTop: 18 }]}>2 · เลือกกลุ่มตามสาขา</Text>
      <Text style={styles.mutedSmall}>
        เลือกสาขาหรือกลุ่มพนักงานเพื่อดูรายชื่อและแก้ไขข้อมูล HR
      </Text>
    </View>
  ) : null;

  const managerTopSections =
    !admin && role === 'manager' ? (
      <View style={styles.managerTop}>
        {mgrCanApproveLeave ? (
          <>
            <Text style={styles.h2}>1 · อนุมัติลา</Text>
            <Text style={styles.mutedSmall}>
              คำขอที่รออนุมัติจากพนักงานภายใต้การดูแลของคุณ
            </Text>
            {renderPendingLeaveCards()}
          </>
        ) : null}
        {mgrCanManageSchedule ? (
          <>
            <Text style={[styles.h2, { marginTop: mgrCanApproveLeave ? 18 : 0 }]}>
              {mgrCanApproveLeave ? '2 · ' : '1 · '}ตารางงาน
            </Text>
            <Text style={styles.mutedSmall}>
              จัดมอบหมายกะรายวันให้ลูกทีมได้จากแท็บ «ตาราง»
            </Text>
            <Pressable
              style={styles.goScheduleBtn}
              onPress={() => {
                router.push('/schedule');
              }}>
              <Text style={styles.goScheduleBtnText}>เปิดหน้าตารางงาน</Text>
            </Pressable>
          </>
        ) : null}
        <Text
          style={[
            styles.h2,
            {
              marginTop:
                mgrCanApproveLeave || mgrCanManageSchedule ? 18 : 0,
            },
          ]}>
          {managerTeamSectionStart} · ทีมที่ดูแล
        </Text>
        <Text style={styles.mutedSmall}>
          เลือกกลุ่มตามสาขาในระบบ HR — ถ้ายังไม่มีรายชื่อ ให้แอดมินกำหนดลูกทีมและเชื่อม employee
        </Text>
      </View>
    ) : null;

  const renderEmployeeCard = ({ item: emp }: { item: EmployeeDirectory }) => {
    const linked =
      bestProfileByEmployeeId.get(emp.id) ??
      profileByEmployeeId.get(emp.id) ??
      (emp.legacy_user_id
        ? profileByEmail.get(emp.legacy_user_id.trim().toLowerCase())
        : undefined) ??
      (emp.employee_no != null
        ? profileByEmployeeCode.get(String(emp.employee_no))
        : undefined);
    return (
      <Pressable
        style={styles.card}
        onPress={() => {
          if (!linked) return;
          openEdit(linked, emp);
        }}>
        <View style={styles.cardRow}>
          <UserAvatar
            uri={linked?.avatar_url}
            label={directoryDisplayName(emp) || linked?.email || 'พนักงาน'}
            size={48}
          />
          <View style={styles.cardBody}>
            <Text style={styles.name}>
              {directoryDisplayName(emp) || linked?.email || 'ไม่มีชื่อ'}
            </Text>
            <Text style={styles.meta}>ชื่อเล่น: {emp.nickname || '—'}</Text>
            <Text style={styles.meta}>
              {linked ? `${linked.role} · ${emp.employee_no ?? '—'}` : 'ยังไม่เชื่อมบัญชี'}
            </Text>
            {!linked && admin ? (
              <Pressable
                style={styles.linkNowBtn}
                onPress={() => {
                  setLinkingEmployee(emp);
                  setSelectedProfileId(null);
                }}>
                <Text style={styles.linkNowBtnText}>เชื่อมเลย</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </Pressable>
    );
  };

  return (
    <View style={styles.screen}>
      {managerScope && teamBranchKey != null ? (
        <View style={styles.branchToolbar}>
          <Pressable
            style={styles.branchToolbarBack}
            onPress={() => setTeamBranchKey(null)}
            hitSlop={10}>
            <Text style={styles.branchToolbarBackText}>
              ‹ {admin ? 'สาขาทั้งหมด' : 'ทีมทั้งหมด'}
            </Text>
          </Pressable>
          <View style={styles.branchToolbarMid}>
            <Text style={styles.branchToolbarTitle} numberOfLines={1}>
              {teamBranchTitle}
            </Text>
          </View>
          <View style={{ width: 74 }} />
        </View>
      ) : null}

      {showTeamBranchPicker ? (
        <FlatList
          data={teamBranchGroups}
          keyExtractor={(g) => g.key}
          contentContainerStyle={styles.branchListContent}
          ListHeaderComponent={
            (admin ? adminTopSections : managerTopSections) ?? undefined
          }
          ListEmptyComponent={
            <Text style={styles.empty}>ไม่มีรายชื่อพนักงานในระบบ</Text>
          }
          renderItem={({ item: g }) => (
            <Pressable
              style={styles.branchCard}
              onPress={() => setTeamBranchKey(g.key)}>
              <View style={styles.branchCardRow}>
                <View style={styles.branchCardIcon}>
                  <Text style={styles.branchCardIconText}>🏢</Text>
                </View>
                <View style={styles.branchCardBody}>
                  <Text style={styles.branchCardTitle}>{g.title}</Text>
                  {g.subtitle ? (
                    <Text style={styles.branchCardSub}>รหัส: {g.subtitle}</Text>
                  ) : null}
                  <Text style={styles.branchCardCount}>{g.count} คน</Text>
                </View>
                <Text style={styles.branchCardChevron}>›</Text>
              </View>
            </Pressable>
          )}
        />
      ) : (
        <FlatList
          data={displayDirectoryRows}
          keyExtractor={(p) => p.id}
          ListHeaderComponent={
            teamBranchKey == null
              ? (admin ? adminTopSections : managerTopSections) ?? undefined
              : undefined
          }
          ListEmptyComponent={
            <Text style={styles.empty}>
              {role === 'manager'
                ? 'ยังไม่มีลูกทีมในระบบ — ให้แอดมินกำหนดในแท็บแอดมิน'
                : 'ไม่มีรายชื่อ (ตรวจสอบสิทธิ์สาขา)'}
            </Text>
          }
          renderItem={renderEmployeeCard}
        />
      )}

      <Modal visible={!!edit} animationType="slide" transparent onRequestClose={() => setEdit(null)}>
        <Pressable style={styles.backdrop} onPress={() => setEdit(null)}>
          <Pressable style={styles.modal} onPress={() => {}}>
            <View style={styles.modalTopBar}>
              <Text style={styles.modalTitle}>ข้อมูลพนักงาน</Text>
              <Pressable style={styles.modalCloseTopBtn} onPress={() => setEdit(null)}>
                <Text style={styles.modalCloseTopBtnText}>ปิด ✕</Text>
              </Pressable>
            </View>
            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled>
              {edit ? (
                <View style={styles.memberHeader}>
                  <UserAvatar
                    uri={edit.avatar_url}
                    label={edit.full_name || edit.email || 'พนักงาน'}
                    size={56}
                  />
                  <View style={styles.memberHeaderBody}>
                    <Text style={styles.memberName}>
                      {directoryDisplayName(editEmployee) || edit.full_name || edit.email || 'ไม่มีชื่อ'}
                    </Text>
                    <Text style={styles.memberMeta}>ชื่อเล่น: {editEmployee?.nickname || '—'}</Text>
                    <Text style={styles.memberMeta}>
                      รหัสพนักงาน: {editEmployee?.employee_no ?? edit.employee_code ?? '—'}
                    </Text>
                    <Text style={styles.memberMeta}>ตำแหน่ง: {editEmployee?.position || '—'}</Text>
                  </View>
                </View>
              ) : null}

              {managerScope ? (
                <>
                  <Text style={styles.sectionTitle}>แก้ไขโปรไฟล์</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="ชื่อ-นามสกุล (ตาราง employee)"
                    value={fullName}
                    onChangeText={setFullName}
                  />
                  <TextInput
                    style={styles.input}
                    placeholder="เบอร์โทร"
                    value={phone}
                    onChangeText={setPhone}
                  />
                  <TextInput
                    style={styles.input}
                    placeholder="รหัสพนักงาน (employee.Employee ID)"
                    value={code}
                    onChangeText={setCode}
                  />
                  <TextInput
                    style={styles.input}
                    placeholder="ตำแหน่ง (employee.position)"
                    value={positionText}
                    onChangeText={setPositionText}
                  />
                  <TextInput
                    style={styles.input}
                    placeholder="ชื่อเล่น (ตาราง employee)"
                    value={editEmployee?.nickname ?? ''}
                    onChangeText={(v) =>
                      setEditEmployee((prev) => (prev ? { ...prev, nickname: v } : prev))
                    }
                  />
                  <Text style={styles.label}>สาขา</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="สาขา (employee.branch)"
                    value={branchText}
                    onChangeText={setBranchText}
                  />
                  <Pressable style={styles.save} onPress={saveEdit}>
                    <Text style={styles.saveText}>บันทึกลงตาราง employee</Text>
                  </Pressable>
                  {edit ? (
                    <EmployeeScheduleCalendarCard
                      userId={edit.id}
                      title="ปฏิทินตารางงานของพนักงาน"
                    />
                  ) : null}
                </>
              ) : null}

              <Text style={styles.sectionTitle}>หน้างาน</Text>
              <Text style={styles.sectionSubText}>
                แสดงงานของพนักงานคนนี้ในหน้านี้โดยตรง (ไม่สลับไปแท็บงาน)
              </Text>
              <TextInput
                style={styles.memberTaskSearchInput}
                placeholder="ค้นหาจากหัวข้อหรือรายละเอียดงาน..."
                placeholderTextColor={c.textMuted}
                value={memberTaskSearchQuery}
                onChangeText={setMemberTaskSearchQuery}
              />
              {memberTaskSearchQuery.trim() ? (
                <Text style={styles.memberTaskSearchKpiHint}>
                  ตัวเลขสรุปด้านล่างนับเฉพาะงานที่ตรงคำค้น ({filteredMemberTasks.length} งาน)
                </Text>
              ) : null}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.kpiRow}>
                <View style={styles.kpiCard}>
                  <Text style={styles.kpiLabel}>งานทั้งหมด</Text>
                  <Text style={styles.kpiValue}>{memberTaskDashboard.total}</Text>
                </View>
                <View style={styles.kpiCard}>
                  <Text style={styles.kpiLabel}>กำลังดำเนินการ</Text>
                  <Text style={styles.kpiValue}>{memberTaskDashboard.active}</Text>
                </View>
                <View style={styles.kpiCard}>
                  <Text style={styles.kpiLabel}>เลยกำหนด</Text>
                  <Text style={[styles.kpiValue, styles.kpiWarn]}>
                    {memberTaskDashboard.overdue}
                  </Text>
                </View>
                <View style={styles.kpiCard}>
                  <Text style={styles.kpiLabel}>เสร็จแล้ว</Text>
                  <Text style={styles.kpiValue}>{memberTaskDashboard.done}</Text>
                  <Text style={styles.kpiHint}>({memberTaskDashboard.completionRate}%)</Text>
                </View>
              </ScrollView>

              <View style={styles.deadlineRow}>
                <View style={styles.deadlineCard}>
                  <Text style={styles.deadlineTitle}>Today</Text>
                  <Text style={styles.deadlineValue}>
                    {memberDeadlineSummary.today.done}/{memberDeadlineSummary.today.total}
                  </Text>
                  <Text style={styles.deadlinePct}>{memberDeadlineSummary.today.pct}%</Text>
                </View>
                <View style={styles.deadlineCard}>
                  <Text style={styles.deadlineTitle}>This Week</Text>
                  <Text style={styles.deadlineValue}>
                    {memberDeadlineSummary.week.done}/{memberDeadlineSummary.week.total}
                  </Text>
                  <Text style={styles.deadlinePct}>{memberDeadlineSummary.week.pct}%</Text>
                </View>
                <View style={styles.deadlineCard}>
                  <Text style={styles.deadlineTitle}>This Month</Text>
                  <Text style={styles.deadlineValue}>
                    {memberDeadlineSummary.month.done}/{memberDeadlineSummary.month.total}
                  </Text>
                  <Text style={styles.deadlinePct}>{memberDeadlineSummary.month.pct}%</Text>
                </View>
              </View>
              <Text style={styles.performanceLine}>
                Performance Index (completion + on-time): {memberDeadlineSummary.performancePct}%
              </Text>

              <View style={styles.statusBoard}>
                <Text style={styles.statusBoardTitle}>Task Status</Text>
                {memberTaskStatusBars.map((r) => (
                  <View key={r.key} style={styles.statusBoardRow}>
                    <Text style={styles.statusBoardLabel}>{r.label}</Text>
                    <View style={styles.statusBoardTrack}>
                      <View
                        style={[
                          styles.statusBoardFill,
                          r.key === 'done'
                            ? styles.statusBoardFillDone
                            : r.key === 'in_progress'
                              ? styles.statusBoardFillProgress
                              : r.key === 'pending'
                                ? styles.statusBoardFillPending
                                : styles.statusBoardFillCancelled,
                          { width: `${r.pct}%` },
                        ]}
                      />
                    </View>
                    <Text style={styles.statusBoardStat}>
                      {r.count} ({r.pct}%)
                    </Text>
                  </View>
                ))}
              </View>
              <Text style={styles.memberTasksScrollHint}>รายการงาน (เลื่อนดูในพื้นที่นี้)</Text>
              <ScrollView
                style={styles.memberTasksScroll}
                nestedScrollEnabled
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator>
                {filteredMemberTasks.length === 0 ? (
                  <Text style={styles.memberTasksEmpty}>
                    {memberTasks.length === 0
                      ? 'ยังไม่มีงานที่แสดงได้ในชุดนี้'
                      : 'ไม่มีงานตรงกับคำค้น'}
                  </Text>
                ) : (
                  filteredMemberTasks.map((t) => {
                    const prog = checklistProgress(t);
                    const pct = prog.percent;
                    const statusTone =
                      pct < 30
                        ? styles.taskProgressRisk
                        : pct <= 70
                          ? styles.taskProgressWarn
                          : styles.taskProgressGood;
                    return (
                      <View key={t.id} style={styles.taskCard}>
                        {admin ? (
                          <Pressable
                            style={styles.taskCardDeleteBtn}
                            onPress={() => setDeleteMemberTaskId(t.id)}
                            hitSlop={8}>
                            <Text style={styles.taskCardDeleteBtnText}>ลบงาน</Text>
                          </Pressable>
                        ) : null}
                        <Text style={styles.taskTitle}>{t.title}</Text>
                        <Text style={styles.taskMeta}>
                          สถานะ: {TASK_STATUS_TH[t.status] ?? t.status} · ความสำคัญ:{' '}
                          {priorityLabel((t.priority as TaskPriority) || 'normal')}
                        </Text>
                        <View style={styles.taskProgressWrap}>
                          <View style={styles.taskProgressHead}>
                            <Text style={styles.taskProgressLabel}>ความคืบหน้าเช็กลิสต์</Text>
                            <Text style={[styles.taskProgressValue, statusTone]}>
                              {prog.done}/{prog.total} ({pct}%)
                            </Text>
                          </View>
                          <TaskProgressBar percent={pct} empty={prog.total === 0} />
                        </View>
                        {t.due_at ? (
                          <Text style={styles.taskMeta}>
                            กำหนดส่ง: {new Date(t.due_at).toLocaleString('th-TH')}
                          </Text>
                        ) : null}
                        <View style={styles.taskStatusRow}>
                          {TASK_STATUSES.map((s) => (
                            <Pressable
                              key={`${t.id}-${s}`}
                              style={[
                                styles.taskStatusChip,
                                t.status === s && styles.taskStatusChipOn,
                              ]}
                              onPress={() => void updateMemberTaskStatus(t.id, s)}>
                              <Text
                                style={[
                                  styles.taskStatusChipText,
                                  t.status === s && styles.taskStatusChipTextOn,
                                ]}>
                                {TASK_STATUS_TH[s] ?? s}
                              </Text>
                            </Pressable>
                          ))}
                        </View>
                      </View>
                    );
                  })
                )}
              </ScrollView>

              <Text style={styles.sectionTitle}>มอบหมายงาน</Text>
              <Pressable
                style={styles.openAssignBtn}
                onPress={() => {
                  setAssignTeamSearch('');
                  setAssignChecklistLines([{ id: newTeamAssignChecklistLineId(), text: '' }]);
                  setAssignModalOpen(true);
                }}>
                <Text style={styles.openAssignBtnText}>เปิดหน้าต่างมอบหมายงาน</Text>
              </Pressable>

              <Text style={styles.sectionTitle}>ตารางเวลาเข้า-ออกงาน</Text>
              <DatePickerField
                label="เลือกเดือนสำหรับรอบ 26-25"
                value={summaryAnchorDate}
                onChange={(d) => setSummaryAnchorDate(d ?? new Date())}
                disabled={detailLoading || exporting}
              />
              <Text style={styles.periodText}>
                ช่วงที่แสดง: {period.startYmd} - {period.endYmd}
              </Text>
              <View style={styles.actions}>
                <Pressable
                  style={[styles.exportBtn, (exporting || detailLoading) && styles.disabled]}
                  onPress={() => void exportCsv()}
                  disabled={exporting || detailLoading}>
                  <Text style={styles.exportBtnText}>ดาวน์โหลด CSV</Text>
                </Pressable>
                <Pressable
                  style={[styles.exportBtnAlt, (exporting || detailLoading) && styles.disabled]}
                  onPress={() => void exportPdf()}
                  disabled={exporting || detailLoading}>
                  <Text style={styles.exportBtnAltText}>ดาวน์โหลด PDF</Text>
                </Pressable>
              </View>
              {detailLoading ? (
                <ActivityIndicator color={c.primary} style={{ marginVertical: 10 }} />
              ) : (
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View>
                    <View style={[styles.tableRow, styles.tableHead]}>
                      <Text style={[styles.cell, styles.colDate, styles.headText]}>วันที่</Text>
                      <Text style={[styles.cell, styles.colTime, styles.headText]}>เวลาเข้างาน</Text>
                      <Text style={[styles.cell, styles.colTime, styles.headText]}>เวลาออกงาน</Text>
                      <Text style={[styles.cell, styles.colCode, styles.headText]}>รหัสพนักงาน</Text>
                      <Text style={[styles.cell, styles.colLoc, styles.headText]}>สถานที่เข้างาน</Text>
                    </View>
                    {summaryRows.map((row) => (
                      <View key={row.dateYmd} style={styles.tableRow}>
                        <Text style={[styles.cell, styles.colDate]}>{row.dateYmd}</Text>
                        <Text style={[styles.cell, styles.colTime]}>{row.checkIn}</Text>
                        <Text style={[styles.cell, styles.colTime]}>{row.checkOut}</Text>
                        <Text style={[styles.cell, styles.colCode]}>{row.employeeCode}</Text>
                        <Text style={[styles.cell, styles.colLoc]}>{row.checkInLocation}</Text>
                      </View>
                    ))}
                  </View>
                </ScrollView>
              )}

              <View style={[styles.actions, { marginTop: 12 }]}>
                <Pressable style={styles.closeBtn} onPress={() => setEdit(null)}>
                  <Text style={styles.closeBtnText}>ปิด</Text>
                </Pressable>
              </View>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={admin && !!linkingEmployee}
        animationType="slide"
        transparent
        onRequestClose={() => setLinkingEmployee(null)}>
        <Pressable style={styles.backdrop} onPress={() => setLinkingEmployee(null)}>
          <Pressable style={styles.modal} onPress={() => {}}>
            <Text style={styles.modalTitle}>เชื่อมบัญชีพนักงาน</Text>
            <Text style={styles.sectionSubText}>
              พนักงาน: {directoryDisplayName(linkingEmployee) || linkingEmployee?.legacy_user_id || '-'}
            </Text>
            <Text style={styles.label}>เลือกโปรไฟล์ที่ถูกต้อง</Text>
            <FlatList
              style={styles.list}
              data={unlinkedProfiles}
              keyExtractor={(p) => p.id}
              renderItem={({ item }) => (
                <Pressable
                  style={[styles.row, selectedProfileId === item.id && styles.rowOn]}
                  onPress={() => setSelectedProfileId(item.id)}>
                  <Text>{item.full_name || item.email || item.id}</Text>
                </Pressable>
              )}
            />
            <View style={styles.actions}>
              <Pressable onPress={() => setLinkingEmployee(null)}>
                <Text>ยกเลิก</Text>
              </Pressable>
              <Pressable
                style={[styles.save, (!selectedProfileId || linkingBusy) && styles.disabled]}
                disabled={!selectedProfileId || linkingBusy}
                onPress={() => void linkEmployeeToProfile()}>
                <Text style={styles.saveText}>{linkingBusy ? 'กำลังเชื่อม...' : 'บันทึกการเชื่อม'}</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={assignModalOpen}
        animationType="slide"
        transparent
        statusBarTranslucent
        presentationStyle="overFullScreen"
        onRequestClose={() => setAssignModalOpen(false)}>
        <View style={[styles.backdrop, WEB_TEAM_ASSIGN_LAYER]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setAssignModalOpen(false)} />
          <Pressable style={styles.modal} onPress={() => {}}>
            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.assignModalScroll}>
              <Text style={styles.modalTitle}>มอบหมายงาน</Text>

              <Text style={styles.assignFormLabel}>ชื่องาน *</Text>
              <TextInput
                style={styles.assignFormInput}
                placeholder="เช่น นัดลูกค้า บริษัท …"
                placeholderTextColor={NatureTheme.colors.textMuted}
                value={assignTitle}
                onChangeText={setAssignTitle}
                editable={!assigning}
              />

              <Text style={styles.assignFormLabel}>รายละเอียด</Text>
              <TextInput
                style={[styles.assignFormInput, styles.assignFormTall]}
                placeholder="การนัดหมาย การประสานกับทีม ฯลฯ"
                placeholderTextColor={NatureTheme.colors.textMuted}
                value={assignDesc}
                onChangeText={setAssignDesc}
                multiline
                editable={!assigning}
              />

              <DatePickerField
                label="วันที่เริ่ม"
                value={assignStartDate}
                onChange={setAssignStartDate}
                disabled={assigning}
                maximumDate={assignDueDate ?? undefined}
              />
              <DatePickerField
                label="วันที่ต้องทำเสร็จ"
                value={assignDueDate}
                onChange={setAssignDueDate}
                disabled={assigning}
                minimumDate={assignStartDate ?? undefined}
              />

              <Text style={styles.assignFormLabel}>ระดับความสำคัญ</Text>
              <View style={styles.assignPriRow}>
                {TASK_PRIORITY_OPTIONS.map((p) => (
                  <Pressable
                    key={`assign-pri-${p.key}`}
                    style={[
                      styles.assignPriChip,
                      { borderColor: p.color },
                      assignPriority === p.key && {
                        backgroundColor: p.color + '33',
                      },
                    ]}
                    onPress={() => setAssignPriority(p.key)}
                    disabled={assigning}>
                    <View style={[styles.assignPriDot, { backgroundColor: p.color }]} />
                    <Text style={styles.assignPriText} numberOfLines={2}>
                      {p.label}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.assignFormLabel}>หัวข้อย่อย (ทำเป็นเช็คลิสต์)</Text>
              {assignChecklistLines.map((line) => (
                <View key={line.id} style={styles.assignLineRow}>
                  <TextInput
                    style={[styles.assignFormInput, styles.assignFormLineInput]}
                    value={line.text}
                    onChangeText={(v) => updateAssignChecklistLine(line.id, v)}
                    placeholder="หัวข้อย่อย"
                    placeholderTextColor={NatureTheme.colors.textMuted}
                    editable={!assigning}
                  />
                  <Pressable
                    style={[
                      styles.assignRemoveLine,
                      assignChecklistLines.length <= 1 && styles.assignRemoveLineDisabled,
                    ]}
                    onPress={() => removeAssignChecklistLine(line.id)}
                    disabled={assigning || assignChecklistLines.length <= 1}
                    accessibilityLabel="ลบหัวข้อ">
                    <Text style={styles.assignRemoveLineText}>ลบ</Text>
                  </Pressable>
                </View>
              ))}
              <Pressable
                style={styles.assignAddLine}
                onPress={() =>
                  setAssignChecklistLines((prev) => [
                    ...prev,
                    { id: newTeamAssignChecklistLineId(), text: '' },
                  ])
                }
                disabled={assigning}>
                <Text style={styles.assignAddLineText}>+ เพิ่มหัวข้อ</Text>
              </Pressable>

              <Text style={styles.assignTeamLabel}>มอบหมายงานให้ *</Text>
              <Text style={styles.assignTeamHint}>
                แตะแถวเพื่อเลือก/ยกเลิกหลายคน — แสดงชื่อจาก HR / โปรไฟล์
                {admin ? '' : ' (เฉพาะลูกทีมที่แอดมินกำหนด)'} · ค้นหาจากชื่อ นามสกุล ชื่อเล่น หรืออีเมล
              </Text>
              {teamAssignPicklist.length === 0 ? (
                <Text style={styles.assignTeamEmpty}>
                  {admin
                    ? 'ยังไม่มีรายชื่อพนักงาน — ตรวจสอบ RPC task_assign_picklist หรือสิทธิ์'
                    : 'ยังไม่มีรายชื่อลูกทีม — ให้แอดมินกำหนด manager_direct_reports'}
                </Text>
              ) : (
                <>
                  <TextInput
                    style={styles.assignTeamSearch}
                    placeholder="ค้นหาชื่อพนักงาน ชื่อเล่น หรืออีเมล…"
                    placeholderTextColor={NatureTheme.colors.textMuted}
                    value={assignTeamSearch}
                    onChangeText={setAssignTeamSearch}
                    editable={!assigning}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  {assignTeamSearch.trim() && filteredTeamAssignPicklist.length === 0 ? (
                    <Text style={styles.assignTeamNoResults}>ไม่พบผลการค้นหา</Text>
                  ) : null}
                </>
              )}
              {filteredTeamAssignPicklist.map((row) => {
                const acc = row.account_email?.trim() ?? '';
                const hrId = row.hr_user_id?.trim() ?? '';
                const showHrId =
                  hrId.length > 0 && (!acc || hrId.toLowerCase() !== acc.toLowerCase());
                const headline = assignDisplayHeadline(row);
                const nick = row.hr_nickname?.trim();
                const picked = selectedAssigneeIds.includes(row.profile_id);
                const av = avatarUrlByProfileId.get(row.profile_id);
                return (
                  <Pressable
                    key={row.profile_id}
                    style={[styles.assignTeamPickRow, picked && styles.assignTeamPickRowOn]}
                    onPress={() => toggleAssignee(row.profile_id)}>
                    <View style={styles.assignTeamPickInner}>
                      <UserAvatar
                        uri={av ?? undefined}
                        label={headline || row.account_email || row.profile_id}
                        size={44}
                      />
                      <View style={styles.assignTeamPickBody}>
                        <Text style={styles.assignTeamPickPrimary}>
                          {headline || 'ยังไม่มีชื่อในระบบ'}
                        </Text>
                        {nick ? (
                          <Text style={styles.assignTeamPickNickname}>ชื่อเล่น {nick}</Text>
                        ) : null}
                        {acc ? (
                          <Text style={styles.assignTeamPickEmail} numberOfLines={2}>
                            อีเมลล็อกอิน: {acc}
                          </Text>
                        ) : null}
                        {showHrId ? (
                          <Text style={styles.assignTeamPickHrId} numberOfLines={2}>
                            HR UserID: {hrId}
                          </Text>
                        ) : null}
                      </View>
                    </View>
                  </Pressable>
                );
              })}
              <View style={[styles.actions, { marginTop: 12 }]}>
                <Pressable onPress={() => setAssignModalOpen(false)} disabled={assigning}>
                  <Text style={{ color: NatureTheme.colors.text }}>ยกเลิก</Text>
                </Pressable>
                <Pressable
                  style={[styles.save, assigning && styles.disabled]}
                  onPress={() => void assignTaskToMember()}
                  disabled={assigning}>
                  {assigning ? (
                    <ActivityIndicator color={NatureTheme.colors.onAccent} />
                  ) : (
                    <Text style={styles.saveText}>มอบหมายงาน</Text>
                  )}
                </Pressable>
              </View>
            </ScrollView>
          </Pressable>
        </View>
      </Modal>

      <FriendlyConfirmModal
        visible={deleteMemberTaskId != null}
        title="ลบงานจากระบบ?"
        message="งาน เช็คลิสต์ และไฟล์แนบที่เกี่ยวข้องจะถูกลบถาวร ไม่สามารถกู้คืนได้"
        confirmLabel={deleteMemberBusy ? 'กำลังลบ…' : 'ลบถาวร'}
        cancelLabel="ยกเลิก"
        danger
        onConfirm={() => void confirmDeleteMemberTask()}
        onCancel={() => {
          if (!deleteMemberBusy) setDeleteMemberTaskId(null);
        }}
      />
    </View>
  );
}

const c = NatureTheme.colors;
const r = NatureTheme.radius;
const s = NatureTheme.spacing;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.canvas },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  h2: { fontSize: 18, fontWeight: '700', marginBottom: 8, color: c.text },
  mutedSmall: { fontSize: 13, color: c.textMuted, marginBottom: 10, lineHeight: 18 },
  managerTop: { paddingHorizontal: s.screen, paddingTop: 8 },
  leaveCard: {
    backgroundColor: c.surface,
    borderRadius: r.md,
    borderWidth: 1,
    borderColor: c.borderSoft,
    padding: 12,
    marginBottom: 10,
  },
  leaveWho: { fontSize: 15, fontWeight: '700', color: c.text },
  leaveMeta: { fontSize: 12, color: c.textMuted, marginTop: 4 },
  leaveReason: { fontSize: 13, color: c.textSecondary, marginTop: 8 },
  leaveActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 12 },
  leaveBtn: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: r.sm },
  leaveBtnReject: { backgroundColor: c.surfaceMuted, borderWidth: 1, borderColor: c.border },
  leaveBtnRejectText: { color: c.text, fontWeight: '700', fontSize: 13 },
  leaveBtnOk: { backgroundColor: c.primary },
  leaveBtnOkText: { color: c.onAccent, fontWeight: '700', fontSize: 13 },
  goScheduleBtn: {
    alignSelf: 'flex-start',
    marginTop: 8,
    backgroundColor: c.primaryLight,
    borderWidth: 1,
    borderColor: c.primaryMuted,
    borderRadius: r.sm,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  goScheduleBtnText: { color: c.primaryDark, fontWeight: '700', fontSize: 14 },
  branchListContent: { paddingBottom: s.scrollBottom ?? 24 },
  branchToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: s.screen,
    paddingVertical: 10,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: c.borderSoft,
    backgroundColor: c.surface,
  },
  branchToolbarBack: { paddingVertical: 4 },
  branchToolbarBackText: { fontSize: 15, fontWeight: '700', color: c.link },
  branchToolbarMid: { flex: 1, minWidth: 0 },
  branchToolbarTitle: { fontSize: 15, fontWeight: '700', color: c.text, textAlign: 'center' },
  branchCard: {
    marginHorizontal: s.screen,
    marginTop: s.section,
    padding: s.card,
    backgroundColor: c.surface,
    borderRadius: r.md,
    borderWidth: 1,
    borderColor: c.borderSoft,
  },
  branchCardRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  branchCardIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: c.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  branchCardIconText: { fontSize: 22 },
  branchCardBody: { flex: 1, minWidth: 0 },
  branchCardTitle: { fontSize: 17, fontWeight: '700', color: c.text },
  branchCardSub: { marginTop: 4, fontSize: 12, color: c.textMuted },
  branchCardCount: { marginTop: 6, fontSize: 13, fontWeight: '600', color: c.primaryDark },
  branchCardChevron: { fontSize: 22, color: c.textMuted, fontWeight: '300' },
  card: {
    marginHorizontal: s.screen,
    marginTop: s.section,
    padding: s.card,
    backgroundColor: c.surface,
    borderRadius: r.md,
    borderWidth: 1,
    borderColor: c.borderSoft,
  },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardBody: { flex: 1 },
  name: { fontWeight: '700', fontSize: 16, color: c.text },
  meta: { marginTop: 4, color: c.textMuted },
  linkNowBtn: {
    alignSelf: 'flex-start',
    marginTop: 8,
    backgroundColor: c.primaryLight,
    borderWidth: 1,
    borderColor: c.primaryMuted,
    borderRadius: r.sm,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  linkNowBtnText: { color: c.primaryDark, fontWeight: '700', fontSize: 12 },
  empty: { textAlign: 'center', color: c.textMuted, marginTop: 20 },
  backdrop: {
    flex: 1,
    backgroundColor: c.overlay,
    justifyContent: 'flex-end',
  },
  modal: {
    backgroundColor: c.surfaceElevated,
    padding: 14,
    borderTopLeftRadius: r.lg,
    borderTopRightRadius: r.lg,
    maxHeight: '92%',
    minHeight: '70%',
  },
  modalTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    gap: 8,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', marginBottom: 10, color: c.text },
  modalCloseTopBtn: {
    backgroundColor: c.surfaceMuted,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: r.sm,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  modalCloseTopBtnText: { color: c.text, fontSize: 12, fontWeight: '800' },
  sectionTitle: {
    marginTop: 14,
    marginBottom: 8,
    fontSize: 15,
    fontWeight: '700',
    color: c.text,
  },
  sectionSubText: { fontSize: 12, color: c.textMuted, marginBottom: 8 },
  memberTaskSearchInput: {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: r.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 6,
    fontSize: 14,
    color: c.text,
    backgroundColor: c.surface,
  },
  memberTaskSearchKpiHint: {
    fontSize: 11,
    color: c.primaryDark,
    marginBottom: 10,
    fontWeight: '600',
  },
  memberTasksScrollHint: {
    fontSize: 11,
    color: c.textMuted,
    marginBottom: 6,
  },
  memberTasksScroll: {
    maxHeight: 320,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: c.borderSoft,
    borderRadius: r.sm,
    backgroundColor: c.surface,
    padding: 8,
  },
  memberTasksEmpty: {
    padding: 16,
    textAlign: 'center',
    fontSize: 13,
    color: c.textMuted,
  },
  taskCardDeleteBtn: {
    alignSelf: 'flex-end',
    marginBottom: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: r.sm,
    backgroundColor: c.errorBg,
  },
  taskCardDeleteBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: c.error,
  },
  openAssignBtn: {
    backgroundColor: c.primaryLight,
    borderWidth: 1,
    borderColor: c.primaryMuted,
    borderRadius: r.sm,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 8,
    alignItems: 'center',
  },
  openAssignBtnText: { color: c.primaryDark, fontWeight: '700', fontSize: 12 },
  memberHeader: { flexDirection: 'row', gap: 10, alignItems: 'center', marginBottom: 8 },
  memberHeaderBody: { flex: 1 },
  memberName: { fontSize: 16, fontWeight: '700', color: c.text },
  memberMeta: { fontSize: 12, color: c.textMuted, marginTop: 2 },
  input: {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: r.sm,
    padding: 10,
    marginBottom: 8,
    backgroundColor: c.surface,
    color: c.text,
  },
  textArea: { minHeight: 72, textAlignVertical: 'top' },
  label: { fontWeight: '600', marginBottom: 6, color: c.textSecondary },
  list: { maxHeight: 180, marginBottom: 12 },
  row: { padding: 10, borderBottomWidth: 1, borderColor: c.borderSoft },
  rowOn: { backgroundColor: c.primaryLight },
  summaryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  summaryChip: {
    minWidth: 112,
    backgroundColor: c.surfaceMuted,
    borderWidth: 1,
    borderColor: c.borderSoft,
    borderRadius: r.sm,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  summaryLabel: { fontSize: 11, color: c.textMuted },
  summaryValue: { marginTop: 2, fontSize: 16, fontWeight: '700', color: c.text },
  taskRow: {
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: c.borderSoft,
  },
  taskCard: {
    backgroundColor: c.surfaceMuted,
    borderRadius: r.sm,
    borderWidth: 1,
    borderColor: c.borderSoft,
    padding: 10,
    marginBottom: 8,
  },
  taskTitle: { fontSize: 13, color: c.text, fontWeight: '600' },
  taskMeta: { marginTop: 2, fontSize: 11, color: c.textMuted },
  taskProgressWrap: { marginTop: 8, marginBottom: 2 },
  taskProgressHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  taskProgressLabel: { fontSize: 11, color: c.textSecondary, fontWeight: '600' },
  taskProgressValue: { fontSize: 11, color: c.primaryDark, fontWeight: '700' },
  taskProgressRisk: { color: c.error },
  taskProgressWarn: { color: c.warningTitle },
  taskProgressGood: { color: c.checkIn },
  kpiRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  kpiCard: {
    minWidth: 104,
    backgroundColor: c.surfaceMuted,
    borderWidth: 1,
    borderColor: c.borderSoft,
    borderRadius: r.sm,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  kpiLabel: { fontSize: 11, color: c.textMuted },
  kpiValue: { marginTop: 2, fontSize: 18, fontWeight: '800', color: c.text },
  kpiWarn: { color: c.warningTitle },
  kpiHint: { marginTop: 2, fontSize: 10, color: c.textSecondary },
  deadlineRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  deadlineCard: {
    flex: 1,
    backgroundColor: c.surfaceMuted,
    borderWidth: 1,
    borderColor: c.borderSoft,
    borderRadius: r.sm,
    paddingVertical: 8,
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  deadlineTitle: { fontSize: 10, color: c.textMuted },
  deadlineValue: { marginTop: 2, fontSize: 16, fontWeight: '800', color: c.text },
  deadlinePct: { marginTop: 1, fontSize: 11, color: c.primaryDark, fontWeight: '700' },
  performanceLine: { fontSize: 11, color: c.textSecondary, marginBottom: 10 },
  statusBoard: {
    backgroundColor: c.surfaceMuted,
    borderWidth: 1,
    borderColor: c.borderSoft,
    borderRadius: r.sm,
    padding: 10,
    marginBottom: 10,
  },
  statusBoardTitle: { fontSize: 13, fontWeight: '800', color: c.text, marginBottom: 8 },
  statusBoardRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  statusBoardLabel: { width: 68, fontSize: 11, color: c.textSecondary },
  statusBoardTrack: {
    flex: 1,
    height: 8,
    borderRadius: 999,
    backgroundColor: c.chip,
    overflow: 'hidden',
  },
  statusBoardFill: { height: '100%', borderRadius: 999 },
  statusBoardFillPending: { backgroundColor: c.warningTitle },
  statusBoardFillProgress: { backgroundColor: c.primary },
  statusBoardFillDone: { backgroundColor: c.checkIn },
  statusBoardFillCancelled: { backgroundColor: c.textMuted },
  statusBoardStat: { width: 56, textAlign: 'right', fontSize: 10, color: c.textMuted },
  taskStatusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  taskStatusChip: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: r.sm,
    backgroundColor: c.chip,
  },
  taskStatusChipOn: { backgroundColor: c.chipActive },
  taskStatusChipText: { color: c.chipText, fontSize: 11 },
  taskStatusChipTextOn: { color: c.chipTextActive, fontWeight: '700' },
  assigneeRow: {
    borderWidth: 1,
    borderColor: c.borderSoft,
    borderRadius: r.sm,
    paddingVertical: 10,
    paddingHorizontal: 10,
    marginBottom: 6,
    backgroundColor: c.surface,
  },
  assigneeRowOn: { backgroundColor: c.primaryLight, borderColor: c.primaryMuted },
  assigneeText: { color: c.text, fontSize: 13, fontWeight: '600' },
  assignTeamLabel: {
    fontWeight: '600',
    fontSize: 13,
    color: c.textSecondary,
    marginBottom: 6,
    marginTop: 8,
  },
  assignTeamHint: {
    fontSize: 12,
    color: c.textMuted,
    marginBottom: 10,
    lineHeight: 17,
  },
  assignTeamEmpty: {
    fontSize: 13,
    color: c.warningTitle,
    marginBottom: 12,
    lineHeight: 20,
  },
  assignTeamSearch: {
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
  assignTeamNoResults: {
    fontSize: 13,
    color: c.textMuted,
    marginBottom: 10,
    fontStyle: 'italic',
  },
  assignTeamPickRow: {
    paddingVertical: 10,
    paddingHorizontal: 8,
    marginBottom: 4,
    borderRadius: r.sm,
    borderWidth: 1,
    borderColor: c.borderSoft,
    backgroundColor: c.surface,
  },
  assignTeamPickRowOn: {
    backgroundColor: c.primaryLight,
    borderColor: c.primaryMuted,
  },
  assignTeamPickInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  assignTeamPickBody: { flex: 1, minWidth: 0 },
  assignTeamPickPrimary: { fontSize: 15, fontWeight: '600', color: c.text },
  assignTeamPickNickname: { fontSize: 13, color: c.primaryDark, marginTop: 2 },
  assignTeamPickEmail: { fontSize: 11, color: c.textMuted, marginTop: 2 },
  assignTeamPickHrId: { fontSize: 11, color: c.accentWarm, marginTop: 2 },
  assignModalScroll: { paddingBottom: 20 },
  assignFormLabel: {
    fontWeight: '600',
    fontSize: 13,
    color: c.textSecondary,
    marginBottom: 6,
    marginTop: 8,
  },
  assignFormInput: {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: r.sm,
    padding: 12,
    marginBottom: 10,
    backgroundColor: c.surface,
    color: c.text,
    fontSize: 15,
  },
  assignFormTall: { minHeight: 88, textAlignVertical: 'top' },
  assignPriRow: { gap: 8, marginBottom: 8 },
  assignPriChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    borderRadius: r.sm,
    borderWidth: 1.5,
    backgroundColor: c.surfaceMuted,
  },
  assignPriDot: { width: 12, height: 12, borderRadius: 6 },
  assignPriText: { flex: 1, fontSize: 12, color: c.text },
  assignLineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  assignFormLineInput: { flex: 1, marginBottom: 0 },
  assignRemoveLine: {
    paddingHorizontal: s.screen,
    paddingVertical: 12,
    borderRadius: r.sm,
    backgroundColor: c.errorBg,
    borderWidth: 1,
    borderColor: c.error + '55',
  },
  assignRemoveLineDisabled: { opacity: 0.35 },
  assignRemoveLineText: { color: c.error, fontWeight: '700', fontSize: 13 },
  assignAddLine: { paddingVertical: 8, marginBottom: 8 },
  assignAddLineText: { color: c.link, fontWeight: '600' },
  priorityRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  priorityChip: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: r.sm,
    backgroundColor: c.surfaceMuted,
    borderWidth: 1,
    borderColor: c.borderSoft,
  },
  priorityChipOn: { backgroundColor: c.primaryLight, borderColor: c.primaryMuted },
  priorityChipText: { color: c.textSecondary, fontSize: 12, fontWeight: '600' },
  priorityChipTextOn: { color: c.primaryDark, fontWeight: '700' },
  periodText: { fontSize: 12, color: c.textSecondary, marginBottom: 8 },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
    alignItems: 'center',
  },
  closeBtn: {
    backgroundColor: c.surfaceMuted,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: r.sm,
    paddingVertical: 10,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  closeBtnText: { color: c.text, fontWeight: '700' },
  exportBtn: {
    flex: 1,
    backgroundColor: c.primaryLight,
    borderWidth: 1,
    borderColor: c.primaryMuted,
    borderRadius: r.sm,
    paddingVertical: 10,
    alignItems: 'center',
  },
  exportBtnText: { color: c.primaryDark, fontWeight: '700' },
  exportBtnAlt: {
    flex: 1,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: r.sm,
    paddingVertical: 10,
    alignItems: 'center',
  },
  exportBtnAltText: { color: c.text, fontWeight: '700' },
  save: {
    backgroundColor: c.primary,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: r.sm,
    alignItems: 'center',
  },
  saveText: { color: c.onAccent, fontWeight: '700' },
  disabled: { opacity: 0.6 },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: c.borderSoft,
  },
  tableHead: { backgroundColor: c.surfaceMuted, borderTopWidth: 1, borderTopColor: c.borderSoft },
  headText: { fontWeight: '700' },
  cell: { paddingHorizontal: 8, paddingVertical: 8, fontSize: 12, color: c.text },
  colDate: { width: 110 },
  colTime: { width: 130 },
  colCode: { width: 110 },
  colLoc: { width: 210 },
});
