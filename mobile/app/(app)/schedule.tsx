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

import { DatePickerField } from '@/components/DatePickerField';
import { UserAvatar } from '@/components/UserAvatar';
import { NatureTheme } from '@/constants/Theme';
import { isAdmin, isManagerOrAdmin, useAuth, useRole } from '@/contexts/AuthContext';
import { useCuteToast } from '@/contexts/CuteToastContext';
import { eachCalendarYmdInclusive } from '@/lib/leaveLateRules';
import { dateToBangkokYmd } from '@/lib/taskHelpers';
import { supabase } from '@/lib/supabase';
import type {
  Branch,
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

type SchedulePerson = Profile & { avatar_url?: string | null; employee_id?: string | null };
type EmployeeLite = { id: string; position?: string | null; nickname?: string | null };

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

  const [rows, setRows] = useState<WorkScheduleRow[]>([]);
  const [shifts, setShifts] = useState<WorkShiftRow[]>([]);
  const [assignments, setAssignments] = useState<AssignmentWithShift[]>([]);
  const [people, setPeople] = useState<SchedulePerson[]>([]);
  const [positionByProfileId, setPositionByProfileId] = useState<Record<string, string>>({});
  const [nicknameByProfileId, setNicknameByProfileId] = useState<Record<string, string>>({});
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
  const [bulkFromDate, setBulkFromDate] = useState<Date | null>(null);
  const [bulkToDate, setBulkToDate] = useState<Date | null>(null);
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
    const { data: asn, error: asnErr } = await supabase
      .from('work_schedule_assignments')
      .select(WORK_SCHEDULE_ASSIGNMENT_SELECT)
      .order('work_date', { ascending: false });

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
        setAssignments((asn ?? []) as unknown as AssignmentWithShift[]);
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
      const [{ data: sc }, { data: reps }] = await Promise.all([
        supabase
          .from('manager_scopes')
          .select('can_manage_schedule')
          .eq('manager_id', uid)
          .maybeSingle(),
        supabase
          .from('manager_direct_reports')
          .select('subordinate_id')
          .eq('manager_id', uid),
      ]);
      const canSch = !!(sc as { can_manage_schedule?: boolean } | null)?.can_manage_schedule;
      const subIds = new Set(
        (reps as { subordinate_id?: string }[] | null)
          ?.map((r) => r.subordinate_id)
          .filter((x): x is string => !!x) ?? []
      );
      if (!canSch) {
        list = list.filter((p) => p.id === uid);
      } else {
        list = list.filter((p) => p.id === uid || subIds.has(p.id));
      }
    }
    setPeople(list);
    const empIds = [...new Set(list.map((p) => p.employee_id).filter((x): x is string => !!x))];
    if (empIds.length === 0) {
      setPositionByProfileId({});
      setNicknameByProfileId({});
    } else {
      const { data: emps } = await supabase
        .from('employee')
        .select('id, position, nickname')
        .in('id', empIds);
      const posByEmployeeId = new Map<string, string>();
      const nickByEmployeeId = new Map<string, string>();
      for (const row of (emps as EmployeeLite[] | null) ?? []) {
        const pos = row.position?.trim();
        if (pos) posByEmployeeId.set(String(row.id), pos);
        const nick = row.nickname?.trim();
        if (nick) nickByEmployeeId.set(String(row.id), nick);
      }
      const nextPosByProfileId: Record<string, string> = {};
      const nextNicknameByProfileId: Record<string, string> = {};
      for (const p of list) {
        const empId = p.employee_id ? String(p.employee_id) : '';
        const pos = empId ? posByEmployeeId.get(empId) : undefined;
        const nick = empId ? nickByEmployeeId.get(empId) : undefined;
        if (pos) nextPosByProfileId[p.id] = pos;
        if (nick) nextNicknameByProfileId[p.id] = nick;
      }
      setPositionByProfileId(nextPosByProfileId);
      setNicknameByProfileId(nextNicknameByProfileId);
    }
    const { data: br } = await supabase
      .from('branch_information')
      .select('id, branch_name, branch_code')
      .order('branch_name');
    setBranches((br as Pick<Branch, 'id' | 'branch_name' | 'branch_code'>[]) ?? []);
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
      m.set(p.id, p.full_name || p.email || p.id.slice(0, 8));
    }
    return m;
  }, [people]);
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
  const assignmentUsers = useMemo(
    () =>
      people
        .map((p) => ({
          id: p.id,
          label: p.full_name || p.email || p.id.slice(0, 8),
          avatarUrl: p.avatar_url ?? null,
          subtitle:
            positionByProfileId[p.id] ||
            `${roleLabelTh(p.role)} · ${p.employee_code?.trim() || '—'}`,
          nickname: nicknameByProfileId[p.id] || null,
          count: visibleAssignments.filter((a) => a.user_id === p.id).length,
        }))
        .sort((a, b) => a.label.localeCompare(b.label, 'th')),
    [people, positionByProfileId, nicknameByProfileId, visibleAssignments]
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

  async function saveBulkAssignments() {
    if (shiftModuleMissing) {
      toast.info(
        'ฐานข้อมูลยังไม่พร้อม',
        'รัน migration 20260415200000_leave_late_shifts.sql บน Supabase ก่อน'
      );
      return;
    }
    if (!session?.user?.id || !bulkShiftId || !bulkFromDate || !bulkToDate) {
      toast.info('ข้อมูลไม่ครบ', 'เลือกกะ วันเริ่ม และวันสิ้นสุดจากปฏิทิน');
      return;
    }
    const bulkFrom = dateToBangkokYmd(bulkFromDate);
    const bulkTo = dateToBangkokYmd(bulkToDate);
    if (bulkFrom > bulkTo) {
      toast.info('วันที่', 'วันเริ่มต้องไม่เกินวันสิ้นสุด');
      return;
    }
    const uids = Object.keys(bulkUserIds).filter((k) => bulkUserIds[k]);
    if (uids.length === 0) {
      toast.info('พนักงาน', 'เลือกอย่างน้อย 1 คน');
      return;
    }
    const days = eachCalendarYmdInclusive(bulkFrom, bulkTo);
    const chunk: {
      user_id: string;
      work_date: string;
      shift_id: string;
      allowed_branch_id: number | null;
      created_by: string;
    }[] = [];
    for (const uid of uids) {
      for (const d of days) {
        chunk.push({
          user_id: uid,
          work_date: d,
          shift_id: bulkShiftId,
          allowed_branch_id: bulkAllowedBranchId,
          created_by: session.user.id,
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
      setBulkOpen(false);
      setBulkUserIds({});
      setBulkFromDate(null);
      setBulkToDate(null);
      setBulkAllowedBranchId(null);
      await load();
      toast.success('มอบหมายแล้ว', `รวม ${chunk.length} แถว (ทับวันเดิมถ้ามี)`);
    } catch (e) {
      toast.error(
        'มอบหมายไม่สำเร็จ',
        e instanceof Error ? e.message : String(e)
      );
    } finally {
      setBulkSaving(false);
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
      const { error } = await supabase
        .from('work_schedule_assignments')
        .update({
          work_date: ymd,
          shift_id: editAsnShiftId,
          allowed_branch_id: editAsnBranchId,
        })
        .eq('id', editingAssignment.id);
      if (error) throw new Error(error.message);
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
      <View style={styles.center}>
        <ActivityIndicator size="large" color={NatureTheme.colors.primary} />
      </View>
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
            tintColor={NatureTheme.colors.primary}
          />
        }>
      <Text style={styles.hint}>
        ตารางแบบ ISO (เดิม) กับกะ template + มอบหมายรายวัน (ใหม่)
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
          <Pressable style={styles.addBtn} onPress={() => setOpen(true)}>
            <Text style={styles.addBtnText}>+ ตาราง ISO</Text>
          </Pressable>
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
            onPress={() => {
              if (shiftModuleMissing) {
                toast.info(
                  'ฐานข้อมูล',
                  'รัน migration ก่อน จึงจะมอบหมายได้ — ดูกล่องแจ้งเตือนด้านบน'
                );
                return;
              }
              setBulkOpen(true);
            }}>
            <Text style={styles.addBtnAltText}>มอบหมาย</Text>
          </Pressable>
        </View>
      ) : (
        <Text style={styles.muted}>
          มอบหมายกะรายวันและแก้กะ — เฉพาะผู้จัดการ/แอดมิน
        </Text>
      )}

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
                      {u.nickname ? (
                        <Text style={styles.assignmentUserCardMeta}>ชื่อเล่น: {u.nickname}</Text>
                      ) : null}
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

      <Text style={styles.section}>ตารางแบบเต็มช่วง (work_schedules)</Text>
      <Text style={styles.hint}>ตัวอย่างเวลา: 2026-04-06T09:00:00+07:00</Text>
      {rows.length === 0 ? (
        <Text style={styles.empty}>ยังไม่มีตาราง</Text>
      ) : (
        rows.map((item) => (
          <View key={item.id} style={styles.card}>
            <Text style={styles.cardTitle}>{item.title || 'กะงาน'}</Text>
            <Text style={styles.cardMeta}>
              {new Date(item.start_at).toLocaleString('th-TH')} →{' '}
              {new Date(item.end_at).toLocaleString('th-TH')}
            </Text>
            <Text style={styles.cardMeta}>
              พนักงาน: {peopleLabel.get(item.user_id) ?? item.user_id.slice(0, 8)}
            </Text>
            {mgr ? (
              <View style={styles.cardActions}>
                <Pressable onPress={() => openEditSchedule(item)}>
                  <Text style={styles.linkBtn}>แก้ไข</Text>
                </Pressable>
                <Pressable onPress={() => askDeleteSchedule(item)}>
                  <Text style={styles.linkBtnDanger}>ลบ</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        ))
      )}
      </ScrollView>

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
              placeholderTextColor={NatureTheme.colors.textMuted}
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
                        <Text style={{ color: NatureTheme.colors.text, fontWeight: selected ? '700' : '500' }}>
                          {item.label}
                        </Text>
                        <Text style={styles.pickerEmployeeMeta}>{item.subtitle}</Text>
                        {item.nickname ? (
                          <Text style={styles.pickerEmployeeMeta}>ชื่อเล่น: {item.nickname}</Text>
                        ) : null}
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
                <Text style={{ color: NatureTheme.colors.text }}>ล้างการเลือก</Text>
              </Pressable>
              <Pressable onPress={() => setAssignmentPickerOpen(false)}>
                <Text style={{ color: NatureTheme.colors.text }}>ปิด</Text>
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
                  color={NatureTheme.colors.primary}
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
                <Text style={{ color: NatureTheme.colors.text }}>ปิด</Text>
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
                  <Text style={{ color: NatureTheme.colors.text }}>
                    {sh.name} ({sh.start_time.slice(0, 5)}–{sh.end_time.slice(0, 5)})
                  </Text>
                </Pressable>
              ))}
              <Text style={styles.label}>สาขาที่เข้าได้</Text>
              <Pressable
                style={[styles.row, bulkEditAsnBranchId == null && styles.rowOn]}
                onPress={() => setBulkEditAsnBranchId(null)}>
                <Text style={{ color: NatureTheme.colors.text }}>ไม่จำกัดสาขา</Text>
              </Pressable>
              {branches.map((br) => (
                <Pressable
                  key={String(br.id)}
                  style={[styles.row, bulkEditAsnBranchId === br.id && styles.rowOn]}
                  onPress={() => setBulkEditAsnBranchId(br.id)}>
                  <Text style={{ color: NatureTheme.colors.text }}>
                    {br.branch_name || br.branch_code || `สาขา ${br.id}`}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
            <View style={styles.actions}>
              <Pressable onPress={() => setBulkEditAsnOpen(false)} disabled={bulkEditAsnSaving}>
                <Text style={{ color: NatureTheme.colors.text }}>ยกเลิก</Text>
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
                <Text style={{ color: NatureTheme.colors.text }}>ยกเลิก</Text>
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
              placeholderTextColor={NatureTheme.colors.textMuted}
              value={title}
              onChangeText={setTitle}
            />
            <TextInput
              style={styles.input}
              placeholder="เริ่ม (ISO datetime)"
              placeholderTextColor={NatureTheme.colors.textMuted}
              value={startAt}
              onChangeText={setStartAt}
            />
            <TextInput
              style={styles.input}
              placeholder="สิ้นสุด (ISO datetime)"
              placeholderTextColor={NatureTheme.colors.textMuted}
              value={endAt}
              onChangeText={setEndAt}
            />
            <Text style={styles.label}>พนักงาน</Text>
            <FlatList
              style={styles.list}
              data={people}
              keyExtractor={(p) => p.id}
              renderItem={({ item: p }) => (
                <Pressable
                  style={[styles.row, userId === p.id && styles.rowOn]}
                  onPress={() => setUserId(p.id)}>
                  <Text style={{ color: NatureTheme.colors.text }}>
                    {p.full_name || p.email || p.id}
                  </Text>
                </Pressable>
              )}
            />
            <View style={styles.actions}>
              <Pressable onPress={() => setOpen(false)}>
                <Text style={{ color: NatureTheme.colors.text }}>ยกเลิก</Text>
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
              placeholderTextColor={NatureTheme.colors.textMuted}
              value={shiftName}
              onChangeText={setShiftName}
            />
            <TextInput
              style={styles.input}
              placeholder="เริ่ม HH:MM"
              placeholderTextColor={NatureTheme.colors.textMuted}
              value={shiftStart}
              onChangeText={setShiftStart}
            />
            <TextInput
              style={styles.input}
              placeholder="สิ้นสุด HH:MM"
              placeholderTextColor={NatureTheme.colors.textMuted}
              value={shiftEnd}
              onChangeText={setShiftEnd}
            />
            <View style={styles.actions}>
              <Pressable onPress={() => setShiftOpen(false)}>
                <Text style={{ color: NatureTheme.colors.text }}>ยกเลิก</Text>
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
                  <Text style={{ color: NatureTheme.colors.text }}>
                    {sh.name} ({sh.start_time.slice(0, 5)}–{sh.end_time.slice(0, 5)})
                  </Text>
                </Pressable>
              ))}
              <DatePickerField
                label="วันเริ่ม"
                value={bulkFromDate}
                onChange={setBulkFromDate}
                disabled={bulkSaving}
                maximumDate={bulkToDate ?? undefined}
              />
              <DatePickerField
                label="วันสิ้นสุด"
                value={bulkToDate}
                onChange={setBulkToDate}
                disabled={bulkSaving}
                minimumDate={bulkFromDate ?? undefined}
              />
              <Text style={styles.label}>สาขาที่เข้าได้ (ตามตาราง)</Text>
              <Pressable
                style={[styles.row, bulkAllowedBranchId == null && styles.rowOn]}
                onPress={() => setBulkAllowedBranchId(null)}>
                <Text style={{ color: NatureTheme.colors.text }}>ไม่จำกัดสาขา</Text>
              </Pressable>
              {branches.map((br) => (
                <Pressable
                  key={String(br.id)}
                  style={[styles.row, bulkAllowedBranchId === br.id && styles.rowOn]}
                  onPress={() => setBulkAllowedBranchId(br.id)}>
                  <Text style={{ color: NatureTheme.colors.text }}>
                    {(br.branch_name || br.branch_code || `สาขา ${br.id}`) +
                      (br.branch_code ? ` (${br.branch_code})` : '')}
                  </Text>
                </Pressable>
              ))}
              <Text style={styles.label}>พนักงาน (แตะเลือกหลายคน)</Text>
              {people.map((p) => {
                const on = !!bulkUserIds[p.id];
                return (
                  <Pressable
                    key={p.id}
                    style={[styles.row, on && styles.rowOn]}
                    onPress={() =>
                      setBulkUserIds((prev) => ({ ...prev, [p.id]: !on }))
                    }>
                    <Text style={{ color: NatureTheme.colors.text }}>
                      {(on ? '✓ ' : '') + (p.full_name || p.email || p.id)}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <View style={styles.actions}>
              <Pressable onPress={() => setBulkOpen(false)} disabled={bulkSaving}>
                <Text style={{ color: NatureTheme.colors.text }}>ยกเลิก</Text>
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
                  <Text style={{ color: NatureTheme.colors.text }}>
                    {sh.name} ({sh.start_time.slice(0, 5)}–{sh.end_time.slice(0, 5)})
                  </Text>
                </Pressable>
              ))}
              <Text style={styles.label}>สาขาที่เข้าได้</Text>
              <Pressable
                style={[styles.row, editAsnBranchId == null && styles.rowOn]}
                onPress={() => setEditAsnBranchId(null)}>
                <Text style={{ color: NatureTheme.colors.text }}>ไม่จำกัดสาขา</Text>
              </Pressable>
              {branches.map((br) => (
                <Pressable
                  key={String(br.id)}
                  style={[styles.row, editAsnBranchId === br.id && styles.rowOn]}
                  onPress={() => setEditAsnBranchId(br.id)}>
                  <Text style={{ color: NatureTheme.colors.text }}>
                    {br.branch_name || br.branch_code || `สาขา ${br.id}`}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
            <View style={styles.actions}>
              <Pressable onPress={() => setEditAsnOpen(false)} disabled={editAsnSaving}>
                <Text style={{ color: NatureTheme.colors.text }}>ยกเลิก</Text>
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
              placeholderTextColor={NatureTheme.colors.textMuted}
              value={editScheduleTitle}
              onChangeText={setEditScheduleTitle}
            />
            <TextInput
              style={styles.input}
              placeholder="เริ่ม (ISO datetime)"
              placeholderTextColor={NatureTheme.colors.textMuted}
              value={editScheduleStartAt}
              onChangeText={setEditScheduleStartAt}
            />
            <TextInput
              style={styles.input}
              placeholder="สิ้นสุด (ISO datetime)"
              placeholderTextColor={NatureTheme.colors.textMuted}
              value={editScheduleEndAt}
              onChangeText={setEditScheduleEndAt}
            />
            <View style={styles.actions}>
              <Pressable onPress={() => setEditScheduleOpen(false)} disabled={editScheduleSaving}>
                <Text style={{ color: NatureTheme.colors.text }}>ยกเลิก</Text>
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
                placeholderTextColor={NatureTheme.colors.textMuted}
                value={editShiftName}
                onChangeText={setEditShiftName}
              />
              <TextInput
                style={styles.input}
                placeholder="เริ่ม HH:MM"
                placeholderTextColor={NatureTheme.colors.textMuted}
                value={editShiftStart}
                onChangeText={setEditShiftStart}
              />
              <TextInput
                style={styles.input}
                placeholder="สิ้นสุด HH:MM"
                placeholderTextColor={NatureTheme.colors.textMuted}
                value={editShiftEnd}
                onChangeText={setEditShiftEnd}
              />
            </ScrollView>
            <View style={styles.actions}>
              <Pressable onPress={() => setEditShiftOpen(false)} disabled={editShiftSaving}>
                <Text style={{ color: NatureTheme.colors.text }}>ยกเลิก</Text>
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
                <Text style={{ color: NatureTheme.colors.text }}>ยกเลิก</Text>
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

const c = NatureTheme.colors;
const r = NatureTheme.radius;
const s = NatureTheme.spacing;

const styles = StyleSheet.create({
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
