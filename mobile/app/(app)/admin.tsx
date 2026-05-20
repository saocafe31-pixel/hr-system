import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';
import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import {
  AdminEmployeeEditModal,
  ADMIN_NEW_EMPLOYEE_ID,
} from '@/components/AdminEmployeeEditModal';
import { AdminManagerDelegationModal } from '@/components/AdminManagerDelegationModal';
import { ZoomableImage } from '@/components/ZoomableImage';
import { NatureTheme } from '@/constants/Theme';
import { useAuth } from '@/contexts/AuthContext';
import { useCuteToast } from '@/contexts/CuteToastContext';
import { mergeEmployeeWithProfiles, isUuidLike } from '@/lib/adminEmployeeMerge';
import {
  ANNOUNCEMENT_SETTINGS_KEY,
  buildAnnouncementSettingsValue,
  parseAnnouncementSettings,
} from '@/lib/announcementSlides';
import {
  ATTENDANCE_KPI_SETTINGS_KEY,
  DEFAULT_ATTENDANCE_KPI_SETTINGS,
  parseAttendanceKpiSettings,
} from '@/lib/attendanceKpi';
import { mapBranchInformationRows } from '@/lib/mapBranchInformation';
import { supabase } from '@/lib/supabase';
import { uploadAnnouncementSlideFromUri } from '@/lib/uploadAnnouncementSlide';
import type {
  AdminEmployeePasswordRow,
  Branch,
  ExpenseClaimItemRow,
  ExpenseClaimRow,
  Profile,
  SalaryClaimRow,
} from '@/lib/types';
const BREAK_START_KEY = 'attendance_break_start_messages';
const BREAK_END_KEY = 'attendance_break_end_messages';
const DEFAULT_KPI_SETTINGS_TEXT = JSON.stringify(
  DEFAULT_ATTENDANCE_KPI_SETTINGS,
  null,
  2
);
type AnnouncementDraftItem =
  | { key: string; kind: 'saved'; url: string }
  | { key: string; kind: 'pending'; localUri: string };

function newDraftKey(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

const WEB_MODAL_BACKDROP = Platform.select({
  web: {
    position: 'fixed' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1_000_000,
  },
  default: {},
});

function looksLikeImageEvidenceUrl(url: string): boolean {
  const path = url.split(/[?#]/)[0]?.toLowerCase() ?? '';
  return /\.(jpe?g|png|gif|webp|bmp|heic|avif)$/i.test(path);
}

/** ใช้ร่วมกับค่า employee.status / employment_status จาก RPC */
function isResignedEmploymentStatus(status: string | null | undefined): boolean {
  const raw = (status ?? '').trim();
  if (!raw) return false;
  if (raw.includes('ลาออก') || raw.includes('พ้นสภาพ')) return true;
  const low = raw.toLowerCase();
  return (
    low.includes('resign') ||
    low.includes('terminated') ||
    low === 'inactive' ||
    low.includes('dismiss') ||
    low.includes('เลิกจ้าง')
  );
}

function normalizeEmployeeId(raw: unknown): string | null {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim();
  return s === '' ? null : s;
}

function normalizeTextKey(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase();
}

function normalizeDigits(raw: unknown): string {
  return String(raw ?? '').replace(/\D/g, '');
}

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
    const now = new Date();
    const fallback = attendancePeriodFromMonthKey(monthKeyOf(now));
    return fallback;
  }
  const to = new Date(y, m - 1, 25);
  const from = new Date(y, m - 2, 26);
  return { from: ymdOf(from), to: ymdOf(to) };
}

function parseYmdToDate(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, mo - 1, d);
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
}

/** แปลงค่าจาก app_settings เป็น array ช่องแก้ไข — อย่างน้อย 1 ช่องว่าง */
function breakMessagesToEditorLines(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object') return [''];
  const messages = (raw as { messages?: unknown }).messages;
  if (!Array.isArray(messages)) return [''];
  const lines = messages.map((v) =>
    typeof v === 'string' ? v : ''
  );
  const nonEmpty = lines.map((s) => s.trim()).filter((s) => s.length > 0);
  return nonEmpty.length > 0 ? nonEmpty : [''];
}

export default function AdminScreen() {
  const toast = useCuteToast();
  const { session } = useAuth();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [legacyAuth, setLegacyAuth] = useState<AdminEmployeePasswordRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [bId, setBId] = useState('');
  const [bCode, setBCode] = useState('');
  const [bName, setBName] = useState('');
  const [bAddr, setBAddr] = useState('');
  const [bPhone, setBPhone] = useState('');
  const [bLat, setBLat] = useState('');
  const [bLon, setBLon] = useState('');
  const [bRad, setBRad] = useState('150');
  const [setKey, setSetKey] = useState('company_name');
  const [setVal, setSetVal] = useState('');
  const [announcementItems, setAnnouncementItems] = useState<AnnouncementDraftItem[]>(
    []
  );
  const [announcementUrlDraft, setAnnouncementUrlDraft] = useState('');
  const [announcementUploading, setAnnouncementUploading] = useState(false);
  const [announcementSlideHeightPx, setAnnouncementSlideHeightPx] = useState(160);
  const [breakStartLines, setBreakStartLines] = useState<string[]>(['']);
  const [breakEndLines, setBreakEndLines] = useState<string[]>(['']);
  const [kpiSettingsText, setKpiSettingsText] = useState(DEFAULT_KPI_SETTINGS_TEXT);
  const [kpiSettingsSaving, setKpiSettingsSaving] = useState(false);
  const [editEmployeeId, setEditEmployeeId] = useState<string | null>(null);
  const [editPreview, setEditPreview] = useState<AdminEmployeePasswordRow | null>(
    null
  );
  const [legacyAuthError, setLegacyAuthError] = useState<string | null>(null);
  const adminScrollRef = useRef<ScrollView>(null);
  const [editBranch, setEditBranch] = useState<Branch | null>(null);
  const [ebCode, setEbCode] = useState('');
  const [ebName, setEbName] = useState('');
  const [ebAddr, setEbAddr] = useState('');
  const [ebPhone, setEbPhone] = useState('');
  const [ebLat, setEbLat] = useState('');
  const [ebLon, setEbLon] = useState('');
  const [ebRad, setEbRad] = useState('150');
  const [managerModalProfile, setManagerModalProfile] = useState<Profile | null>(null);
  const [salaryClaims, setSalaryClaims] = useState<SalaryClaimRow[]>([]);
  const [expenseClaims, setExpenseClaims] = useState<ExpenseClaimRow[]>([]);
  const [expenseClaimItems, setExpenseClaimItems] = useState<ExpenseClaimItemRow[]>([]);
  const [salaryReviewNotes, setSalaryReviewNotes] = useState<Record<string, string>>({});
  const [expenseReviewNotes, setExpenseReviewNotes] = useState<Record<string, string>>({});
  const [claimActionBusyKey, setClaimActionBusyKey] = useState<string | null>(null);
  const [expenseEvidencePreview, setExpenseEvidencePreview] = useState<{
    url: string;
    name: string | null;
  } | null>(null);
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [employeeActionBusyId, setEmployeeActionBusyId] = useState<string | null>(null);
  const [claimStatusFilter, setClaimStatusFilter] = useState<
    'all' | 'pending' | 'approved' | 'rejected' | 'paid'
  >('all');
  const [claimMonthFilter, setClaimMonthFilter] = useState(monthKeyOf(new Date()));
  const [claimDateFrom, setClaimDateFrom] = useState('');
  const [claimDateTo, setClaimDateTo] = useState('');
  const [datePickerTarget, setDatePickerTarget] = useState<'from' | 'to' | null>(null);

  const fetchAdminEmployeePasswordList = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_list_employee_passwords');
    if (error) {
      setLegacyAuth([]);
      setLegacyAuthError(error.message);
      return;
    }
    const raw = data as unknown;
    const list: AdminEmployeePasswordRow[] = Array.isArray(raw)
      ? (raw as AdminEmployeePasswordRow[])
      : raw != null
        ? [raw as AdminEmployeePasswordRow]
        : [];
    setLegacyAuth(list);
    setLegacyAuthError(null);
  }, []);

  const load = useCallback(async () => {
    const [{ data: br }, { data: pr }, { data: salaryRows }, { data: expenseRows }, { data: itemRows }] = await Promise.all([
      supabase.from('branch_information').select('*').order('branch_name'),
      supabase
        .from('profiles')
        .select(
          'id, email, full_name, role, branch_id, employee_code, phone, employee_id, avatar_url'
        )
        .order('full_name'),
      supabase.from('salary_claims').select('*').order('created_at', { ascending: false }),
      supabase.from('expense_claims').select('*').order('created_at', { ascending: false }),
      supabase.from('expense_claim_items').select('*').order('created_at', { ascending: false }),
    ]);
    setBranches(
      mapBranchInformationRows((br as Record<string, unknown>[]) ?? [])
    );
    const rawPr = (pr as Record<string, unknown>[]) ?? [];
    setProfiles(
      rawPr.map((row) => ({
        ...(row as unknown as Profile),
        branch_id:
          row.branch_id != null && row.branch_id !== ''
            ? Number(row.branch_id)
            : null,
        employee_id: normalizeEmployeeId(
          (row as Record<string, unknown>).employee_id
        ),
      }))
    );
    setSalaryClaims((salaryRows as SalaryClaimRow[]) ?? []);
    setExpenseClaims((expenseRows as ExpenseClaimRow[]) ?? []);
    setExpenseClaimItems((itemRows as ExpenseClaimItemRow[]) ?? []);
    await fetchAdminEmployeePasswordList();

    const [
      { data: annRow },
      { data: breakStartRow },
      { data: breakEndRow },
      { data: kpiRow },
    ] =
      await Promise.all([
        supabase
          .from('app_settings')
          .select('value')
          .eq('key', ANNOUNCEMENT_SETTINGS_KEY)
          .maybeSingle(),
        supabase
          .from('app_settings')
          .select('value')
          .eq('key', BREAK_START_KEY)
          .maybeSingle(),
        supabase
          .from('app_settings')
          .select('value')
          .eq('key', BREAK_END_KEY)
          .maybeSingle(),
        supabase
          .from('app_settings')
          .select('value')
          .eq('key', ATTENDANCE_KPI_SETTINGS_KEY)
          .maybeSingle(),
      ]);
    const annParsed = parseAnnouncementSettings(annRow?.value);
    setAnnouncementSlideHeightPx(annParsed.slideHeightPx);
    setAnnouncementItems(
      annParsed.urls.map((url, i) => ({
        key: newDraftKey(`s${i}`),
        kind: 'saved' as const,
        url,
      }))
    );
    setBreakStartLines(breakMessagesToEditorLines(breakStartRow?.value));
    setBreakEndLines(breakMessagesToEditorLines(breakEndRow?.value));
    setKpiSettingsText(
      JSON.stringify(parseAttendanceKpiSettings(kpiRow?.value), null, 2)
    );
  }, [fetchAdminEmployeePasswordList]);

  function money(v: number | null | undefined) {
    return Number(v ?? 0).toLocaleString('th-TH', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  function csvEscape(input: string): string {
    if (input.includes(',') || input.includes('\n') || input.includes('"')) {
      return `"${input.replace(/"/g, '""')}"`;
    }
    return input;
  }

  async function notifyClaimStatusUpdate(
    claimKind: 'salary' | 'expense',
    claimId: string,
    status: 'approved' | 'rejected' | 'paid',
    recipientUserId: string
  ) {
    const actorId = session?.user?.id ?? null;
    const adminIds = profiles.filter((p) => p.role === 'admin').map((p) => p.id);
    const recipients = Array.from(new Set([recipientUserId, ...adminIds]));
    const statusLabel =
      status === 'approved' ? 'อนุมัติแล้ว' : status === 'rejected' ? 'ปฏิเสธแล้ว' : 'จ่ายแล้ว';
    const claimLabel = claimKind === 'salary' ? 'เบิกเงินเดือน' : 'เบิกค่าใช้จ่าย';
    const body = `คำขอ${claimLabel} ถูกอัปเดตสถานะเป็น ${statusLabel}`;
    await supabase.from('finance_claim_notifications').insert(
      recipients.map((recipientId) => ({
        recipient_id: recipientId,
        actor_id: actorId,
        claim_kind: claimKind,
        claim_id: claimId,
        event_type: 'status_updated',
        status,
        body,
      }))
    );
  }

  async function updateSalaryClaimStatus(
    row: SalaryClaimRow,
    status: 'approved' | 'rejected' | 'paid'
  ) {
    const busyKey = `salary-${row.id}-${status}`;
    setClaimActionBusyKey(busyKey);
    const note = salaryReviewNotes[row.id]?.trim() || null;
    const actorId = session?.user?.id ?? null;
    const reviewedAt = new Date().toISOString();
    const { error } = await supabase
      .from('salary_claims')
      .update({
        status,
        review_note: note,
        reviewed_at: reviewedAt,
        reviewed_by: actorId,
      })
      .eq('id', row.id);
    if (error) {
      setClaimActionBusyKey(null);
      toast.error('อัปเดตสถานะไม่สำเร็จ', error.message);
      return;
    }
    await notifyClaimStatusUpdate('salary', row.id, status, row.user_id);
    setSalaryClaims((prev) =>
      prev.map((it) =>
        it.id === row.id
          ? {
              ...it,
              status,
              review_note: note,
              reviewed_at: reviewedAt,
              reviewed_by: actorId,
            }
          : it
      )
    );
    setClaimActionBusyKey(null);
    toast.success('อัปเดตสถานะแล้ว', `คำขอเบิกเงินเดือนถูกอัปเดตเป็น ${status}`);
  }

  async function updateExpenseClaimStatus(
    row: ExpenseClaimRow,
    status: 'approved' | 'rejected' | 'paid'
  ) {
    const busyKey = `expense-${row.id}-${status}`;
    setClaimActionBusyKey(busyKey);
    const note = expenseReviewNotes[row.id]?.trim() || null;
    const actorId = session?.user?.id ?? null;
    const reviewedAt = new Date().toISOString();
    const { error } = await supabase
      .from('expense_claims')
      .update({
        status,
        review_note: note,
        reviewed_at: reviewedAt,
        reviewed_by: actorId,
      })
      .eq('id', row.id);
    if (error) {
      setClaimActionBusyKey(null);
      toast.error('อัปเดตสถานะไม่สำเร็จ', error.message);
      return;
    }
    await notifyClaimStatusUpdate('expense', row.id, status, row.user_id);
    setExpenseClaims((prev) =>
      prev.map((it) =>
        it.id === row.id
          ? {
              ...it,
              status,
              review_note: note,
              reviewed_at: reviewedAt,
              reviewed_by: actorId,
            }
          : it
      )
    );
    setClaimActionBusyKey(null);
    toast.success('อัปเดตสถานะแล้ว', `คำขอเบิกค่าใช้จ่ายถูกอัปเดตเป็น ${status}`);
  }

  async function exportSalaryClaimCsv() {
    const salaryHeader = [
      'kind',
      'claim_id',
      'created_at',
      'status',
      'full_name',
      'bank_name',
      'account_number',
      'branch_name',
      'amount',
      'review_note',
    ];
    const lines = [
      salaryHeader.map(csvEscape).join(','),
      ...filteredSalaryClaims.map((row) =>
        [
          'salary',
          row.id,
          row.created_at,
          row.status,
          row.full_name ?? '',
          row.bank_name ?? '',
          row.account_number ?? '',
          row.branch_name ?? '',
          String(row.requested_amount ?? ''),
          row.review_note ?? '',
        ]
          .map((v) => csvEscape(String(v)))
          .join(',')
      ),
    ];
    const content = lines.join('\n');
    const filename = `salary-claims-${new Date().toISOString().slice(0, 10)}.csv`;
    try {
      if (Platform.OS === 'web') {
        const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', filename);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      } else {
        const uri = `${FileSystem.cacheDirectory}${filename}`;
        await FileSystem.writeAsStringAsync(uri, content, {
          encoding: FileSystem.EncodingType.UTF8,
        });
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(uri, { mimeType: 'text/csv' });
        }
      }
      toast.success('ส่งออกแล้ว', `ไฟล์ ${filename} พร้อมใช้งาน`);
    } catch (e) {
      toast.error('ส่งออก CSV ไม่สำเร็จ', e instanceof Error ? e.message : String(e));
    }
  }

  async function exportExpenseClaimCsv() {
    const expenseHeader = [
      'kind',
      'claim_id',
      'item_id',
      'created_at',
      'status',
      'full_name',
      'bank_name',
      'account_number',
      'branch_name',
      'item_title',
      'item_amount',
      'item_note',
      'evidence_name',
      'evidence_url',
      'review_note',
    ];
    const lines = [
      expenseHeader.map(csvEscape).join(','),
      ...filteredExpenseClaims.flatMap((claim) => {
        const items = expenseClaimItems.filter((it) => it.expense_claim_id === claim.id);
        return items.map((item) =>
          [
            'expense',
            claim.id,
            item.id,
            claim.created_at,
            claim.status,
            claim.full_name ?? '',
            claim.bank_name ?? '',
            claim.account_number ?? '',
            claim.branch_name ?? '',
            item.item_title,
            String(item.amount ?? ''),
            item.note ?? '',
            item.evidence_name ?? '',
            item.evidence_url ?? '',
            claim.review_note ?? '',
          ]
            .map((v) => csvEscape(String(v)))
            .join(',')
        );
      }),
    ];
    const content = lines.join('\n');
    const filename = `expense-claims-${new Date().toISOString().slice(0, 10)}.csv`;
    try {
      if (Platform.OS === 'web') {
        const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', filename);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      } else {
        const uri = `${FileSystem.cacheDirectory}${filename}`;
        await FileSystem.writeAsStringAsync(uri, content, {
          encoding: FileSystem.EncodingType.UTF8,
        });
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(uri, { mimeType: 'text/csv' });
        }
      }
      toast.success('ส่งออกแล้ว', `ไฟล์ ${filename} พร้อมใช้งาน`);
    } catch (e) {
      toast.error('ส่งออก CSV ไม่สำเร็จ', e instanceof Error ? e.message : String(e));
    }
  }

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

  async function addBranch() {
    const idNum = parseInt(bId.trim(), 10);
    const lat = parseFloat(bLat);
    const lon = parseFloat(bLon);
    const rad = parseInt(bRad, 10);
    if (Number.isNaN(idNum) || !bName.trim()) {
      toast.info('ข้อมูลสาขา', 'กรุณากรอกรหัสสาขา (ตัวเลข) และชื่อสาขา');
      return;
    }
    if (Number.isNaN(lat) || Number.isNaN(lon) || Number.isNaN(rad)) {
      toast.info('ข้อมูลสาขา', 'ละติจูด ลองจิจูด และรัศมีต้องเป็นตัวเลข');
      return;
    }
    const digits = bPhone.replace(/\D/g, '');
    const phoneNum = digits ? parseInt(digits, 10) : null;
    const { error } = await supabase.from('branch_information').insert({
      id: idNum,
      branch_code: bCode.trim() || null,
      branch_name: bName.trim(),
      address: bAddr.trim() || null,
      latitude: lat,
      longitude: lon,
      phone_number: phoneNum != null && !Number.isNaN(phoneNum) ? phoneNum : null,
      radius_meters: rad,
    });
    if (error) {
      toast.error('เพิ่มสาขาไม่สำเร็จ', error.message);
      return;
    }
    setBId('');
    setBCode('');
    setBName('');
    setBAddr('');
    setBPhone('');
    setBLat('');
    setBLon('');
    setBRad('150');
    await load();
    toast.success('เพิ่มสาขาแล้ว', 'ข้อมูลสาขาใหม่ถูกบันทึกแล้ว 🌿');
  }

  async function deleteBranch(id: number) {
    const { error } = await supabase.from('branch_information').delete().eq('id', id);
    if (error) {
      toast.error('ลบไม่สำเร็จ', error.message);
      return;
    }
    await load();
    toast.success('ลบสาขาแล้ว', 'รายการสาขาถูกอัปเดตแล้ว');
  }

  async function autoLinkProfilesToEmployees() {
    const byLegacyEmail = new Map<string, string>();
    const byUserIdProfileId = new Map<string, string>();
    const byEmployeeNo = new Map<string, string>();
    const byDisplayName = new Map<string, string>();
    const putFirst = (map: Map<string, string>, key: string, id: string) => {
      if (!key) return;
      if (!map.has(key)) map.set(key, id);
    };

    for (const row of legacyAuth) {
      putFirst(byLegacyEmail, normalizeTextKey(row.legacy_user_id), row.id);
      const uid = row.legacy_user_id?.trim();
      if (uid && isUuidLike(uid)) {
        putFirst(byUserIdProfileId, uid.toLowerCase(), row.id);
      }
      putFirst(byEmployeeNo, normalizeDigits(row.employee_no), row.id);
      putFirst(byDisplayName, normalizeTextKey(row.display_name), row.id);
    }

    const targets = profiles
      .filter((p) => !normalizeEmployeeId(p.employee_id))
      .map((p) => {
        const byEmail = byLegacyEmail.get(normalizeTextKey(p.email));
        const byPid = byUserIdProfileId.get(p.id.toLowerCase());
        const byEmpNo = byEmployeeNo.get(normalizeDigits(p.employee_code));
        const byName = byDisplayName.get(normalizeTextKey(p.full_name));
        const employeeId = byEmail ?? byPid ?? byEmpNo ?? byName ?? null;
        const via = byEmail
          ? 'email'
          : byPid
            ? 'userid_uuid'
            : byEmpNo
              ? 'employee_code'
              : byName
                ? 'full_name'
                : null;
        return {
          profileId: p.id,
          employeeId,
          via,
        };
      })
      .filter(
        (
          x
        ): x is {
          profileId: string;
          employeeId: string;
          via: 'email' | 'userid_uuid' | 'employee_code' | 'full_name';
        } => !!x.employeeId && !!x.via
      );

    if (targets.length === 0) {
      toast.info(
        'ไม่มีรายการให้เชื่อม',
        'ไม่พบคู่ที่แมตช์แบบอัตโนมัติ (email/UserID, UserID=uuid, employee_code หรือชื่อเต็ม)'
      );
      return;
    }
    try {
      let ok = 0;
      let failed = 0;
      for (const t of targets) {
        const { error } = await supabase
          .from('profiles')
          .update({ employee_id: t.employeeId })
          .eq('id', t.profileId);
        if (error) failed += 1;
        else ok += 1;
      }
      await load();
      if (failed > 0) {
        toast.info(
          'เชื่อมบางส่วนสำเร็จ',
          `เชื่อมได้ ${ok} รายการ และไม่สำเร็จ ${failed} รายการ — ลองเชื่อมรายบุคคลที่เหลือ`
        );
      } else {
        const viaEmail = targets.filter((t) => t.via === 'email').length;
        const viaUuid = targets.filter((t) => t.via === 'userid_uuid').length;
        const viaCode = targets.filter((t) => t.via === 'employee_code').length;
        const viaName = targets.filter((t) => t.via === 'full_name').length;
        toast.success(
          'เชื่อมข้อมูลพนักงานแล้ว',
          `สำเร็จ ${ok} รายการ (email ${viaEmail}, uuid ${viaUuid}, รหัส ${viaCode}, ชื่อ ${viaName})`
        );
      }
    } catch (e) {
      toast.error('เชื่อมอัตโนมัติไม่สำเร็จ', e instanceof Error ? e.message : String(e));
    }
  }

  /** แถวที่ UserID ตรงอีเมลบัญชี ขึ้นก่อน ช่วยเลือกถูกคน */
  const mergedEmployeeRows = useMemo(
    () => mergeEmployeeWithProfiles(legacyAuth, profiles),
    [legacyAuth, profiles]
  );
  const filteredEmployeeRows = useMemo(() => {
    const q = employeeSearch.trim().toLowerCase();
    if (!q) return mergedEmployeeRows;
    return mergedEmployeeRows.filter(({ employee, profile: linkedProfile }) => {
      const hay = [
        employee.display_name ?? '',
        employee.legacy_user_id ?? '',
        String(employee.employee_no ?? ''),
        employee.branch ?? '',
        linkedProfile?.full_name ?? '',
        linkedProfile?.email ?? '',
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [mergedEmployeeRows, employeeSearch]);

  const employeeHeadcount = useMemo(() => {
    const total = mergedEmployeeRows.length;
    if (total === 0) {
      return { total: 0, active: 0, resigned: 0, activePct: 0, resignedPct: 0 };
    }
    let resigned = 0;
    for (const { employee } of mergedEmployeeRows) {
      if (isResignedEmploymentStatus(employee.employment_status)) resigned += 1;
    }
    const active = total - resigned;
    return {
      total,
      active,
      resigned,
      activePct: Math.round((active * 1000) / total) / 10,
      resignedPct: Math.round((resigned * 1000) / total) / 10,
    };
  }, [mergedEmployeeRows]);

  const deleteEmployeeRecord = useCallback(
    async (row: AdminEmployeePasswordRow) => {
      setEmployeeActionBusyId(row.id);
      try {
        const { error } = await supabase.from('employee').delete().eq('id', row.id);
        if (error) throw error;
        await load();
        toast.success(
          'ลบพนักงานแล้ว',
          'แถว employee ถูกลบ — บัญชีล็อกอิน (ถ้ามี) ยังอยู่ และ employee_id ใน profiles จะถูกปลดตาม FK'
        );
      } catch (e) {
        toast.error('ลบไม่สำเร็จ', e instanceof Error ? e.message : String(e));
      } finally {
        setEmployeeActionBusyId(null);
      }
    },
    [load, toast]
  );

  const resignEmployeeRecord = useCallback(
    async (row: AdminEmployeePasswordRow) => {
      setEmployeeActionBusyId(row.id);
      try {
        const { error } = await supabase.rpc('admin_record_employee_resignation', {
          p_employee_id: row.id,
          p_note: null,
        });
        if (error) throw error;
        await load();
        toast.success(
          'บันทึกลาออกแล้ว',
          'บันทึกในตารางประวัติและตั้งสถานะ HR เป็นลาออก'
        );
      } catch (e) {
        toast.error('บันทึกลาออกไม่สำเร็จ', e instanceof Error ? e.message : String(e));
      } finally {
        setEmployeeActionBusyId(null);
      }
    },
    [load, toast]
  );

  function confirmDeleteEmployee(row: AdminEmployeePasswordRow) {
    const title = 'ลบข้อมูลพนักงาน?';
    const msg =
      'จะลบแถวใน employee ถาวร — ข้อมูลที่อ้างอิง employee จะถูกปลดตามกฎ FK (เช่น profiles.employee_id) บัญชี Auth ไม่ถูกลบ';
    if (Platform.OS === 'web') {
      if (
        typeof globalThis !== 'undefined' &&
        typeof (globalThis as unknown as { confirm?: (m: string) => boolean }).confirm ===
          'function'
      ) {
        const ok = (globalThis as unknown as Window).confirm(`${title}\n\n${msg}`);
        if (ok) void deleteEmployeeRecord(row);
      }
    } else {
      Alert.alert(title, msg, [
        { text: 'ยกเลิก', style: 'cancel' },
        { text: 'ลบ', style: 'destructive', onPress: () => void deleteEmployeeRecord(row) },
      ]);
    }
  }

  function confirmResignEmployee(row: AdminEmployeePasswordRow) {
    const title = 'บันทึกการลาออก?';
    const msg = 'จะบันทึกประวัติใน employee_resignations และตั้ง employee.status เป็นลาออก';
    if (Platform.OS === 'web') {
      if (
        typeof globalThis !== 'undefined' &&
        typeof (globalThis as unknown as { confirm?: (m: string) => boolean }).confirm ===
          'function'
      ) {
        const ok = (globalThis as unknown as Window).confirm(`${title}\n\n${msg}`);
        if (ok) void resignEmployeeRecord(row);
      }
    } else {
      Alert.alert(title, msg, [
        { text: 'ยกเลิก', style: 'cancel' },
        { text: 'ยืนยัน', onPress: () => void resignEmployeeRecord(row) },
      ]);
    }
  }

  const announcementPreviewUri = useMemo(() => {
    const first = announcementItems[0];
    if (!first) return null;
    return first.kind === 'saved' ? first.url : first.localUri;
  }, [announcementItems]);

  const inClaimDateRange = useCallback(
    (iso: string) => {
      const day = iso.slice(0, 10);
      if (claimDateFrom && day < claimDateFrom) return false;
      if (claimDateTo && day > claimDateTo) return false;
      return true;
    },
    [claimDateFrom, claimDateTo]
  );

  const attendancePeriod = useMemo(
    () => attendancePeriodFromMonthKey(claimMonthFilter),
    [claimMonthFilter]
  );
  const pickerDateValue = useMemo(() => {
    if (datePickerTarget === 'from') {
      return parseYmdToDate(claimDateFrom) ?? parseYmdToDate(attendancePeriod.from) ?? new Date();
    }
    if (datePickerTarget === 'to') {
      return parseYmdToDate(claimDateTo) ?? parseYmdToDate(attendancePeriod.to) ?? new Date();
    }
    return new Date();
  }, [datePickerTarget, claimDateFrom, claimDateTo, attendancePeriod.from, attendancePeriod.to]);

  const inAttendancePeriod = useCallback(
    (iso: string) => {
      const day = iso.slice(0, 10);
      return day >= attendancePeriod.from && day <= attendancePeriod.to;
    },
    [attendancePeriod]
  );

  const filteredSalaryClaims = useMemo(
    () =>
      salaryClaims.filter((row) => {
        if (claimStatusFilter !== 'all' && row.status !== claimStatusFilter) return false;
        if (!inAttendancePeriod(row.created_at)) return false;
        return inClaimDateRange(row.created_at);
      }),
    [salaryClaims, claimStatusFilter, inAttendancePeriod, inClaimDateRange]
  );

  const filteredExpenseClaims = useMemo(
    () =>
      expenseClaims.filter((row) => {
        if (claimStatusFilter !== 'all' && row.status !== claimStatusFilter) return false;
        if (!inAttendancePeriod(row.created_at)) return false;
        return inClaimDateRange(row.created_at);
      }),
    [expenseClaims, claimStatusFilter, inAttendancePeriod, inClaimDateRange]
  );

  function onPickFilterDate(event: DateTimePickerEvent, selectedDate?: Date) {
    if (Platform.OS !== 'ios') {
      setDatePickerTarget(null);
    }
    if (event.type === 'dismissed' || !selectedDate || !datePickerTarget) {
      return;
    }
    const ymd = ymdOf(selectedDate);
    if (datePickerTarget === 'from') setClaimDateFrom(ymd);
    else setClaimDateTo(ymd);
  }

  function openEditBranch(b: Branch) {
    setEditBranch(b);
    setEbCode(b.branch_code ?? '');
    setEbName(b.branch_name ?? '');
    setEbAddr(b.address ?? '');
    const pn = b.phone_number;
    setEbPhone(pn != null ? String(pn) : '');
    setEbLat(b.latitude != null ? String(b.latitude) : '');
    setEbLon(b.longitude != null ? String(b.longitude) : '');
    setEbRad(String(b.radius_meters ?? 150));
  }

  async function saveBranchEdit() {
    if (!editBranch) return;
    const lat = parseFloat(ebLat);
    const lon = parseFloat(ebLon);
    const rad = parseInt(ebRad, 10);
    if (!ebName.trim()) {
      toast.info('สาขา', 'กรุณากรอกชื่อสาขา');
      return;
    }
    if (Number.isNaN(lat) || Number.isNaN(lon) || Number.isNaN(rad)) {
      toast.info('สาขา', 'ละติจูด ลองจิจูด และรัศมีต้องเป็นตัวเลข');
      return;
    }
    const digits = ebPhone.replace(/\D/g, '');
    const phoneNum = digits ? parseInt(digits, 10) : null;
    const { error } = await supabase
      .from('branch_information')
      .update({
        branch_code: ebCode.trim() || null,
        branch_name: ebName.trim(),
        address: ebAddr.trim() || null,
        latitude: lat,
        longitude: lon,
        phone_number:
          phoneNum != null && !Number.isNaN(phoneNum) ? phoneNum : null,
        radius_meters: rad,
      })
      .eq('id', editBranch.id);
    if (error) {
      toast.error('บันทึกสาขาไม่สำเร็จ', error.message);
      return;
    }
    setEditBranch(null);
    await load();
    toast.success('อัปเดตสาขาแล้ว', 'ข้อมูลสาขาถูกบันทึกเรียบร้อย 🌿');
  }

  async function saveSetting() {
    if (!setKey.trim()) return;
    const { error } = await supabase.from('app_settings').upsert({
      key: setKey.trim(),
      value: { text: setVal },
    });
    if (error) {
      toast.error('บันทึกการตั้งค่าไม่สำเร็จ', error.message);
      return;
    }
    toast.success('บันทึกการตั้งค่าแล้ว', 'ค่าระบบอัปเดตแล้วนะ ✨');
    await load();
  }

  async function uploadAndSaveAnnouncementSlides() {
    setAnnouncementUploading(true);
    try {
      const urls: string[] = [];
      for (const item of announcementItems) {
        if (item.kind === 'saved') {
          urls.push(item.url);
        } else {
          const url = await uploadAnnouncementSlideFromUri(
            item.localUri,
            null
          );
          urls.push(url);
        }
      }
      const value = buildAnnouncementSettingsValue(
        urls,
        announcementSlideHeightPx
      );
      const { error } = await supabase.from('app_settings').upsert({
        key: ANNOUNCEMENT_SETTINGS_KEY,
        value,
      });
      if (error) throw new Error(error.message);
      setAnnouncementItems(
        urls.map((url, i) => ({
          key: newDraftKey(`s${i}`),
          kind: 'saved' as const,
          url,
        }))
      );
      toast.success(
        'บันทึกภาพประกาศแล้ว',
        'สไลด์จะแสดงที่หน้าเข้า-ออกงาน 🌱'
      );
      await load();
    } catch (e) {
      toast.error(
        'บันทึกภาพประกาศไม่สำเร็จ',
        e instanceof Error ? e.message : String(e)
      );
    } finally {
      setAnnouncementUploading(false);
    }
  }

  async function pickAnnouncementImages() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      toast.info(
        'สิทธิ์รูปภาพ',
        'กรุณาอนุญาตให้แอปเข้าถึงรูปเพื่อเพิ่มสไลด์ประกาศ'
      );
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      quality: 0.85,
    });
    if (result.canceled) return;
    const assets = result.assets ?? [];
    if (assets.length === 0) return;
    setAnnouncementItems((prev) => {
      const next = [...prev];
      for (const asset of assets) {
        if (asset.uri) {
          next.push({
            key: newDraftKey('p'),
            kind: 'pending',
            localUri: asset.uri,
          });
        }
      }
      return next;
    });
  }

  function addAnnouncementUrlFromDraft() {
    const u = announcementUrlDraft.trim();
    if (!u) return;
    if (!/^https?:\/\//i.test(u)) {
      toast.info('URL', 'ต้องขึ้นต้นด้วย http:// หรือ https://');
      return;
    }
    setAnnouncementItems((p) => [
      ...p,
      { key: newDraftKey('u'), kind: 'saved', url: u },
    ]);
    setAnnouncementUrlDraft('');
  }

  async function saveBreakMessages() {
    const startMessages = breakStartLines
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const endMessages = breakEndLines
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const { error } = await supabase.from('app_settings').upsert([
      { key: BREAK_START_KEY, value: { messages: startMessages } },
      { key: BREAK_END_KEY, value: { messages: endMessages } },
    ]);
    if (error) {
      toast.error('บันทึกข้อความพักเบรกไม่สำเร็จ', error.message);
      return;
    }
    toast.success('บันทึกข้อความพักเบรกแล้ว', 'พักผ่อนอย่างมีสไตล์นะ 🍃');
    await load();
  }

  async function saveKpiSettings() {
    setKpiSettingsSaving(true);
    try {
      const parsed = JSON.parse(kpiSettingsText) as unknown;
      const normalized = parseAttendanceKpiSettings(parsed);
      const { error } = await supabase.from('app_settings').upsert({
        key: ATTENDANCE_KPI_SETTINGS_KEY,
        value: normalized,
      });
      if (error) throw new Error(error.message);
      setKpiSettingsText(JSON.stringify(normalized, null, 2));
      toast.success('บันทึก KPI แล้ว', 'เกณฑ์ KPI ลา/เข้าสายถูกอัปเดตแล้ว');
      await load();
    } catch (e) {
      toast.error(
        'บันทึก KPI ไม่สำเร็จ',
        e instanceof Error ? e.message : String(e)
      );
    } finally {
      setKpiSettingsSaving(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={NatureTheme.colors.primary} />
      </View>
    );
  }

  return (
    <>
      <ScrollView
        ref={adminScrollRef}
        style={styles.screen}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled">
        <View style={styles.adminEmpDashboard}>
          <Text style={styles.adminEmpDashboardTitle}>สรุปพนักงาน (ตาราง employee)</Text>
          <Text style={styles.muted}>
            นับจากจำนวนแถวทั้งหมดเป็น 100% — แยกตามค่า status ที่ถือว่าเป็นการลาออก
          </Text>
          {employeeHeadcount.total === 0 ? (
            <Text style={[styles.muted, { marginTop: 8 }]}>ยังไม่มีแถวพนักงานในระบบ</Text>
          ) : (
            <>
              <Text style={styles.adminEmpDashboardStat}>
                ทั้งหมด {employeeHeadcount.total} คน · ทำงานอยู่{' '}
                <Text style={styles.adminEmpStatEm}>{employeeHeadcount.active}</Text> คน (
                {employeeHeadcount.activePct}%) · ลาออก{' '}
                <Text style={styles.adminEmpStatEm}>{employeeHeadcount.resigned}</Text> คน (
                {employeeHeadcount.resignedPct}%)
              </Text>
              <View style={styles.adminEmpBarTrack}>
                <View
                  style={[
                    styles.adminEmpBarSegActive,
                    { flex: Math.max(employeeHeadcount.active, 0.001) },
                  ]}
                />
                <View
                  style={[
                    styles.adminEmpBarSegResigned,
                    { flex: Math.max(employeeHeadcount.resigned, 0.001) },
                  ]}
                />
              </View>
            </>
          )}
        </View>

        <Text style={styles.h2}>1 · รูปประกาศหน้าเข้า-ออกงาน</Text>
        <Text style={styles.muted}>
          เลือกรูปหรือ URL ก่อน — รายการที่ยังไม่อัปโหลดจะมีป้าย «รออัปโหลด» — กดปุ่มสีหลักเพื่ออัปโหลดและบันทึกทั้งหมด
        </Text>
        <Text style={styles.label}>ความสูงแสดงผลที่หน้าเข้า-ออก (~{announcementSlideHeightPx}px)</Text>
        <View style={styles.annHeightRow}>
          <Pressable
            style={styles.annHeightBtn}
            onPress={() =>
              setAnnouncementSlideHeightPx((h) => Math.max(100, h - 20))
            }>
            <Text style={styles.annHeightBtnText}>−</Text>
          </Pressable>
          <Text style={styles.annHeightVal}>{announcementSlideHeightPx}px</Text>
          <Pressable
            style={styles.annHeightBtn}
            onPress={() =>
              setAnnouncementSlideHeightPx((h) => Math.min(320, h + 20))
            }>
            <Text style={styles.annHeightBtnText}>+</Text>
          </Pressable>
        </View>
        <Text style={styles.label}>ตัวอย่าง (สไลด์แรก)</Text>
        <View
          style={[
            styles.annPreviewBox,
            { height: Math.min(220, Math.max(100, announcementSlideHeightPx)) },
          ]}>
          {announcementPreviewUri ? (
            <ZoomableImage
              source={{ uri: announcementPreviewUri }}
              style={styles.annPreviewImg}
              resizeMode="cover"
              accessibilityLabel="ตัวอย่างประกาศ"
            />
          ) : (
            <Text style={styles.muted}>ยังไม่มีรูปในคิว</Text>
          )}
        </View>
        <Pressable
          style={[styles.btnSecondary, announcementUploading && styles.disabledSoft]}
          onPress={pickAnnouncementImages}
          disabled={announcementUploading}>
          <Text style={styles.btnSecondaryText}>+ เลือกรูปจากเครื่อง (ยังไม่อัปโหลด)</Text>
        </Pressable>
        {announcementItems.length === 0 ? (
          <Text style={styles.muted}>ยังไม่มีสไลด์</Text>
        ) : (
          <View style={styles.annThumbGrid}>
            {announcementItems.map((item, i) => {
              const uri = item.kind === 'saved' ? item.url : item.localUri;
              return (
                <View key={item.key} style={styles.annThumbCard}>
                  <ZoomableImage
                    source={{ uri }}
                    style={[
                      styles.annThumb,
                      {
                        height: Math.min(
                          120,
                          Math.max(56, Math.round(announcementSlideHeightPx * 0.45))
                        ),
                      },
                    ]}
                    resizeMode="cover"
                    accessibilityLabel={`สไลด์ ${i + 1}`}
                  />
                  {item.kind === 'pending' ? (
                    <Text style={styles.annPendingTag}>รออัปโหลด</Text>
                  ) : null}
                  <Pressable
                    style={styles.annThumbRemove}
                    onPress={() =>
                      setAnnouncementItems((p) => p.filter((_, j) => j !== i))
                    }>
                    <Text style={styles.annThumbRemoveText}>ลบ</Text>
                  </Pressable>
                </View>
              );
            })}
          </View>
        )}
        <Text style={[styles.label, { marginTop: 12 }]}>หรือเพิ่มด้วย URL</Text>
        <View style={styles.annUrlRow}>
          <TextInput
            style={[styles.input, styles.annUrlInput]}
            placeholder="https://..."
            value={announcementUrlDraft}
            onChangeText={setAnnouncementUrlDraft}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Pressable
            style={styles.btnSecondary}
            onPress={addAnnouncementUrlFromDraft}>
            <Text style={styles.btnSecondaryText}>เพิ่ม URL</Text>
          </Pressable>
        </View>
        <Pressable
          style={[styles.btn, announcementUploading && styles.disabledSoft]}
          onPress={() => void uploadAndSaveAnnouncementSlides()}
          disabled={announcementUploading}>
          {announcementUploading ? (
            <ActivityIndicator color={NatureTheme.colors.onAccent} />
          ) : (
            <Text style={styles.btnText}>อัปโหลดและบันทึกสไลด์</Text>
          )}
        </Pressable>

        <Text style={[styles.h2, { marginTop: 28 }]}>2 · พนักงาน (employee + profiles)</Text>
        <Text style={styles.warn}>
          รายชื่อจาก RPC admin_list_employee_passwords — เชื่อมกับ profiles ตาม employee_id,
          UserID = uuid บัญชี หรือ UserID = อีเมล
        </Text>
        <Text style={styles.muted}>
          บทบาทผู้ใช้ เชื่อมบัญชีแอปกับแถว employee และโควตาวันลา (vacation_grants) จัดการได้จากปุ่ม
          «แก้ไข» ในแต่ละการ์ด — อีเมล = UserID, รหัสพนักงาน, ชื่อเต็ม หรือ UserID = uuid บัญชี
        </Text>
        <Pressable
          style={styles.btnSecondary}
          onPress={() => void autoLinkProfilesToEmployees()}>
          <Text style={styles.btnSecondaryText}>
            เชื่อมทั้งหมดอัตโนมัติ (email / uuid / รหัส / ชื่อ)
          </Text>
        </Pressable>
        <Pressable
          style={styles.btnSecondary}
          onPress={() => {
            setEditEmployeeId(ADMIN_NEW_EMPLOYEE_ID);
            setEditPreview(null);
          }}>
          <Text style={styles.btnSecondaryText}>
            + เพิ่มพนักงานใหม่ (สร้าง Auth + employee + เชื่อม UID)
          </Text>
        </Pressable>
        <TextInput
          style={styles.input}
          placeholder="ค้นหาพนักงาน (ชื่อ / อีเมล / รหัส / สาขา)"
          value={employeeSearch}
          onChangeText={setEmployeeSearch}
        />
        <Text style={styles.muted}>
          พบ {filteredEmployeeRows.length} จาก {mergedEmployeeRows.length} รายการ
        </Text>
        {legacyAuthError ? (
          <Text style={styles.legacyRpcError}>
            โหลดรายการพนักงานไม่สำเร็จ: {legacyAuthError}
          </Text>
        ) : null}
        {legacyAuth.length === 0 && !legacyAuthError ? (
          <Text style={styles.muted}>
            ยังไม่มีแถวจาก RPC — ตรวจสอบว่ารัน migration ฟังก์ชัน
            admin_list_employee_passwords ใน Supabase แล้ว และบัญชีนี้เป็น admin
          </Text>
        ) : legacyAuth.length > 0 ? (
          <View style={styles.employeeListFrame}>
            <ScrollView
              style={styles.employeeListScroll}
              nestedScrollEnabled
              showsVerticalScrollIndicator>
              {filteredEmployeeRows.length === 0 ? (
                <Text style={styles.muted}>ไม่พบพนักงานที่ตรงคำค้น</Text>
              ) : (
                filteredEmployeeRows.map(({ employee: row, profile: lp, linkKind }) => (
                  <View key={row.id} style={styles.pwCard}>
                    <View style={styles.linkBadgeRow}>
                      <Text
                        style={[
                          styles.linkBadge,
                          lp ? styles.linkBadgeOn : styles.linkBadgeOff,
                        ]}>
                        {lp
                          ? `เชื่อมแล้ว (${linkKind ?? '?'})`
                          : 'ยังไม่เชื่อมบัญชี'}
                      </Text>
                    </View>
                    <Text style={styles.pwLine}>
                      <Text style={styles.pwKey}>UUID พนักงาน: </Text>
                      <Text style={styles.monoSm}>{row.id.slice(0, 13)}…</Text>
                    </Text>
                    <Text style={styles.pwLine}>
                      <Text style={styles.pwKey}>UserID: </Text>
                      {row.legacy_user_id ?? '—'}
                    </Text>
                    <Text style={styles.pwLine}>
                      <Text style={styles.pwKey}>รหัส legacy: </Text>
                      <Text style={styles.pwSecret}>{row.legacy_password ?? '—'}</Text>
                    </Text>
                    <Text style={styles.pwSub}>
                      #{row.employee_no ?? '—'} · {row.display_name ?? '—'} · {row.branch ?? '—'}
                    </Text>
                    <Text style={styles.pwSub}>
                      สถานะ HR: {row.employment_status?.trim() ? row.employment_status : '—'}
                    </Text>
                    {lp ? (
                      <Text style={styles.pwSub}>
                        บัญชี: {lp.full_name || lp.email || lp.id.slice(0, 8)} · {lp.email ?? '—'} ·
                        โทร {lp.phone ?? '—'}
                      </Text>
                    ) : null}
                    <View style={styles.empCardActions} collapsable={false}>
                      <TouchableOpacity
                        activeOpacity={0.85}
                        hitSlop={{ top: 10, bottom: 10, left: 4, right: 8 }}
                        style={[
                          styles.editBtn,
                          Platform.OS === 'web' && styles.pressableWeb,
                          employeeActionBusyId !== null && styles.empActionBtnDisabled,
                        ]}
                        disabled={employeeActionBusyId !== null}
                        onPress={() => {
                          setEditEmployeeId(row.id);
                          setEditPreview(row);
                        }}>
                        <Text style={styles.editBtnText}>แก้ไข</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        activeOpacity={0.85}
                        hitSlop={{ top: 10, bottom: 10, left: 4, right: 8 }}
                        style={[
                          styles.empBtnResign,
                          Platform.OS === 'web' && styles.pressableWeb,
                          (employeeActionBusyId !== null ||
                            isResignedEmploymentStatus(row.employment_status)) &&
                            styles.empActionBtnDisabled,
                        ]}
                        disabled={
                          employeeActionBusyId !== null ||
                          isResignedEmploymentStatus(row.employment_status)
                        }
                        onPress={() => confirmResignEmployee(row)}>
                        <Text style={styles.empBtnResignText}>ลาออก</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        activeOpacity={0.85}
                        hitSlop={{ top: 10, bottom: 10, left: 4, right: 8 }}
                        style={[
                          styles.empBtnDelete,
                          Platform.OS === 'web' && styles.pressableWeb,
                          employeeActionBusyId !== null && styles.empActionBtnDisabled,
                        ]}
                        disabled={employeeActionBusyId !== null}
                        onPress={() => confirmDeleteEmployee(row)}>
                        <Text style={styles.empBtnDeleteText}>ลบ</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))
              )}
            </ScrollView>
          </View>
        ) : null}

        <Text style={[styles.h2, { marginTop: 24 }]}>3 · ผู้จัดการ (สิทธิ์ & ลูกทีม)</Text>
        <Text style={styles.muted}>
          กำหนดว่าใครอนุมัติลา / จัดตารางกะให้ลูกทีมได้ — เฉพาะพนักงานที่เลือกและเชื่อม employee
          จึงจะเห็นในหน้า «ทีม» ของผู้จัดการ
        </Text>
        {profiles.filter((p) => p.role === 'manager').length === 0 ? (
          <Text style={styles.muted}>ยังไม่มีบัญชีที่บทบาทเป็น manager</Text>
        ) : (
          profiles
            .filter((p) => p.role === 'manager')
            .map((m) => (
              <View key={m.id} style={styles.pwCard}>
                <Text style={styles.rowTitle}>{m.full_name || m.email || m.id.slice(0, 8)}</Text>
                <Text style={styles.rowSub}>{m.email ?? '—'}</Text>
                <TouchableOpacity
                  activeOpacity={0.85}
                  style={[styles.editBtn, Platform.OS === 'web' && styles.pressableWeb]}
                  onPress={() => setManagerModalProfile(m)}>
                  <Text style={styles.editBtnText}>สิทธิ์ & ลูกทีม</Text>
                </TouchableOpacity>
              </View>
            ))
        )}

        <Text style={[styles.h2, { marginTop: 24 }]}>4 · คำขอเบิกเงินเดือน (Claim Salary)</Text>
        <Text style={styles.muted}>
          รายการส่งจากหน้าโปรไฟล์ช่วงวันที่ 10-14 ของเดือน
        </Text>
        <View style={styles.claimFilterWrap}>
          <Text style={styles.label}>ตัวกรองสถานะ</Text>
          <View style={styles.claimFilterStatusRow}>
            {(['all', 'pending', 'approved', 'rejected', 'paid'] as const).map((status) => (
              <Pressable
                key={status}
                style={[
                  styles.claimFilterChip,
                  claimStatusFilter === status && styles.claimFilterChipActive,
                ]}
                onPress={() => setClaimStatusFilter(status)}>
                <Text
                  style={[
                    styles.claimFilterChipText,
                    claimStatusFilter === status && styles.claimFilterChipTextActive,
                  ]}>
                  {status === 'all' ? 'ทั้งหมด' : status}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.label}>ช่วงวันที่สร้างคำขอ (YYYY-MM-DD)</Text>
          <TextInput
            style={styles.input}
            placeholder="เดือนรอบสรุปเวลาเข้า-ออก (YYYY-MM)"
            value={claimMonthFilter}
            onChangeText={setClaimMonthFilter}
          />
          <Text style={styles.muted}>
            รอบเดือนที่ใช้: {attendancePeriod.from} ถึง {attendancePeriod.to}
          </Text>
          <View style={styles.claimDateRow}>
            <Pressable
              style={[styles.input, styles.claimDateInput]}
              onPress={() => setDatePickerTarget('from')}>
              <Text style={claimDateFrom ? styles.claimDateValue : styles.claimDatePlaceholder}>
                {claimDateFrom || 'จากวันที่'}
              </Text>
            </Pressable>
            <Pressable
              style={[styles.input, styles.claimDateInput]}
              onPress={() => setDatePickerTarget('to')}>
              <Text style={claimDateTo ? styles.claimDateValue : styles.claimDatePlaceholder}>
                {claimDateTo || 'ถึงวันที่'}
              </Text>
            </Pressable>
          </View>
          {claimDateFrom || claimDateTo ? (
            <Pressable
              style={styles.claimDateClearBtn}
              onPress={() => {
                setClaimDateFrom('');
                setClaimDateTo('');
              }}>
              <Text style={styles.claimDateClearBtnText}>ล้างช่วงวันที่เลือกเอง</Text>
            </Pressable>
          ) : null}
          <Text style={styles.muted}>
            ผลลัพธ์: เงินเดือน {filteredSalaryClaims.length} รายการ · ค่าใช้จ่าย{' '}
            {filteredExpenseClaims.length} รายการ
          </Text>
        </View>
        {datePickerTarget ? (
          <DateTimePicker
            value={pickerDateValue}
            mode="date"
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            onChange={onPickFilterDate}
          />
        ) : null}
        {filteredSalaryClaims.length === 0 ? (
          <Text style={styles.muted}>ยังไม่มีคำขอเบิกเงินเดือน</Text>
        ) : (
          filteredSalaryClaims.map((row) => (
            <View key={row.id} style={styles.pwCard}>
              <Text style={styles.rowTitle}>
                {row.full_name || row.user_id.slice(0, 8)} · {money(row.requested_amount)} บาท
              </Text>
              <Text style={styles.rowSub}>
                สถานะ: {row.status} · เดือน: {row.claim_month} · ส่งเมื่อ {row.created_at}
              </Text>
              <Text style={styles.rowSub}>
                บัญชี: {row.bank_name ?? '-'} / {row.account_number ?? '-'}
              </Text>
              <Text style={styles.rowSub}>
                สังกัด: {row.branch_name ?? '-'} · ฐานเงินเดือน {money(row.base_salary)} บาท ·
                วงเงินสูงสุด {money(row.max_claim_amount)} บาท
              </Text>
              <TextInput
                style={styles.input}
                placeholder="review_note (สำหรับบันทึกเหตุผลอนุมัติ/ปฏิเสธ)"
                value={salaryReviewNotes[row.id] ?? row.review_note ?? ''}
                onChangeText={(t) =>
                  setSalaryReviewNotes((prev) => ({
                    ...prev,
                    [row.id]: t,
                  }))
                }
                multiline
              />
              <View style={styles.claimActionRow}>
                <Pressable
                  style={[styles.claimBtn, styles.claimBtnApprove, claimActionBusyKey !== null && styles.disabledSoft]}
                  disabled={claimActionBusyKey !== null}
                  onPress={() => void updateSalaryClaimStatus(row, 'approved')}>
                  <Text style={styles.claimBtnText}>อนุมัติ</Text>
                </Pressable>
                <Pressable
                  style={[styles.claimBtn, styles.claimBtnReject, claimActionBusyKey !== null && styles.disabledSoft]}
                  disabled={claimActionBusyKey !== null}
                  onPress={() => void updateSalaryClaimStatus(row, 'rejected')}>
                  <Text style={styles.claimBtnText}>ปฏิเสธ</Text>
                </Pressable>
                <Pressable
                  style={[styles.claimBtn, styles.claimBtnPaid, claimActionBusyKey !== null && styles.disabledSoft]}
                  disabled={claimActionBusyKey !== null}
                  onPress={() => void updateSalaryClaimStatus(row, 'paid')}>
                  <Text style={styles.claimBtnText}>จ่ายแล้ว</Text>
                </Pressable>
              </View>
              {row.note ? <Text style={styles.rowSub}>หมายเหตุ: {row.note}</Text> : null}
            </View>
          ))
        )}
        <Pressable style={styles.btn} onPress={() => void exportSalaryClaimCsv()}>
          <Text style={styles.btnText}>ส่งออก Claim Salary เป็น CSV</Text>
        </Pressable>

        <Text style={[styles.h2, { marginTop: 24 }]}>5 · คำขอเบิกเงิน (Expense Claim)</Text>
        <Text style={styles.muted}>
          แสดงแยกรายการตามหลักฐานการเบิก
        </Text>
        {filteredExpenseClaims.length === 0 ? (
          <Text style={styles.muted}>ยังไม่มีคำขอเบิกค่าใช้จ่าย</Text>
        ) : (
          filteredExpenseClaims.map((claim) => {
            const items = expenseClaimItems.filter((it) => it.expense_claim_id === claim.id);
            return (
              <View key={claim.id} style={styles.pwCard}>
                <Text style={styles.rowTitle}>
                  {claim.full_name || claim.user_id.slice(0, 8)} · รวม {money(claim.total_amount)} บาท
                </Text>
                <Text style={styles.rowSub}>
                  สถานะ: {claim.status} · ส่งเมื่อ {claim.created_at}
                </Text>
                <Text style={styles.rowSub}>
                  บัญชี: {claim.bank_name ?? '-'} / {claim.account_number ?? '-'} · สาขา{' '}
                  {claim.branch_name ?? '-'}
                </Text>
                <TextInput
                  style={styles.input}
                  placeholder="review_note (สำหรับบันทึกเหตุผลอนุมัติ/ปฏิเสธ)"
                  value={expenseReviewNotes[claim.id] ?? claim.review_note ?? ''}
                  onChangeText={(t) =>
                    setExpenseReviewNotes((prev) => ({
                      ...prev,
                      [claim.id]: t,
                    }))
                  }
                  multiline
                />
                <View style={styles.claimActionRow}>
                  <Pressable
                    style={[styles.claimBtn, styles.claimBtnApprove, claimActionBusyKey !== null && styles.disabledSoft]}
                    disabled={claimActionBusyKey !== null}
                    onPress={() => void updateExpenseClaimStatus(claim, 'approved')}>
                    <Text style={styles.claimBtnText}>อนุมัติ</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.claimBtn, styles.claimBtnReject, claimActionBusyKey !== null && styles.disabledSoft]}
                    disabled={claimActionBusyKey !== null}
                    onPress={() => void updateExpenseClaimStatus(claim, 'rejected')}>
                    <Text style={styles.claimBtnText}>ปฏิเสธ</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.claimBtn, styles.claimBtnPaid, claimActionBusyKey !== null && styles.disabledSoft]}
                    disabled={claimActionBusyKey !== null}
                    onPress={() => void updateExpenseClaimStatus(claim, 'paid')}>
                    <Text style={styles.claimBtnText}>จ่ายแล้ว</Text>
                  </Pressable>
                </View>
                {items.length === 0 ? (
                  <Text style={styles.rowSub}>ยังไม่มีรายการย่อย</Text>
                ) : (
                  items.map((item, idx) => (
                    <View key={item.id} style={styles.claimItemRow}>
                      <Text style={styles.rowSub}>
                        {idx + 1}. {item.item_title} · {money(item.amount)} บาท
                      </Text>
                      {item.note ? <Text style={styles.rowSub}>หมายเหตุ: {item.note}</Text> : null}
                      {item.evidence_url ? (
                        <View style={styles.claimEvidenceBlock}>
                          {looksLikeImageEvidenceUrl(item.evidence_url) ? (
                            <>
                              <Pressable
                                accessibilityRole="button"
                                accessibilityLabel="ดูหลักฐานขนาดใหญ่"
                                onPress={() =>
                                  setExpenseEvidencePreview({
                                    url: item.evidence_url,
                                    name: item.evidence_name,
                                  })
                                }>
                                <Image
                                  source={{ uri: item.evidence_url }}
                                  style={styles.expenseEvidenceThumb}
                                  resizeMode="cover"
                                />
                              </Pressable>
                              <Text style={styles.rowSub} numberOfLines={2}>
                                {item.evidence_name ?? 'หลักฐาน'}
                              </Text>
                              <Pressable
                                onPress={() => {
                                  void Linking.openURL(item.evidence_url);
                                }}>
                                <Text style={styles.linkAction}>
                                  เปิดในเบราว์เซอร์ / ดาวน์โหลด
                                </Text>
                              </Pressable>
                            </>
                          ) : (
                            <Pressable
                              onPress={() => {
                                void Linking.openURL(item.evidence_url);
                              }}>
                              <Text style={styles.linkAction}>
                                {item.evidence_name ?? 'เปิดหลักฐาน'}
                              </Text>
                            </Pressable>
                          )}
                        </View>
                      ) : (
                        <Text style={styles.rowSub}>ไม่มีไฟล์แนบ</Text>
                      )}
                    </View>
                  ))
                )}
              </View>
            );
          })
        )}
        <Pressable style={styles.btn} onPress={() => void exportExpenseClaimCsv()}>
          <Text style={styles.btnText}>ส่งออก Expense Claim เป็น CSV</Text>
        </Pressable>

        <Text style={[styles.h2, { marginTop: 24 }]}>6 · สาขา (branch_information)</Text>
        <Text style={styles.muted}>
          รหัสสาขา (id) ต้องไม่ซ้ำ — ดึงจากตารางเดิมของคุณ
        </Text>
        <TextInput
          style={styles.input}
          placeholder="รหัสสาขา (ตัวเลข เช่น 1)"
          value={bId}
          onChangeText={setBId}
          keyboardType="number-pad"
        />
        <TextInput
          style={styles.input}
          placeholder="รหัสสาขา (branch_code)"
          value={bCode}
          onChangeText={setBCode}
        />
        <TextInput
          style={styles.input}
          placeholder="ชื่อสาขา (branch_name)"
          value={bName}
          onChangeText={setBName}
        />
        <TextInput
          style={styles.input}
          placeholder="ที่อยู่"
          value={bAddr}
          onChangeText={setBAddr}
        />
        <TextInput
          style={styles.input}
          placeholder="เบอร์โทร (ตัวเลข)"
          value={bPhone}
          onChangeText={setBPhone}
          keyboardType="phone-pad"
        />
        <TextInput
          style={styles.input}
          placeholder="ละติจูด"
          value={bLat}
          onChangeText={setBLat}
          keyboardType="decimal-pad"
        />
        <TextInput
          style={styles.input}
          placeholder="ลองจิจูด"
          value={bLon}
          onChangeText={setBLon}
          keyboardType="decimal-pad"
        />
        <TextInput
          style={styles.input}
          placeholder="รัศมี (เมตร)"
          value={bRad}
          onChangeText={setBRad}
          keyboardType="number-pad"
        />
        <Pressable style={styles.btn} onPress={addBranch}>
          <Text style={styles.btnText}>เพิ่มสาขา</Text>
        </Pressable>

        <FlatList
          scrollEnabled={false}
          data={branches}
          keyExtractor={(b) => String(b.id)}
          renderItem={({ item: b }) => (
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>
                  {b.branch_name ?? b.branch_code ?? `สาขา #${b.id}`}
                </Text>
                <Text style={styles.rowSub}>
                  id {b.id} · {b.latitude}, {b.longitude} · รัศมี {b.radius_meters} ม.
                </Text>
              </View>
              <View style={styles.branchActions}>
                <Pressable onPress={() => openEditBranch(b)}>
                  <Text style={styles.linkAction}>แก้ไข</Text>
                </Pressable>
                <Pressable onPress={() => deleteBranch(b.id)}>
                  <Text style={styles.danger}>ลบ</Text>
                </Pressable>
              </View>
            </View>
          )}
        />

        <Text style={[styles.h2, { marginTop: 24 }]}>ข้อความการ์ดพักเบรก</Text>
        <Text style={styles.muted}>
          แต่ละช่อง = ข้อความหนึ่งแบบที่อาจถูกสุ่มแสดงบนป๊อปอัพ — กด «เพิ่มข้อความ» เพื่อเพิ่มตัวเลือก
        </Text>
        <Text style={styles.label}>ข้อความตอนกดพักเบรก</Text>
        {breakStartLines.map((line, i) => (
          <View key={`bs-${i}`} style={styles.breakLineBlock}>
            <Text style={styles.breakLineTag}>ข้อความ {i + 1}</Text>
            <TextInput
              style={[styles.input, styles.breakLineInput]}
              placeholder="พิมพ์ข้อความที่จะแสดงในป๊อปอัพเมื่อกดพักเบรก"
              value={line}
              onChangeText={(t) => {
                setBreakStartLines((prev) => {
                  const next = [...prev];
                  next[i] = t;
                  return next;
                });
              }}
              multiline
            />
            <Pressable
              style={[
                styles.breakRemoveBtn,
                breakStartLines.length <= 1 && styles.breakRemoveBtnDisabled,
              ]}
              disabled={breakStartLines.length <= 1}
              onPress={() => {
                setBreakStartLines((prev) =>
                  prev.length <= 1 ? [''] : prev.filter((_, j) => j !== i)
                );
              }}>
              <Text
                style={[
                  styles.breakRemoveBtnText,
                  breakStartLines.length <= 1 && styles.breakRemoveBtnTextDisabled,
                ]}>
                ลบช่องนี้
              </Text>
            </Pressable>
          </View>
        ))}
        <Pressable
          style={styles.btnSecondary}
          onPress={() => setBreakStartLines((p) => [...p, ''])}>
          <Text style={styles.btnSecondaryText}>+ เพิ่มข้อความ (พักเบรก)</Text>
        </Pressable>

        <Text style={[styles.label, { marginTop: 16 }]}>
          ข้อความตอนกดเริ่มงานหลังพัก
        </Text>
        {breakEndLines.map((line, i) => (
          <View key={`be-${i}`} style={styles.breakLineBlock}>
            <Text style={styles.breakLineTag}>ข้อความ {i + 1}</Text>
            <TextInput
              style={[styles.input, styles.breakLineInput]}
              placeholder="พิมพ์ข้อความที่จะแสดงในป๊อปอัพเมื่อกลับมาทำงาน"
              value={line}
              onChangeText={(t) => {
                setBreakEndLines((prev) => {
                  const next = [...prev];
                  next[i] = t;
                  return next;
                });
              }}
              multiline
            />
            <Pressable
              style={[
                styles.breakRemoveBtn,
                breakEndLines.length <= 1 && styles.breakRemoveBtnDisabled,
              ]}
              disabled={breakEndLines.length <= 1}
              onPress={() => {
                setBreakEndLines((prev) =>
                  prev.length <= 1 ? [''] : prev.filter((_, j) => j !== i)
                );
              }}>
              <Text
                style={[
                  styles.breakRemoveBtnText,
                  breakEndLines.length <= 1 && styles.breakRemoveBtnTextDisabled,
                ]}>
                ลบช่องนี้
              </Text>
            </Pressable>
          </View>
        ))}
        <Pressable
          style={styles.btnSecondary}
          onPress={() => setBreakEndLines((p) => [...p, ''])}>
          <Text style={styles.btnSecondaryText}>+ เพิ่มข้อความ (หลังพัก)</Text>
        </Pressable>

        <Pressable style={styles.btn} onPress={saveBreakMessages}>
          <Text style={styles.btnText}>บันทึกข้อความพักเบรก</Text>
        </Pressable>

        <Text style={[styles.h2, { marginTop: 24 }]}>ตั้งค่า KPI ลา / ขอเข้าสาย</Text>
        <Text style={styles.muted}>
          เกณฑ์นี้ใช้คำนวณการ์ด KPI ในหน้าโปรไฟล์แบบรายไตรมาสและภาพรวมปี — แก้ตัวเลขใน JSON ได้ทั้งหมด
        </Text>
        <TextInput
          style={[styles.input, styles.kpiSettingsInput]}
          value={kpiSettingsText}
          onChangeText={setKpiSettingsText}
          multiline
          textAlignVertical="top"
          autoCapitalize="none"
          autoCorrect={false}
        />
        <View style={styles.kpiSettingsActions}>
          <Pressable
            style={styles.btnSecondary}
            onPress={() => setKpiSettingsText(DEFAULT_KPI_SETTINGS_TEXT)}>
            <Text style={styles.btnSecondaryText}>คืนค่าเริ่มต้น</Text>
          </Pressable>
          <Pressable
            style={[styles.btn, kpiSettingsSaving && styles.disabledSoft]}
            disabled={kpiSettingsSaving}
            onPress={() => void saveKpiSettings()}>
            {kpiSettingsSaving ? (
              <ActivityIndicator color={NatureTheme.colors.onAccent} />
            ) : (
              <Text style={styles.btnText}>บันทึกเกณฑ์ KPI</Text>
            )}
          </Pressable>
        </View>

        <Text style={[styles.h2, { marginTop: 24 }]}>ตั้งค่าระบบ (JSON text)</Text>
        <TextInput
          style={styles.input}
          placeholder="key"
          value={setKey}
          onChangeText={setSetKey}
        />
        <TextInput
          style={[styles.input, styles.tall]}
          placeholder="ค่า (เก็บเป็น { text: ... })"
          value={setVal}
          onChangeText={setSetVal}
          multiline
        />
        <Pressable style={styles.btn} onPress={saveSetting}>
          <Text style={styles.btnText}>บันทึกการตั้งค่า</Text>
        </Pressable>
      </ScrollView>

      <Modal
        visible={editBranch !== null}
        transparent
        animationType="slide"
        presentationStyle="overFullScreen"
        statusBarTranslucent
        onRequestClose={() => setEditBranch(null)}>
        <Pressable
          style={[styles.linkBackdrop, WEB_MODAL_BACKDROP]}
          onPress={() => setEditBranch(null)}>
          <Pressable style={styles.linkModalCard} onPress={() => {}}>
            <Text style={styles.linkModalTitle}>แก้ไขสาขา</Text>
            <Text style={styles.linkModalSub}>
              รหัสสาขา (id) {editBranch?.id} — แก้ได้เฉพาะข้อมูล ไม่เปลี่ยน id
            </Text>
            <ScrollView
              style={styles.linkModalScroll}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}>
              <Text style={styles.label}>รหัสสาขา (branch_code)</Text>
              <TextInput
                style={styles.input}
                value={ebCode}
                onChangeText={setEbCode}
                placeholder="branch_code"
              />
              <Text style={styles.label}>ชื่อสาขา *</Text>
              <TextInput
                style={styles.input}
                value={ebName}
                onChangeText={setEbName}
                placeholder="ชื่อสาขา"
              />
              <Text style={styles.label}>ที่อยู่</Text>
              <TextInput
                style={styles.input}
                value={ebAddr}
                onChangeText={setEbAddr}
                placeholder="ที่อยู่"
              />
              <Text style={styles.label}>เบอร์โทร</Text>
              <TextInput
                style={styles.input}
                value={ebPhone}
                onChangeText={setEbPhone}
                keyboardType="phone-pad"
                placeholder="เบอร์โทร"
              />
              <Text style={styles.label}>ละติจูด / ลองจิจูด / รัศมี (ม.)</Text>
              <TextInput
                style={styles.input}
                value={ebLat}
                onChangeText={setEbLat}
                keyboardType="decimal-pad"
                placeholder="ละติจูด"
              />
              <TextInput
                style={styles.input}
                value={ebLon}
                onChangeText={setEbLon}
                keyboardType="decimal-pad"
                placeholder="ลองจิจูด"
              />
              <TextInput
                style={styles.input}
                value={ebRad}
                onChangeText={setEbRad}
                keyboardType="number-pad"
                placeholder="รัศมี เมตร"
              />
            </ScrollView>
            <View style={styles.editBranchActions}>
              <Pressable
                style={[styles.sheetSecondaryBtn, styles.editBranchActionBtn]}
                onPress={() => setEditBranch(null)}>
                <Text style={styles.sheetSecondaryBtnText}>ยกเลิก</Text>
              </Pressable>
              <Pressable
                style={[styles.btn, styles.editBranchActionBtn]}
                onPress={saveBranchEdit}>
                <Text style={styles.btnText}>บันทึกสาขา</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={expenseEvidencePreview !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setExpenseEvidencePreview(null)}>
        <Pressable
          style={[styles.evidenceFullBackdrop, WEB_MODAL_BACKDROP]}
          onPress={() => setExpenseEvidencePreview(null)}>
          {expenseEvidencePreview ? (
            <View style={styles.evidenceFullCard} pointerEvents="box-none">
              <View style={styles.evidenceFullHeader}>
                <Text style={styles.evidenceFullTitle} numberOfLines={1}>
                  {expenseEvidencePreview.name ?? 'หลักฐาน'}
                </Text>
                <Pressable
                  hitSlop={12}
                  onPress={() => setExpenseEvidencePreview(null)}
                  accessibilityRole="button"
                  accessibilityLabel="ปิด">
                  <Text style={styles.evidenceFullClose}>ปิด</Text>
                </Pressable>
              </View>
              <View style={styles.evidenceFullImageBox}>
                <ZoomableImage
                  source={{ uri: expenseEvidencePreview.url }}
                  style={StyleSheet.absoluteFillObject}
                  resizeMode="contain"
                />
              </View>
              <Text style={styles.evidenceFullHint}>
                แตะพื้นหลังเพื่อปิด · pinch เพื่อซูม
              </Text>
            </View>
          ) : null}
        </Pressable>
      </Modal>

      <AdminManagerDelegationModal
        visible={!!managerModalProfile}
        manager={managerModalProfile}
        candidateProfiles={profiles.filter(
          (p) => p.role !== 'admin' && p.id !== managerModalProfile?.id
        )}
        onClose={() => setManagerModalProfile(null)}
        onSaved={() => {
          void load();
        }}
      />
      <AdminEmployeeEditModal
        visible={editEmployeeId !== null}
        employeeId={editEmployeeId}
        preview={editPreview}
        branches={branches}
        allProfiles={profiles}
        onClose={() => {
          setEditEmployeeId(null);
          setEditPreview(null);
        }}
        onSaved={async () => {
          await load();
          const id = editEmployeeId;
          if (id && id !== ADMIN_NEW_EMPLOYEE_ID) {
            const { data } = await supabase.rpc('admin_list_employee_passwords');
            const row = (data as AdminEmployeePasswordRow[] | null)?.find(
              (r) => r.id === id
            );
            if (row) setEditPreview(row);
          }
        }}
      />
    </>
  );
}

const c = NatureTheme.colors;
const r = NatureTheme.radius;
const s = NatureTheme.spacing;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.canvas },
  content: { padding: s.screen, paddingBottom: 36 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  h2: { fontSize: 18, fontWeight: '700', marginBottom: 10, color: c.text },
  legacyRpcError: {
    fontSize: 13,
    color: c.warningTitle,
    marginBottom: 10,
    lineHeight: 20,
  },
  warn: {
    fontSize: 12,
    color: c.warningTitle,
    marginBottom: 10,
    lineHeight: 18,
  },
  muted: { fontSize: 13, color: c.textMuted, marginBottom: 12 },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: c.textSecondary,
    marginBottom: 6,
  },
  pwCard: {
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.borderSoft,
    borderRadius: r.sm,
    padding: 12,
    marginBottom: 8,
  },
  pwLine: { fontSize: 14, color: c.text, marginTop: 4 },
  pwKey: { fontWeight: '700', color: c.textSecondary },
  pwSecret: { fontFamily: 'monospace', color: c.link },
  pwSub: { fontSize: 12, color: c.textMuted, marginTop: 8 },
  editBtn: {
    marginTop: 10,
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: c.linkLight,
    borderRadius: r.sm,
  },
  editBtnText: { color: c.link, fontWeight: '700', fontSize: 14 },
  empBtnResign: {
    marginTop: 10,
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: c.warningBg,
    borderRadius: r.sm,
    borderWidth: 1,
    borderColor: c.warningBorder,
  },
  empBtnResignText: { color: c.warningTitle, fontWeight: '700', fontSize: 14 },
  empBtnDelete: {
    marginTop: 10,
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: c.errorBg,
    borderRadius: r.sm,
    borderWidth: 1,
    borderColor: 'rgba(229, 115, 115, 0.35)',
  },
  empBtnDeleteText: { color: c.error, fontWeight: '700', fontSize: 14 },
  empActionBtnDisabled: { opacity: 0.45 },
  adminEmpDashboard: {
    marginBottom: 20,
    padding: 14,
    borderRadius: r.md,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.borderSoft,
  },
  adminEmpDashboardTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: c.text,
    marginBottom: 6,
  },
  adminEmpDashboardStat: {
    marginTop: 10,
    fontSize: 14,
    color: c.textSecondary,
    lineHeight: 22,
  },
  adminEmpStatEm: { fontWeight: '800', color: c.text },
  adminEmpBarTrack: {
    marginTop: 12,
    flexDirection: 'row',
    height: 12,
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: c.chip,
  },
  adminEmpBarSegActive: {
    minWidth: 2,
    backgroundColor: c.checkIn,
  },
  adminEmpBarSegResigned: {
    minWidth: 2,
    backgroundColor: c.textMuted,
  },
  empCardActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
    zIndex: 2,
  },
  pressableWeb: {
    cursor: 'pointer' as const,
    zIndex: 3,
  },
  linkBadgeRow: { marginBottom: 8 },
  linkBadge: {
    alignSelf: 'flex-start',
    fontSize: 11,
    fontWeight: '700',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    overflow: 'hidden',
  },
  linkBadgeOn: { backgroundColor: c.chipActive, color: c.primaryDark },
  linkBadgeOff: { backgroundColor: c.surfaceMuted, color: c.textMuted },
  monoSm: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 12 },
  annHeightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  annHeightBtn: {
    width: 40,
    height: 40,
    borderRadius: r.sm,
    backgroundColor: c.surfaceElevated,
    borderWidth: 1,
    borderColor: c.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  annHeightBtnText: { fontSize: 20, fontWeight: '700', color: c.text },
  annHeightVal: { fontSize: 15, fontWeight: '700', color: c.text, minWidth: 56 },
  annPreviewBox: {
    borderRadius: r.sm,
    borderWidth: 1,
    borderColor: c.borderSoft,
    backgroundColor: c.surfaceMuted,
    overflow: 'hidden',
    marginBottom: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  annPreviewImg: { width: '100%', height: '100%' },
  annPendingTag: {
    fontSize: 10,
    fontWeight: '700',
    color: c.warningTitle,
    marginTop: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: r.sm,
    padding: 10,
    marginBottom: 8,
    backgroundColor: c.surfaceElevated,
    color: c.text,
  },
  tall: { minHeight: 72, textAlignVertical: 'top' },
  kpiSettingsInput: {
    minHeight: 320,
    fontFamily: Platform.select({ web: 'monospace', default: undefined }),
    lineHeight: 18,
  },
  kpiSettingsActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    alignItems: 'center',
    marginBottom: s.section,
  },
  breakLineBlock: { marginBottom: 14 },
  breakLineTag: {
    fontSize: 12,
    fontWeight: '600',
    color: c.textSecondary,
    marginBottom: 6,
  },
  breakLineInput: { minHeight: 56, textAlignVertical: 'top', marginBottom: 6 },
  breakRemoveBtn: { alignSelf: 'flex-start', paddingVertical: 4 },
  breakRemoveBtnDisabled: { opacity: 0.35 },
  breakRemoveBtnText: { fontSize: 13, color: c.error, fontWeight: '600' },
  breakRemoveBtnTextDisabled: { color: c.textMuted },
  btn: {
    backgroundColor: c.link,
    padding: 12,
    borderRadius: r.sm,
    alignItems: 'center',
    marginBottom: s.section,
  },
  btnText: { color: c.onAccent, fontWeight: '700' },
  disabledSoft: { opacity: 0.65 },
  annThumbGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: s.gapRow,
    marginTop: s.gap,
    marginBottom: s.gap,
  },
  annThumbCard: { width: 112 },
  annThumb: {
    width: 112,
    height: 72,
    borderRadius: r.sm,
    backgroundColor: c.surfaceMuted,
  },
  annThumbRemove: {
    marginTop: 6,
    alignSelf: 'flex-start',
    paddingVertical: 4,
  },
  annThumbRemoveText: { fontSize: 13, color: c.error, fontWeight: '600' },
  annUrlRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  annUrlInput: { flex: 1, minWidth: 160, marginBottom: 0 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderColor: c.borderSoft,
    gap: 8,
  },
  rowTitle: { fontWeight: '600', color: c.text },
  rowSub: { color: c.textMuted, fontSize: 12, marginTop: 2 },
  claimItemRow: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: c.borderSoft,
    gap: 3,
  },
  claimActionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  claimBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: r.sm,
  },
  claimBtnApprove: { backgroundColor: c.primary },
  claimBtnReject: { backgroundColor: c.error },
  claimBtnPaid: { backgroundColor: c.link },
  claimBtnText: { color: c.onAccent, fontWeight: '700' },
  claimFilterWrap: {
    borderWidth: 1,
    borderColor: c.borderSoft,
    borderRadius: r.sm,
    padding: 10,
    backgroundColor: c.surface,
    marginBottom: 12,
  },
  claimFilterStatusRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 8,
  },
  claimFilterChip: {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 999,
    paddingVertical: 5,
    paddingHorizontal: 10,
    backgroundColor: c.surfaceElevated,
  },
  claimFilterChipActive: {
    backgroundColor: c.primaryLight,
    borderColor: c.primaryMuted,
  },
  claimFilterChipText: {
    fontSize: 12,
    color: c.textSecondary,
    fontWeight: '600',
  },
  claimFilterChipTextActive: {
    color: c.primaryDark,
    fontWeight: '700',
  },
  claimDateRow: {
    flexDirection: 'row',
    gap: 8,
  },
  claimDateInput: { flex: 1, marginBottom: 0 },
  claimDateValue: { color: c.text, fontSize: 14 },
  claimDatePlaceholder: { color: c.textMuted, fontSize: 14 },
  claimDateClearBtn: {
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: r.sm,
    backgroundColor: c.surfaceElevated,
    borderWidth: 1,
    borderColor: c.border,
    marginTop: 8,
    marginBottom: 6,
  },
  claimDateClearBtnText: { color: c.textSecondary, fontSize: 12, fontWeight: '600' },
  danger: { color: c.error, fontWeight: '700' },
  btnSecondary: {
    alignSelf: 'flex-start',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: r.sm,
    borderWidth: 1,
    borderColor: c.primaryMuted,
    backgroundColor: c.surface,
    marginBottom: 12,
  },
  btnSecondaryText: { color: c.primaryDark, fontWeight: '700', fontSize: 14 },
  employeeListFrame: {
    maxHeight: 520,
    borderWidth: 1,
    borderColor: c.borderSoft,
    borderRadius: r.sm,
    padding: 8,
    backgroundColor: c.surface,
    marginBottom: 12,
  },
  employeeListScroll: {
    maxHeight: 500,
  },
  branchActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s.gapRow,
  },
  linkAction: { color: c.link, fontWeight: '700', fontSize: 14 },
  claimEvidenceBlock: { marginTop: 6, gap: 6 },
  expenseEvidenceThumb: {
    width: '100%',
    maxWidth: 360,
    height: 160,
    borderRadius: r.sm,
    backgroundColor: c.surfaceMuted,
    borderWidth: 1,
    borderColor: c.borderSoft,
  },
  evidenceFullBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.88)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  evidenceFullCard: {
    width: '100%',
    maxWidth: 560,
    alignItems: 'stretch',
  },
  evidenceFullHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 10,
  },
  evidenceFullTitle: {
    flex: 1,
    minWidth: 0,
    color: '#F8FAFC',
    fontSize: 15,
    fontWeight: '700',
  },
  evidenceFullClose: {
    color: c.primary,
    fontWeight: '800',
    fontSize: 16,
  },
  evidenceFullImageBox: {
    width: '100%',
    height: 440,
    borderRadius: r.md,
    backgroundColor: c.surface,
    overflow: 'hidden',
  },
  evidenceFullHint: {
    marginTop: 10,
    textAlign: 'center',
    color: 'rgba(248,250,252,0.72)',
    fontSize: 12,
  },
  linkBackdrop: {
    flex: 1,
    backgroundColor: c.overlay,
    justifyContent: 'flex-end',
  },
  linkModalCard: {
    backgroundColor: c.surfaceElevated,
    borderTopLeftRadius: r.xl,
    borderTopRightRadius: r.xl,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 18,
    maxHeight: '88%',
    borderWidth: 1,
    borderColor: c.borderSoft,
    borderBottomWidth: 0,
  },
  linkModalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: c.text,
    textAlign: 'center',
  },
  linkModalSub: {
    fontSize: 12,
    color: c.textMuted,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 8,
    lineHeight: 18,
  },
  linkModalScroll: { maxHeight: 400 },
  sheetSecondaryBtn: {
    marginTop: 12,
    backgroundColor: c.surface,
    paddingVertical: 14,
    borderRadius: r.sm,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: c.border,
  },
  sheetSecondaryBtnText: { color: c.primaryDark, fontWeight: '700', fontSize: 15 },
  editBranchActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
    alignItems: 'stretch',
  },
  editBranchActionBtn: { flex: 1, marginBottom: 0 },
});
