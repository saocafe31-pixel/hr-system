import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

import { UserAvatar } from '@/components/UserAvatar';
import { NatureTheme } from '@/constants/Theme';
import { useAuth } from '@/contexts/AuthContext';
import { useCuteToast } from '@/contexts/CuteToastContext';
import { calculateOvertimeMinutes, formatDurationMinutesTh } from '@/lib/attendanceDurations';
import {
  computeLateFromAttendanceData,
  payrollPeriodCheckInIsoRange,
  type AssignmentWithShiftTimes,
} from '@/lib/computeLateFromAttendance';
import {
  bangkokPayrollPeriodBounds,
  formatPayrollCycleChipTh,
  formatPayrollPeriodRangeTh,
  listPayrollCycleKeysDescending,
  parsePayrollCycleKey,
  payrollCycleKeyFromBangkokDate,
} from '@/lib/leaveLateRules';
import {
  LATE_DEDUCTION_BAHT_PER_MINUTE,
  money,
  overlapDaysInclusive,
  parseMoneyInput,
  roundMoney,
  socialSecurityAuto,
  withholdingTaxMonthly,
} from '@/lib/payroll';
import { loadPayrollCompanyInfo } from '@/lib/payrollCompanyInfo';
import { exportPayslipPdf, openPayslipPrintWindow } from '@/lib/payslipPdf';
import { supabase } from '@/lib/supabase';
import type {
  AttendanceLog,
  AttendanceOvertimeRequestRow,
  EmployeeDirectory,
  ExpenseClaimRow,
  LeaveRequestRow,
  PayrollCompensationRow,
  PayrollItemKind,
  PayrollItemRow,
  PayrollSlipRow,
  Profile,
  SalaryClaimRow,
  WorkScheduleRow,
} from '@/lib/types';

type PayrollEmployeeDisplay = {
  primary: string;
  secondary: string;
  searchText: string;
  paymentMethod: string;
  bankName: string;
  bankAccount: string;
};

type PayrollDraftItem = {
  item_kind: PayrollItemKind;
  item_code: string;
  label: string;
  amount: number;
  taxable: boolean;
  source_table?: string | null;
  source_id?: string | null;
  sort_order: number;
};

type CompensationDraft = {
  base_salary: string;
  position_allowance: string;
  special_allowance: string;
  diligence_allowance: string;
  travel_allowance: string;
  commission: string;
  other_income: string;
  overtime_hourly_rate_mode: NonNullable<PayrollCompensationRow['overtime_hourly_rate_mode']>;
  overtime_manual_hourly_rate: string;
  overtime_multiplier: string;
  social_security_mode: PayrollCompensationRow['social_security_mode'];
  social_security_manual_amount: string;
  withholding_tax_mode: PayrollCompensationRow['withholding_tax_mode'];
  withholding_tax_manual_amount: string;
  notes: string;
};

type ManualAdjustmentDraft = {
  item_kind: PayrollItemKind;
  label: string;
  amount: string;
  taxable: boolean;
};

type PayrollHistoryStatusFilter = PayrollSlipRow['status'] | 'all';
type PayrollSection = 'menu' | 'overview';

type VoidReissuePrompt = {
  slip: PayrollSlipRow;
  reason: string;
};

const c = NatureTheme.colors;
const r = NatureTheme.radius;

const emptyDraft: CompensationDraft = {
  base_salary: '',
  position_allowance: '',
  special_allowance: '',
  diligence_allowance: '',
  travel_allowance: '',
  commission: '',
  other_income: '',
  overtime_hourly_rate_mode: 'auto',
  overtime_manual_hourly_rate: '',
  overtime_multiplier: '1.5',
  social_security_mode: 'auto',
  social_security_manual_amount: '',
  withholding_tax_mode: 'auto',
  withholding_tax_manual_amount: '',
  notes: '',
};

const emptyManualAdjustment: ManualAdjustmentDraft = {
  item_kind: 'income',
  label: '',
  amount: '',
  taxable: false,
};

function n(v: string): number {
  return parseMoneyInput(v);
}

function fmtInput(value: number | null | undefined): string {
  const num = Number(value ?? 0);
  return Number.isFinite(num) && num > 0 ? String(num) : '';
}

function positiveMoneyInput(value: string, fallback: number): number {
  const parsed = n(value);
  return parsed > 0 ? parsed : fallback;
}

function slipStatusLabel(status: PayrollSlipRow['status']): string {
  if (status === 'voided') return 'ยกเลิกแล้ว';
  if (status === 'paid') return 'จ่ายแล้ว';
  if (status === 'confirmed') return 'ยืนยันแล้ว';
  return 'Draft';
}

function employeeReviewLabel(slip: PayrollSlipRow): string {
  if (slip.status !== 'confirmed' && slip.status !== 'paid') return '-';
  return slip.employee_confirmed_at ? 'พนักงานยืนยันแล้ว' : 'รอพนักงานตรวจสอบ';
}

function csvEscape(value: unknown): string {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

async function downloadCsv(filename: string, rows: unknown[][]) {
  const content = `\uFEFF${rows.map((row) => row.map(csvEscape).join(',')).join('\n')}`;
  if (Platform.OS === 'web') {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
    return;
  }
  const uri = `${FileSystem.cacheDirectory}${filename}`;
  await FileSystem.writeAsStringAsync(uri, content, {
    encoding: FileSystem.EncodingType.UTF8,
  });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: 'text/csv' });
  }
}

function formatDateTimeTh(value: string | null | undefined): string {
  if (!value) return '-';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '-';
  return new Intl.DateTimeFormat('th-TH', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Bangkok',
  }).format(date);
}

function manualKindLabel(kind: PayrollItemKind): string {
  if (kind === 'deduction') return 'รายการหัก';
  if (kind === 'reimbursement') return 'เงินคืน/เบิกจ่าย';
  return 'รายได้';
}

function isManualAdjustmentItem(row: Pick<PayrollItemRow, 'item_code' | 'source_table'>): boolean {
  return row.item_code === 'manual_adjustment' || row.source_table === 'manual_adjustment';
}

function payrollItemRowToDraftItem(row: PayrollItemRow): PayrollDraftItem {
  return {
    item_kind: row.item_kind,
    item_code: row.item_code,
    label: row.label,
    amount: Number(row.amount || 0),
    taxable: !!row.taxable,
    source_table: row.source_table,
    source_id: row.source_id,
    sort_order: row.sort_order,
  };
}

function summarizePayrollDraftItems(rows: PayrollDraftItem[]) {
  const incomeTotal = roundMoney(
    rows.filter((item) => item.item_kind === 'income').reduce((sum, item) => sum + item.amount, 0)
  );
  const reimbursementTotal = roundMoney(
    rows.filter((item) => item.item_kind === 'reimbursement').reduce((sum, item) => sum + item.amount, 0)
  );
  const deductionTotal = roundMoney(
    rows.filter((item) => item.item_kind === 'deduction').reduce((sum, item) => sum + item.amount, 0)
  );
  const taxableIncome = roundMoney(
    rows
      .filter((item) => item.item_kind === 'income' && item.taxable)
      .reduce((sum, item) => sum + item.amount, 0)
  );
  return {
    taxableIncome,
    incomeTotal,
    reimbursementTotal,
    deductionTotal,
    netPay: roundMoney(incomeTotal + reimbursementTotal - deductionTotal),
  };
}

function profileName(p: Profile, displayByUserId?: Map<string, PayrollEmployeeDisplay>): string {
  return (
    displayByUserId?.get(p.id)?.primary ||
    p.full_name?.trim() ||
    p.email?.trim() ||
    p.employee_code?.trim() ||
    p.id.slice(0, 8)
  );
}

function directoryFullName(row: EmployeeDirectory): string {
  return [row.prefix, row.name, row.surname].map((v) => v?.trim()).filter(Boolean).join(' ');
}

function buildPayrollDisplay(profile: Profile, directory?: EmployeeDirectory): PayrollEmployeeDisplay {
  const fullName = directory ? directoryFullName(directory) : '';
  const nickname = directory?.nickname?.trim() || '';
  const profileNameText = profile.full_name?.trim() || '';
  const email = profile.email?.trim() || '';
  const code =
    directory?.employee_no != null && Number.isFinite(Number(directory.employee_no))
      ? String(directory.employee_no)
      : profile.employee_code?.trim() || '';
  const position = directory?.position?.trim() || '';
  const bankName = directory?.bank?.trim() || '';
  const bankAccount = directory?.account_number?.trim() || '';
  const primary = fullName || profileNameText || email || code || profile.id.slice(0, 8);
  const secondaryParts = [
    `ชื่อเล่น ${nickname || '-'}`,
    `โปรไฟล์ ${profileNameText || '-'}`,
    email || '-',
    code ? `รหัส ${code}` : '',
    position || '-',
  ].filter(Boolean);
  return {
    primary,
    secondary: secondaryParts.join(' · '),
    searchText: [primary, ...secondaryParts, directory?.legacy_user_id ?? '', bankName, bankAccount]
      .join(' ')
      .toLowerCase(),
    paymentMethod: bankName || bankAccount ? 'โอนผ่านบัญชีธนาคาร' : '',
    bankName,
    bankAccount,
  };
}

function parseAssignmentRows(rows: unknown[] | null | undefined): AssignmentWithShiftTimes[] {
  const out: AssignmentWithShiftTimes[] = [];
  for (const row of rows ?? []) {
    const r = row as { id?: string; work_date?: string; work_shifts?: unknown };
    let shift = r.work_shifts as AssignmentWithShiftTimes['work_shifts'] | null;
    if (Array.isArray(r.work_shifts)) {
      shift = (r.work_shifts[0] as AssignmentWithShiftTimes['work_shifts']) ?? null;
    }
    if (!r.id || !r.work_date) continue;
    out.push({ id: String(r.id), work_date: String(r.work_date), work_shifts: shift });
  }
  return out;
}

function lateRequestMinutesByWorkDate(
  rows: { work_date: string; minutes_late: number }[]
): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    const key = String(row.work_date).slice(0, 10);
    const add = Number(row.minutes_late);
    if (!Number.isFinite(add) || add <= 0) continue;
    map.set(key, (map.get(key) ?? 0) + add);
  }
  return map;
}

const bangkokYmdFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bangkok',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function bangkokYmdFromIso(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '';
  const parts = bangkokYmdFormatter.formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  return year && month && day ? `${year}-${month}-${day}` : '';
}

function attendanceLogTimesByYmd(rows: Pick<AttendanceLog, 'kind' | 'created_at'>[]) {
  const checkInByDate = new Map<string, string>();
  const checkOutByDate = new Map<string, string>();
  for (const row of rows) {
    if (row.kind !== 'check_in' && row.kind !== 'check_out') continue;
    const ymd = bangkokYmdFromIso(row.created_at);
    if (!ymd) continue;
    const current = row.kind === 'check_in' ? checkInByDate.get(ymd) : checkOutByDate.get(ymd);
    if (!current) {
      if (row.kind === 'check_in') checkInByDate.set(ymd, row.created_at);
      else checkOutByDate.set(ymd, row.created_at);
      continue;
    }
    const nextMs = new Date(row.created_at).getTime();
    const currentMs = new Date(current).getTime();
    if (!Number.isFinite(nextMs) || !Number.isFinite(currentMs)) continue;
    if (row.kind === 'check_in' && nextMs < currentMs) checkInByDate.set(ymd, row.created_at);
    if (row.kind === 'check_out' && nextMs > currentMs) checkOutByDate.set(ymd, row.created_at);
  }
  return { checkInByDate, checkOutByDate };
}

export function AdminPayrollPanel() {
  const { session } = useAuth();
  const toast = useCuteToast();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [employeeDisplayByUserId, setEmployeeDisplayByUserId] = useState<
    Map<string, PayrollEmployeeDisplay>
  >(new Map());
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [activePayrollSection, setActivePayrollSection] = useState<PayrollSection>('menu');
  const [payrollDetailOpen, setPayrollDetailOpen] = useState(false);
  const [cycleKey, setCycleKey] = useState(() => payrollCycleKeyFromBangkokDate());
  const [draft, setDraft] = useState<CompensationDraft>(emptyDraft);
  const [slip, setSlip] = useState<PayrollSlipRow | null>(null);
  const [items, setItems] = useState<PayrollItemRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingComp, setSavingComp] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [markingPaid, setMarkingPaid] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [manualAdjustment, setManualAdjustment] = useState<ManualAdjustmentDraft>(emptyManualAdjustment);
  const [savingManualAdjustment, setSavingManualAdjustment] = useState(false);
  const [deletingItemId, setDeletingItemId] = useState<string | null>(null);
  const [payrollHistory, setPayrollHistory] = useState<PayrollSlipRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historySearch, setHistorySearch] = useState('');
  const [historyStatusFilter, setHistoryStatusFilter] = useState<PayrollHistoryStatusFilter>('all');
  const [exportingPayroll, setExportingPayroll] = useState(false);
  const [voidPrompt, setVoidPrompt] = useState<VoidReissuePrompt | null>(null);
  const [voiding, setVoiding] = useState(false);
  const [employeePickerOpen, setEmployeePickerOpen] = useState(false);
  const [employeeSearch, setEmployeeSearch] = useState('');

  const selectedProfile = useMemo(
    () => profiles.find((p) => p.id === selectedUserId) ?? null,
    [profiles, selectedUserId]
  );

  const selectedEmployeeDisplay = useMemo(
    () =>
      selectedProfile
        ? employeeDisplayByUserId.get(selectedProfile.id) ?? buildPayrollDisplay(selectedProfile)
        : null,
    [employeeDisplayByUserId, selectedProfile]
  );

  const cycleBounds = useMemo(() => {
    const parsed = parsePayrollCycleKey(cycleKey);
    if (!parsed) return null;
    return bangkokPayrollPeriodBounds(parsed.y, parsed.m);
  }, [cycleKey]);

  const payrollCycleOptions = useMemo(() => listPayrollCycleKeysDescending(12), []);

  const filteredProfiles = useMemo(() => {
    const q = employeeSearch.trim().toLowerCase();
    if (!q) return profiles;
    return profiles.filter((profile) => {
      const display = employeeDisplayByUserId.get(profile.id) ?? buildPayrollDisplay(profile);
      return display.searchText.includes(q);
    });
  }, [employeeDisplayByUserId, employeeSearch, profiles]);

  const loadProfiles = useCallback(async () => {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, full_name, role, branch_id, employee_code, phone, employee_id, avatar_url')
      .order('full_name');
    if (error) {
      toast.error('โหลดรายชื่อพนักงานไม่สำเร็จ', error.message);
      return;
    }
    const rows = ((data as Profile[]) ?? []).filter((p) => p.role !== 'admin' || p.employee_id);
    const { data: directoryRows, error: directoryError } = await supabase.rpc(
      'admin_list_employee_directory_rows'
    );
    if (directoryError) {
      toast.info(
        'โหลดชื่อ HR ไม่ครบ',
        `${directoryError.message} — ใช้ชื่อจากโปรไฟล์แทน`
      );
    }
    const directoryById = new Map<string, EmployeeDirectory>();
    const directoryByEmail = new Map<string, EmployeeDirectory>();
    for (const row of (directoryRows as EmployeeDirectory[]) ?? []) {
      directoryById.set(row.id, row);
      if (row.legacy_user_id) directoryByEmail.set(row.legacy_user_id.trim().toLowerCase(), row);
    }
    const displayMap = new Map<string, PayrollEmployeeDisplay>();
    for (const profile of rows) {
      const directory =
        (profile.employee_id ? directoryById.get(profile.employee_id) : undefined) ??
        (profile.email ? directoryByEmail.get(profile.email.trim().toLowerCase()) : undefined);
      displayMap.set(profile.id, buildPayrollDisplay(profile, directory));
    }
    setProfiles(rows);
    setEmployeeDisplayByUserId(displayMap);
    setSelectedUserId((prev) => prev ?? rows[0]?.id ?? null);
  }, [toast]);

  const loadSelectedPayroll = useCallback(async () => {
    if (!selectedUserId) {
      setDraft(emptyDraft);
      setSlip(null);
      setItems([]);
      return;
    }
    setLoading(true);
    try {
      const [compRes, slipRes] = await Promise.all([
        supabase.from('payroll_employee_compensation').select('*').eq('user_id', selectedUserId).maybeSingle(),
        supabase
          .from('payroll_slips')
          .select('*')
          .eq('user_id', selectedUserId)
          .eq('cycle_key', cycleKey)
          .neq('status', 'voided')
          .maybeSingle(),
      ]);
      if (compRes.error) throw compRes.error;
      const comp = compRes.data as PayrollCompensationRow | null;
      setDraft(
        comp
          ? {
              base_salary: fmtInput(comp.base_salary),
              position_allowance: fmtInput(comp.position_allowance),
              special_allowance: fmtInput(comp.special_allowance),
              diligence_allowance: fmtInput(comp.diligence_allowance),
              travel_allowance: fmtInput(comp.travel_allowance),
              commission: fmtInput(comp.commission),
              other_income: fmtInput(comp.other_income),
              overtime_hourly_rate_mode: comp.overtime_hourly_rate_mode ?? 'auto',
              overtime_manual_hourly_rate: fmtInput(comp.overtime_manual_hourly_rate),
              overtime_multiplier: fmtInput(comp.overtime_multiplier ?? 1.5) || '1.5',
              social_security_mode: comp.social_security_mode,
              social_security_manual_amount: fmtInput(comp.social_security_manual_amount),
              withholding_tax_mode: comp.withholding_tax_mode,
              withholding_tax_manual_amount: fmtInput(comp.withholding_tax_manual_amount),
              notes: comp.notes ?? '',
            }
          : emptyDraft
      );

      if (slipRes.error) throw slipRes.error;
      const currentSlip = (slipRes.data as PayrollSlipRow | null) ?? null;
      setSlip(currentSlip);
      if (currentSlip?.id) {
        const { data: itemRows, error: itemErr } = await supabase
          .from('payroll_items')
          .select('*')
          .eq('slip_id', currentSlip.id)
          .order('sort_order', { ascending: true });
        if (itemErr) throw itemErr;
        setItems((itemRows as PayrollItemRow[]) ?? []);
      } else {
        setItems([]);
      }
    } catch (e) {
      toast.error('โหลด payroll ไม่สำเร็จ', e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [cycleKey, selectedUserId, toast]);

  const loadPayrollHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const { data, error } = await supabase
        .from('payroll_slips')
        .select('*')
        .eq('cycle_key', cycleKey)
        .order('generated_at', { ascending: false })
        .limit(500);
      if (error) throw error;
      setPayrollHistory((data as PayrollSlipRow[]) ?? []);
    } catch (e) {
      toast.error('โหลดประวัติ Payroll ไม่สำเร็จ', e instanceof Error ? e.message : String(e));
    } finally {
      setHistoryLoading(false);
    }
  }, [cycleKey, toast]);

  useEffect(() => {
    void loadProfiles();
  }, [loadProfiles]);

  useEffect(() => {
    void loadSelectedPayroll();
  }, [loadSelectedPayroll]);

  useEffect(() => {
    void loadPayrollHistory();
  }, [loadPayrollHistory]);

  function setDraftValue(key: keyof CompensationDraft, value: string) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  function openPayrollDetail(userId?: string | null) {
    if (userId) setSelectedUserId(userId);
    setPayrollDetailOpen(true);
  }

  async function persistCompensation() {
    if (!selectedUserId || !session?.user?.id) return;
    const { error } = await supabase.from('payroll_employee_compensation').upsert(
      {
        user_id: selectedUserId,
        base_salary: n(draft.base_salary),
        position_allowance: n(draft.position_allowance),
        special_allowance: n(draft.special_allowance),
        diligence_allowance: n(draft.diligence_allowance),
        travel_allowance: n(draft.travel_allowance),
        commission: n(draft.commission),
        other_income: n(draft.other_income),
        overtime_hourly_rate_mode: draft.overtime_hourly_rate_mode,
        overtime_manual_hourly_rate:
          draft.overtime_hourly_rate_mode === 'manual' ? n(draft.overtime_manual_hourly_rate) : null,
        overtime_multiplier: positiveMoneyInput(draft.overtime_multiplier, 1.5),
        social_security_mode: draft.social_security_mode,
        social_security_manual_amount:
          draft.social_security_mode === 'manual' ? n(draft.social_security_manual_amount) : null,
        withholding_tax_mode: draft.withholding_tax_mode,
        withholding_tax_manual_amount:
          draft.withholding_tax_mode === 'manual' ? n(draft.withholding_tax_manual_amount) : null,
        notes: draft.notes.trim() || null,
        updated_by: session.user.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    );
    if (error) throw error;
  }

  async function saveCompensation() {
    if (!selectedUserId || !session?.user?.id) return;
    setSavingComp(true);
    try {
      await persistCompensation();
      toast.success(
        'บันทึกฐานเงินเดือนแล้ว',
        selectedProfile ? profileName(selectedProfile, employeeDisplayByUserId) : ''
      );
      await loadSelectedPayroll();
    } catch (e) {
      toast.error('บันทึกฐานเงินเดือนไม่สำเร็จ', e instanceof Error ? e.message : String(e));
    } finally {
      setSavingComp(false);
    }
  }

  async function recordPayrollEvent(
    slipId: string,
    eventType: 'generated' | 'confirmed' | 'paid' | 'voided' | 'reissued',
    reason?: string | null,
    metadata: Record<string, unknown> = {}
  ) {
    if (!session?.user?.id) return;
    const { error } = await supabase.from('payroll_slip_events').insert({
      slip_id: slipId,
      actor_id: session.user.id,
      event_type: eventType,
      reason: reason?.trim() || null,
      metadata,
    });
    if (error) throw error;
  }

  async function buildPayrollItems(): Promise<{
    items: PayrollDraftItem[];
    taxableIncome: number;
    incomeTotal: number;
    reimbursementTotal: number;
    deductionTotal: number;
    netPay: number;
  }> {
    if (!selectedUserId || !cycleBounds) throw new Error('เลือกพนักงานและรอบเงินเดือนก่อน');
    const baseSalary = n(draft.base_salary);
    if (baseSalary <= 0) throw new Error('กรุณากรอกฐานเงินเดือนก่อนคำนวณสลิป');
    const { startYmd, endYmd } = cycleBounds;
    const { fromIso, toIso } = payrollPeriodCheckInIsoRange(startYmd, endYmd);

    const [
      asnRes,
      legRes,
      logRes,
      lateRes,
      leaveRes,
      overtimeRes,
      salaryClaimRes,
      expenseClaimRes,
    ] = await Promise.all([
      supabase
        .from('work_schedule_assignments')
        .select('id, work_date, work_shifts(name, start_time, end_time)')
        .eq('user_id', selectedUserId)
        .gte('work_date', startYmd)
        .lte('work_date', endYmd),
      supabase
        .from('work_schedules')
        .select('id, user_id, start_at, end_at, title')
        .eq('user_id', selectedUserId)
        .lte('start_at', toIso)
        .gte('end_at', fromIso),
      supabase
        .from('attendance_logs')
        .select('kind, created_at')
        .eq('user_id', selectedUserId)
        .in('kind', ['check_in', 'check_out'])
        .gte('created_at', fromIso)
        .lte('created_at', toIso),
      supabase
        .from('late_requests')
        .select('work_date, minutes_late')
        .eq('user_id', selectedUserId)
        .gte('work_date', startYmd)
        .lte('work_date', endYmd),
      supabase
        .from('leave_requests')
        .select('id, user_id, leave_type, starts_on, ends_on, status, reason, created_at')
        .eq('user_id', selectedUserId)
        .eq('status', 'approved')
        .eq('leave_type', 'unpaid')
        .lte('starts_on', endYmd)
        .gte('ends_on', startYmd),
      supabase
        .from('attendance_overtime_requests')
        .select(
          'id,user_id,work_date,source,overtime_kind,plan_title,plan_start_at,plan_end_at,prompt_at,response_deadline_at,status,responded_at,auto_checked_out_at,approval_status,approved_by,approved_at,approval_note,reason,manual_minutes,manual_created_by,created_at,updated_at'
        )
        .eq('user_id', selectedUserId)
        .eq('status', 'accepted')
        .eq('approval_status', 'approved')
        .gte('work_date', startYmd)
        .lte('work_date', endYmd),
      supabase
        .from('salary_claims')
        .select('*')
        .eq('user_id', selectedUserId)
        .in('status', ['approved', 'paid'])
        .gte('created_at', fromIso)
        .lte('created_at', toIso),
      supabase
        .from('expense_claims')
        .select('*')
        .eq('user_id', selectedUserId)
        .eq('payroll_handling', 'payroll')
        .in('status', ['approved', 'paid'])
        .gte('created_at', fromIso)
        .lte('created_at', toIso),
    ]);

    for (const res of [
      asnRes,
      legRes,
      logRes,
      lateRes,
      leaveRes,
      overtimeRes,
      salaryClaimRes,
      expenseClaimRes,
    ]) {
      if (res.error) throw res.error;
    }

    const attendanceRows = ((logRes.data as Pick<AttendanceLog, 'kind' | 'created_at'>[]) ?? []);
    const lateRows = computeLateFromAttendanceData({
      startYmd,
      endYmd,
      assignments: parseAssignmentRows((asnRes.data as unknown[]) ?? []),
      legacySchedules: (legRes.data as WorkScheduleRow[]) ?? [],
      checkIns: attendanceRows
        .filter((row) => row.kind === 'check_in')
        .map((row) => ({ created_at: row.created_at })),
      lateRequestMinutesByYmd: lateRequestMinutesByWorkDate(
        (lateRes.data as { work_date: string; minutes_late: number }[]) ?? []
      ),
    });
    const lateMinutes = lateRows.reduce((sum, row) => sum + row.minutes_late, 0);
    const unpaidDays = ((leaveRes.data as LeaveRequestRow[]) ?? []).reduce(
      (sum, row) => sum + overlapDaysInclusive(row.starts_on, row.ends_on, startYmd, endYmd),
      0
    );
    const salaryClaimTotal = ((salaryClaimRes.data as SalaryClaimRow[]) ?? []).reduce(
      (sum, row) => sum + Number(row.requested_amount || 0),
      0
    );
    const expenseTotal = ((expenseClaimRes.data as ExpenseClaimRow[]) ?? []).reduce(
      (sum, row) => sum + Number(row.total_amount || 0),
      0
    );
    const { checkInByDate, checkOutByDate } = attendanceLogTimesByYmd(attendanceRows);
    const overtimeBaseHourlyRate =
      draft.overtime_hourly_rate_mode === 'manual'
        ? n(draft.overtime_manual_hourly_rate)
        : roundMoney(baseSalary / 30 / 8);
    const overtimeMultiplier = positiveMoneyInput(draft.overtime_multiplier, 1.5);
    const overtimeHourlyRate = roundMoney(overtimeBaseHourlyRate * overtimeMultiplier);
    const overtimeEntries = ((overtimeRes.data as AttendanceOvertimeRequestRow[]) ?? [])
      .map((row, index) => {
        const minutes = calculateOvertimeMinutes(
          row,
          checkOutByDate.get(row.work_date),
          checkInByDate.get(row.work_date)
        );
        const amount = roundMoney((minutes / 60) * overtimeHourlyRate);
        return {
          item_kind: 'income',
          item_code: 'overtime_pay',
          label: `OT อนุมัติ ${row.work_date} · ${formatDurationMinutesTh(minutes)} (${money(overtimeHourlyRate)}/ชม.)`,
          amount,
          taxable: true,
          source_table: 'attendance_overtime_requests',
          source_id: row.id,
          sort_order: 80 + index,
        } satisfies PayrollDraftItem;
      })
      .filter((item) => item.amount > 0);

    const incomeEntries = ([
      { item_kind: 'income', item_code: 'base_salary', label: 'ฐานเงินเดือน', amount: baseSalary, taxable: true, sort_order: 10 },
      { item_kind: 'income', item_code: 'position_allowance', label: 'ค่าตำแหน่ง', amount: n(draft.position_allowance), taxable: true, sort_order: 20 },
      { item_kind: 'income', item_code: 'special_allowance', label: 'เงินพิเศษ', amount: n(draft.special_allowance), taxable: true, sort_order: 30 },
      { item_kind: 'income', item_code: 'diligence_allowance', label: 'เบี้ยขยัน', amount: n(draft.diligence_allowance), taxable: false, sort_order: 40 },
      { item_kind: 'income', item_code: 'travel_allowance', label: 'ค่าเดินทาง', amount: n(draft.travel_allowance), taxable: false, sort_order: 50 },
      { item_kind: 'income', item_code: 'commission', label: 'ค่าคอมมิชชั่น', amount: n(draft.commission), taxable: true, sort_order: 60 },
      { item_kind: 'income', item_code: 'other_income', label: 'รายได้อื่นๆ', amount: n(draft.other_income), taxable: false, sort_order: 70 },
      ...overtimeEntries,
    ] satisfies PayrollDraftItem[]).filter((item) => item.amount > 0);

    const taxableIncome = roundMoney(
      incomeEntries.filter((item) => item.taxable).reduce((sum, item) => sum + item.amount, 0)
    );
    const socialSecurity =
      draft.social_security_mode === 'manual'
        ? n(draft.social_security_manual_amount)
        : socialSecurityAuto(baseSalary);
    const tax =
      draft.withholding_tax_mode === 'manual'
        ? n(draft.withholding_tax_manual_amount)
        : withholdingTaxMonthly(taxableIncome);
    const unpaidDeduction = roundMoney((baseSalary / 30) * unpaidDays);
    const lateDeduction = roundMoney(lateMinutes * LATE_DEDUCTION_BAHT_PER_MINUTE);

    const deductionEntries = ([
      {
        item_kind: 'deduction',
        item_code: 'late_deduction',
        label: `หักมาสาย ${lateMinutes} นาที`,
        amount: lateDeduction,
        taxable: false,
        sort_order: 110,
      },
      {
        item_kind: 'deduction',
        item_code: 'salary_claim',
        label: 'เบิกล่วงหน้า (Claim Salary)',
        amount: roundMoney(salaryClaimTotal),
        taxable: false,
        sort_order: 120,
      },
      {
        item_kind: 'deduction',
        item_code: 'unpaid_leave',
        label: `ลาไม่รับเงิน ${unpaidDays} วัน`,
        amount: unpaidDeduction,
        taxable: false,
        sort_order: 130,
      },
      {
        item_kind: 'deduction',
        item_code: 'social_security',
        label: 'ประกันสังคม',
        amount: roundMoney(socialSecurity),
        taxable: false,
        sort_order: 140,
      },
      {
        item_kind: 'deduction',
        item_code: 'withholding_tax',
        label: 'หักภาษี ณ ที่จ่าย',
        amount: roundMoney(tax),
        taxable: false,
        sort_order: 150,
      },
    ] satisfies PayrollDraftItem[]).filter((item) => item.amount > 0);

    const reimbursementEntries = ([
      {
        item_kind: 'reimbursement',
        item_code: 'expense_claim',
        label: 'เงินคืน/เบิกจ่าย (Expense Claim)',
        amount: roundMoney(expenseTotal),
        taxable: false,
        source_table: 'expense_claims',
        sort_order: 210,
      },
    ] satisfies PayrollDraftItem[]).filter((item) => item.amount > 0);

    const allItems = [...incomeEntries, ...deductionEntries, ...reimbursementEntries];
    const totals = summarizePayrollDraftItems(allItems);
    return {
      items: allItems,
      taxableIncome: totals.taxableIncome,
      incomeTotal: totals.incomeTotal,
      reimbursementTotal: totals.reimbursementTotal,
      deductionTotal: totals.deductionTotal,
      netPay: totals.netPay,
    };
  }

  async function generateDraftSlip() {
    if (!selectedUserId || !selectedProfile || !session?.user?.id || !cycleBounds) return;
    if (slip?.status && slip.status !== 'draft') {
      toast.info('สลิปล็อกแล้ว', 'ยืนยันหรือจ่ายแล้วจะไม่คำนวณทับ ให้ใช้ workflow ยกเลิก/ออกสลิปใหม่ในขั้นถัดไป');
      return;
    }
    setGenerating(true);
    try {
      await persistCompensation();
      const result = await buildPayrollItems();
      const existingManualItems = items
        .filter(isManualAdjustmentItem)
        .map(payrollItemRowToDraftItem)
        .map((item, index) => ({ ...item, sort_order: 300 + index }));
      const slipItems = [...result.items, ...existingManualItems];
      const totals = summarizePayrollDraftItems(slipItems);
      const slipPayload = {
        user_id: selectedUserId,
        employee_id: selectedProfile.employee_id ?? null,
        cycle_key: cycleKey,
        period_start: cycleBounds.startYmd,
        period_end: cycleBounds.endYmd,
        status: 'draft',
        taxable_income: totals.taxableIncome,
        reimbursement_total: totals.reimbursementTotal,
        income_total: totals.incomeTotal,
        deduction_total: totals.deductionTotal,
        net_pay: totals.netPay,
        generated_by: session.user.id,
        generated_at: new Date().toISOString(),
        confirmed_by: null,
        confirmed_at: null,
        paid_by: null,
        paid_at: null,
        notes: draft.notes.trim() || null,
      };
      const { data: slipRow, error } = slip?.id
        ? await supabase
            .from('payroll_slips')
            .update(slipPayload)
            .eq('id', slip.id)
            .eq('status', 'draft')
            .select('*')
            .single()
        : await supabase.from('payroll_slips').insert(slipPayload).select('*').single();
      if (error || !slipRow?.id) throw error ?? new Error('สร้างสลิปไม่สำเร็จ');
      await supabase.from('payroll_items').delete().eq('slip_id', slipRow.id);
      if (slipItems.length > 0) {
        const { error: itemErr } = await supabase.from('payroll_items').insert(
          slipItems.map((item) => ({
            ...item,
            amount: roundMoney(item.amount),
            slip_id: slipRow.id,
          }))
        );
        if (itemErr) throw itemErr;
      }
      await recordPayrollEvent(slipRow.id, 'generated', null, {
        cycle_key: cycleKey,
        item_count: slipItems.length,
        net_pay: totals.netPay,
      });
      toast.success(
        'คำนวณสลิป Draft แล้ว',
        `${profileName(selectedProfile, employeeDisplayByUserId)} · ${cycleKey}`
      );
      await loadSelectedPayroll();
      await loadPayrollHistory();
    } catch (e) {
      toast.error('คำนวณสลิปไม่สำเร็จ', e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  }

  async function confirmSlip() {
    if (!slip?.id || !session?.user?.id) return;
    if (slip.status !== 'draft') {
      toast.info('สลิปไม่ใช่ Draft', 'ยืนยันได้เฉพาะสลิปที่ยังเป็น Draft');
      return;
    }
    setConfirming(true);
    try {
      const { error } = await supabase
        .from('payroll_slips')
        .update({
          status: 'confirmed',
          confirmed_by: session.user.id,
          confirmed_at: new Date().toISOString(),
        })
        .eq('id', slip.id)
        .select('*')
        .single();
      if (error) throw error;
      await recordPayrollEvent(slip.id, 'confirmed', null, { cycle_key: slip.cycle_key });
      toast.success('ยืนยันสลิปแล้ว', 'พนักงานจะเห็นสลิปในหน้าโปรไฟล์');
      await loadSelectedPayroll();
      await loadPayrollHistory();
    } catch (e) {
      toast.error('ยืนยันสลิปไม่สำเร็จ', e instanceof Error ? e.message : String(e));
    } finally {
      setConfirming(false);
    }
  }

  async function markSlipPaid() {
    if (!slip?.id || !session?.user?.id) return;
    if (slip.status !== 'confirmed') {
      toast.info('ยังจ่ายไม่ได้', 'บันทึกจ่ายแล้วได้เฉพาะสลิปที่ยืนยันแล้ว');
      return;
    }
    setMarkingPaid(true);
    try {
      const { error } = await supabase
        .from('payroll_slips')
        .update({
          status: 'paid',
          paid_by: session.user.id,
          paid_at: new Date().toISOString(),
        })
        .eq('id', slip.id)
        .eq('status', 'confirmed')
        .select('*')
        .single();
      if (error) throw error;
      await recordPayrollEvent(slip.id, 'paid', null, {
        cycle_key: slip.cycle_key,
        net_pay: Number(slip.net_pay || 0),
      });
      toast.success('บันทึกจ่ายเงินเดือนแล้ว', 'สถานะสลิปเปลี่ยนเป็น paid');
      await loadSelectedPayroll();
      await loadPayrollHistory();
    } catch (e) {
      toast.error('บันทึกสถานะจ่ายไม่สำเร็จ', e instanceof Error ? e.message : String(e));
    } finally {
      setMarkingPaid(false);
    }
  }

  async function refreshSlipTotals(slipId: string) {
    const { data, error } = await supabase
      .from('payroll_items')
      .select('*')
      .eq('slip_id', slipId)
      .order('sort_order', { ascending: true });
    if (error) throw error;
    const rows = (data as PayrollItemRow[]) ?? [];
    const totals = summarizePayrollDraftItems(rows.map(payrollItemRowToDraftItem));
    const { error: updateError } = await supabase
      .from('payroll_slips')
      .update({
        taxable_income: totals.taxableIncome,
        reimbursement_total: totals.reimbursementTotal,
        income_total: totals.incomeTotal,
        deduction_total: totals.deductionTotal,
        net_pay: totals.netPay,
      })
      .eq('id', slipId)
      .eq('status', 'draft');
    if (updateError) throw updateError;
  }

  async function addManualAdjustment() {
    if (!slip?.id) return;
    if (slip.status !== 'draft') {
      toast.info('แก้รายการไม่ได้', 'Manual adjustment ทำได้เฉพาะสลิป Draft');
      return;
    }
    const label = manualAdjustment.label.trim();
    const amount = n(manualAdjustment.amount);
    if (!label || amount <= 0) {
      toast.info('กรอกข้อมูลรายการ', 'ระบุชื่อรายการและยอดเงินมากกว่า 0');
      return;
    }
    setSavingManualAdjustment(true);
    try {
      const manualIndex = items.filter(isManualAdjustmentItem).length;
      const { error } = await supabase.from('payroll_items').insert({
        slip_id: slip.id,
        item_kind: manualAdjustment.item_kind,
        item_code: 'manual_adjustment',
        label,
        amount: roundMoney(amount),
        taxable: manualAdjustment.item_kind === 'income' ? manualAdjustment.taxable : false,
        source_table: 'manual_adjustment',
        source_id: null,
        sort_order: 300 + manualIndex,
      });
      if (error) throw error;
      await refreshSlipTotals(slip.id);
      setManualAdjustment(emptyManualAdjustment);
      toast.success('เพิ่มรายการปรับเองแล้ว', label);
      await loadSelectedPayroll();
      await loadPayrollHistory();
    } catch (e) {
      toast.error('เพิ่มรายการปรับเองไม่สำเร็จ', e instanceof Error ? e.message : String(e));
    } finally {
      setSavingManualAdjustment(false);
    }
  }

  async function deleteManualAdjustment(row: PayrollItemRow) {
    if (!slip?.id || slip.status !== 'draft' || !isManualAdjustmentItem(row)) return;
    setDeletingItemId(row.id);
    try {
      const { error } = await supabase.from('payroll_items').delete().eq('id', row.id).eq('slip_id', slip.id);
      if (error) throw error;
      await refreshSlipTotals(slip.id);
      toast.success('ลบรายการปรับเองแล้ว', row.label);
      await loadSelectedPayroll();
      await loadPayrollHistory();
    } catch (e) {
      toast.error('ลบรายการไม่สำเร็จ', e instanceof Error ? e.message : String(e));
    } finally {
      setDeletingItemId(null);
    }
  }

  async function printSlipPdf() {
    if (!slip || !selectedProfile) return;
    const printWindow = openPayslipPrintWindow();
    setExportingPdf(true);
    try {
      const company = await loadPayrollCompanyInfo();
      await exportPayslipPdf({
        slip,
        items,
        employee: {
          name: selectedEmployeeDisplay?.primary ?? profileName(selectedProfile, employeeDisplayByUserId),
          meta: selectedEmployeeDisplay?.secondary ?? selectedProfile.email,
          paymentMethod: selectedEmployeeDisplay?.paymentMethod,
          bankName: selectedEmployeeDisplay?.bankName,
          bankAccount: selectedEmployeeDisplay?.bankAccount,
        },
        company,
      }, printWindow);
      toast.success('เปิดสลิป PDF แล้ว', 'สามารถพิมพ์หรือบันทึกเป็น PDF ได้จากหน้าต่างที่เปิดขึ้น');
    } catch (e) {
      toast.error('สร้าง PDF ไม่สำเร็จ', e instanceof Error ? e.message : String(e));
    } finally {
      setExportingPdf(false);
    }
  }

  const displayForUserId = useCallback((userId: string): PayrollEmployeeDisplay => {
    const profile = profiles.find((p) => p.id === userId) ?? null;
    return employeeDisplayByUserId.get(userId) ?? (profile ? buildPayrollDisplay(profile) : {
      primary: userId.slice(0, 8),
      secondary: '-',
      searchText: userId.toLowerCase(),
      paymentMethod: '',
      bankName: '',
      bankAccount: '',
    });
  }, [employeeDisplayByUserId, profiles]);

  async function printHistorySlipPdf(historySlip: PayrollSlipRow) {
    const printWindow = openPayslipPrintWindow();
    setExportingPdf(true);
    try {
      const [{ data: itemRows, error: itemError }, company] = await Promise.all([
        supabase
          .from('payroll_items')
          .select('*')
          .eq('slip_id', historySlip.id)
          .order('sort_order', { ascending: true }),
        loadPayrollCompanyInfo(),
      ]);
      if (itemError) throw itemError;
      const display = displayForUserId(historySlip.user_id);
      await exportPayslipPdf({
        slip: historySlip,
        items: (itemRows as PayrollItemRow[]) ?? [],
        employee: {
          name: display.primary,
          meta: display.secondary,
          paymentMethod: display.paymentMethod,
          bankName: display.bankName,
          bankAccount: display.bankAccount,
        },
        company,
      }, printWindow);
      toast.success('เปิดสลิป PDF แล้ว', `${display.primary} · ${historySlip.cycle_key}`);
    } catch (e) {
      toast.error('สร้าง PDF ไม่สำเร็จ', e instanceof Error ? e.message : String(e));
    } finally {
      setExportingPdf(false);
    }
  }

  const filteredPayrollHistory = useMemo(() => {
    const q = historySearch.trim().toLowerCase();
    return payrollHistory.filter((row) => {
      if (historyStatusFilter !== 'all' && row.status !== historyStatusFilter) return false;
      if (!q) return true;
      const display = displayForUserId(row.user_id);
      return [
        row.cycle_key,
        slipStatusLabel(row.status),
        display.primary,
        display.secondary,
        display.searchText,
        display.bankName,
        display.bankAccount,
      ]
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [displayForUserId, historySearch, historyStatusFilter, payrollHistory]);

  const payrollHistoryTotals = useMemo(
    () => ({
      count: filteredPayrollHistory.length,
      income: roundMoney(filteredPayrollHistory.reduce((sum, row) => sum + Number(row.income_total || 0), 0)),
      reimbursement: roundMoney(
        filteredPayrollHistory.reduce((sum, row) => sum + Number(row.reimbursement_total || 0), 0)
      ),
      deduction: roundMoney(
        filteredPayrollHistory.reduce((sum, row) => sum + Number(row.deduction_total || 0), 0)
      ),
      net: roundMoney(filteredPayrollHistory.reduce((sum, row) => sum + Number(row.net_pay || 0), 0)),
    }),
    [filteredPayrollHistory]
  );

  async function exportPayrollSummaryCsv() {
    if (filteredPayrollHistory.length === 0) {
      toast.info('ไม่มีข้อมูลส่งออก', 'ปรับตัวกรองหรือเลือกรอบเดือนอื่นก่อน');
      return;
    }
    setExportingPayroll(true);
    try {
      const rows: unknown[][] = [
        [
          'cycle_key',
          'period_start',
          'period_end',
          'status',
          'employee_name',
          'employee_meta',
          'bank_name',
          'bank_account',
          'income_total',
          'reimbursement_total',
          'deduction_total',
          'net_pay',
          'generated_at',
          'confirmed_at',
          'paid_at',
          'voided_at',
          'void_reason',
          'employee_review_status',
          'employee_confirmed_at',
        ],
        ...filteredPayrollHistory.map((row) => {
          const display = displayForUserId(row.user_id);
          return [
            row.cycle_key,
            row.period_start,
            row.period_end,
            row.status,
            display.primary,
            display.secondary,
            display.bankName,
            display.bankAccount,
            Number(row.income_total || 0),
            Number(row.reimbursement_total || 0),
            Number(row.deduction_total || 0),
            Number(row.net_pay || 0),
            row.generated_at,
            row.confirmed_at,
            row.paid_at ?? '',
            row.voided_at ?? '',
            row.void_reason ?? '',
            employeeReviewLabel(row),
            row.employee_confirmed_at ?? '',
          ];
        }),
      ];
      await downloadCsv(`payroll-summary-${cycleKey}.csv`, rows);
      toast.success('ส่งออก Payroll summary แล้ว', `รอบ ${cycleKey}`);
    } catch (e) {
      toast.error('ส่งออก Payroll summary ไม่สำเร็จ', e instanceof Error ? e.message : String(e));
    } finally {
      setExportingPayroll(false);
    }
  }

  async function exportBankTransferCsv() {
    const transferRows = filteredPayrollHistory.filter(
      (row) => (row.status === 'confirmed' || row.status === 'paid') && Number(row.net_pay || 0) > 0
    );
    if (transferRows.length === 0) {
      toast.info('ไม่มีรายการโอน', 'ไฟล์โอนจะใช้เฉพาะสลิป confirmed/paid ที่ยอดสุทธิมากกว่า 0');
      return;
    }
    setExportingPayroll(true);
    try {
      const rows: unknown[][] = [
        ['cycle_key', 'employee_name', 'bank_name', 'bank_account', 'amount', 'status', 'note'],
        ...transferRows.map((row) => {
          const display = displayForUserId(row.user_id);
          return [
            row.cycle_key,
            display.primary,
            display.bankName,
            display.bankAccount,
            Number(row.net_pay || 0),
            row.status,
            `Payroll ${row.cycle_key}`,
          ];
        }),
      ];
      await downloadCsv(`payroll-bank-transfer-${cycleKey}.csv`, rows);
      toast.success('ส่งออกไฟล์โอนธนาคารแล้ว', `จำนวน ${transferRows.length} รายการ`);
    } catch (e) {
      toast.error('ส่งออกไฟล์โอนไม่สำเร็จ', e instanceof Error ? e.message : String(e));
    } finally {
      setExportingPayroll(false);
    }
  }

  async function voidAndReissueSlip() {
    if (!voidPrompt) return;
    const reason = voidPrompt.reason.trim();
    if (!reason) {
      toast.info('กรุณาระบุเหตุผล', 'ต้องมีเหตุผลเพื่อเก็บ audit log ก่อนออกสลิปใหม่');
      return;
    }
    setVoiding(true);
    try {
      const reissueUserId = voidPrompt.slip.user_id;
      const { data, error } = await supabase.rpc('admin_void_and_reissue_payroll_slip', {
        p_slip_id: voidPrompt.slip.id,
        p_reason: reason,
      });
      if (error) throw error;
      const result = Array.isArray(data) ? data[0] : null;
      setSelectedUserId(reissueUserId);
      setPayrollDetailOpen(true);
      setVoidPrompt(null);
      toast.success(
        'ยกเลิกและออก Draft ใหม่แล้ว',
        result?.new_slip_id ? `Draft ใหม่ ${String(result.new_slip_id).slice(0, 8)}` : voidPrompt.slip.cycle_key
      );
      await loadPayrollHistory();
      if (reissueUserId === selectedUserId) {
        await loadSelectedPayroll();
      }
    } catch (e) {
      toast.error('ยกเลิก/ออกสลิปใหม่ไม่สำเร็จ', e instanceof Error ? e.message : String(e));
    } finally {
      setVoiding(false);
    }
  }

  function renderInput(label: string, key: keyof CompensationDraft, placeholder = '0') {
    return (
      <View style={styles.field}>
        <Text style={styles.label}>{label}</Text>
        <TextInput
          style={styles.input}
          value={String(draft[key] ?? '')}
          onChangeText={(text) => setDraftValue(key, text)}
          placeholder={placeholder}
          placeholderTextColor={c.textMuted}
          keyboardType="decimal-pad"
        />
      </View>
    );
  }

  const groupedItems = useMemo(
    () => ({
      income: items.filter((item) => item.item_kind === 'income'),
      deduction: items.filter((item) => item.item_kind === 'deduction'),
      reimbursement: items.filter((item) => item.item_kind === 'reimbursement'),
    }),
    [items]
  );

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Payroll / สลิปเงินเดือน</Text>
      <Text style={styles.sub}>
        รอบเงินเดือน 26–25 · สร้างเป็น Draft ก่อน แล้วกดยืนยันเพื่อให้พนักงานเห็นในโปรไฟล์
      </Text>

      <Text style={styles.label}>เลือกรอบเงินเดือน</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.monthCardRow}>
        {payrollCycleOptions.map((key) => {
          const on = key === cycleKey;
          const parsed = parsePayrollCycleKey(key);
          const bounds = parsed ? bangkokPayrollPeriodBounds(parsed.y, parsed.m) : null;
          return (
            <Pressable
              key={key}
              style={[styles.monthCard, on && styles.monthCardOn]}
              onPress={() => setCycleKey(key)}>
              <Text style={[styles.monthCardTitle, on && styles.monthCardTitleOn]}>
                {formatPayrollCycleChipTh(key)}
              </Text>
              <Text style={[styles.monthCardSub, on && styles.monthCardSubOn]}>
                {bounds ? `${bounds.startYmd} - ${bounds.endYmd}` : key}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
      {cycleBounds ? (
        <Text style={styles.hint}>
          {formatPayrollCycleChipTh(cycleKey)} ·{' '}
          {formatPayrollPeriodRangeTh(cycleBounds.startYmd, cycleBounds.endYmd)}
        </Text>
      ) : (
        <Text style={styles.warn}>รูปแบบรอบเงินเดือนต้องเป็น YYYY-MM</Text>
      )}

      <View style={styles.payrollMenuGrid}>
        <Pressable
          style={styles.payrollMenuCard}
          onPress={() => openPayrollDetail(selectedUserId)}>
          <Text style={styles.payrollMenuIcon}>฿</Text>
          <Text style={styles.payrollMenuTitle}>ทำ Payroll / ยืนยันสลิป</Text>
          <Text style={styles.payrollMenuSub}>
            เลือกพนักงาน ตั้งค่ารายได้ คำนวณ Draft ยืนยัน และบันทึกจ่ายแล้ว
          </Text>
          <Text style={styles.payrollMenuAction}>เปิดหน้าต่างทำ Payroll</Text>
        </Pressable>
        <Pressable
          style={[
            styles.payrollMenuCard,
            activePayrollSection === 'overview' && styles.payrollMenuCardOn,
          ]}
          onPress={() => setActivePayrollSection('overview')}>
          <Text style={styles.payrollMenuIcon}>Σ</Text>
          <Text style={styles.payrollMenuTitle}>สรุปภาพรวม Payroll</Text>
          <Text style={styles.payrollMenuSub}>
            ดูยอดรวม ค้นหา/กรองสลิปย้อนหลัง Export summary และไฟล์โอนธนาคาร
          </Text>
          <Text style={styles.payrollMenuAction}>เปิดภาพรวมรอบเดือน</Text>
        </Pressable>
      </View>

      {activePayrollSection === 'overview' ? (
      <View style={styles.historyBox}>
        <View style={styles.historyHeader}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.historyTitle}>ภาพรวม Payroll รอบเดือน</Text>
            <Text style={styles.sub}>
              ค้นหา/กรองสลิปย้อนหลัง ส่งออก summary หรือไฟล์โอนธนาคาร และออก Draft ใหม่จากสลิปที่ล็อกแล้ว
            </Text>
          </View>
          {historyLoading ? <ActivityIndicator color={c.primary} /> : null}
        </View>
        <View style={styles.historyStatGrid}>
          <View style={styles.historyStatCard}>
            <Text style={styles.historyStatLabel}>สลิป</Text>
            <Text style={styles.historyStatValue}>{payrollHistoryTotals.count}</Text>
          </View>
          <View style={styles.historyStatCard}>
            <Text style={styles.historyStatLabel}>รายได้</Text>
            <Text style={styles.historyStatValue}>{money(payrollHistoryTotals.income)}</Text>
          </View>
          <View style={styles.historyStatCard}>
            <Text style={styles.historyStatLabel}>หัก</Text>
            <Text style={styles.historyStatValue}>{money(payrollHistoryTotals.deduction)}</Text>
          </View>
          <View style={styles.historyStatCard}>
            <Text style={styles.historyStatLabel}>สุทธิ</Text>
            <Text style={styles.historyStatValue}>{money(payrollHistoryTotals.net)}</Text>
          </View>
        </View>
        <TextInput
          style={styles.input}
          value={historySearch}
          onChangeText={setHistorySearch}
          placeholder="ค้นหาชื่อ รหัส อีเมล ธนาคาร หรือสถานะ"
          placeholderTextColor={c.textMuted}
        />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.statusFilterRow}>
          {(['all', 'draft', 'confirmed', 'paid', 'voided'] as PayrollHistoryStatusFilter[]).map((status) => {
            const on = historyStatusFilter === status;
            return (
              <Pressable
                key={status}
                style={[styles.statusFilterChip, on && styles.statusFilterChipOn]}
                onPress={() => setHistoryStatusFilter(status)}>
                <Text style={[styles.statusFilterText, on && styles.chipTextOn]}>
                  {status === 'all' ? 'ทั้งหมด' : slipStatusLabel(status)}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <View style={styles.actions}>
          <Pressable
            style={[styles.secondaryBtn, exportingPayroll && styles.disabled]}
            disabled={exportingPayroll}
            onPress={() => void exportPayrollSummaryCsv()}>
            <Text style={styles.secondaryBtnText}>
              {exportingPayroll ? 'กำลังส่งออก...' : 'Export summary CSV'}
            </Text>
          </Pressable>
          <Pressable
            style={[styles.primaryBtn, exportingPayroll && styles.disabled]}
            disabled={exportingPayroll}
            onPress={() => void exportBankTransferCsv()}>
            <Text style={styles.primaryBtnText}>Export bank CSV</Text>
          </Pressable>
        </View>
        <View style={styles.historyList}>
          {filteredPayrollHistory.slice(0, 80).map((row) => {
            const display = displayForUserId(row.user_id);
            const canVoid = row.status === 'confirmed' || row.status === 'paid';
            return (
              <View key={row.id} style={styles.historySlipCard}>
                <View style={styles.historySlipTop}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.historyEmployee} numberOfLines={1}>
                      {display.primary}
                    </Text>
                    <Text style={styles.historyMeta} numberOfLines={2}>
                      {display.secondary}
                    </Text>
                  </View>
                  <View style={[styles.statusPill, payrollStatusPillStyle(row.status)]}>
                    <Text style={styles.statusPillText}>{slipStatusLabel(row.status)}</Text>
                  </View>
                </View>
                <Text style={styles.historyMoney}>
                  สุทธิ {money(Number(row.net_pay || 0))} บาท
                </Text>
                <Text style={styles.historyMeta}>
                  รายได้ {money(Number(row.income_total || 0))} · เงินคืน{' '}
                  {money(Number(row.reimbursement_total || 0))} · หัก{' '}
                  {money(Number(row.deduction_total || 0))}
                </Text>
                <Text style={styles.historyMeta}>
                  สร้าง {formatDateTimeTh(row.generated_at)} · ยืนยัน {formatDateTimeTh(row.confirmed_at)} · จ่าย{' '}
                  {formatDateTimeTh(row.paid_at)}
                </Text>
                {row.status === 'confirmed' || row.status === 'paid' ? (
                  <Text
                    style={[
                      styles.historyReviewText,
                      row.employee_confirmed_at
                        ? styles.historyReviewOk
                        : styles.historyReviewPending,
                    ]}>
                    {employeeReviewLabel(row)}
                    {row.employee_confirmed_at ? ` · ${formatDateTimeTh(row.employee_confirmed_at)}` : ''}
                  </Text>
                ) : null}
                {row.status === 'voided' ? (
                  <Text style={styles.historyVoidReason}>
                    เหตุผลยกเลิก: {row.void_reason || '-'} · {formatDateTimeTh(row.voided_at)}
                  </Text>
                ) : null}
                <View style={styles.historyActions}>
                  <Pressable
                    style={styles.historyActionBtn}
                    onPress={() => openPayrollDetail(row.user_id)}>
                    <Text style={styles.historyActionText}>แก้ไขรายละเอียด</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.historyActionBtn, exportingPdf && styles.disabled]}
                    disabled={exportingPdf}
                    onPress={() => void printHistorySlipPdf(row)}>
                    <Text style={styles.historyActionText}>PDF</Text>
                  </Pressable>
                  {canVoid ? (
                    <Pressable
                      style={styles.historyDangerBtn}
                      onPress={() => setVoidPrompt({ slip: row, reason: '' })}>
                      <Text style={styles.historyDangerText}>Void + Draft ใหม่</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            );
          })}
          {filteredPayrollHistory.length === 0 ? (
            <Text style={styles.empty}>ยังไม่มีสลิปตามตัวกรองนี้</Text>
          ) : null}
          {filteredPayrollHistory.length > 80 ? (
            <Text style={styles.hint}>แสดง 80 รายการแรกจาก {filteredPayrollHistory.length} รายการ ใช้ค้นหาเพื่อกรองเพิ่ม</Text>
          ) : null}
        </View>
      </View>
      ) : (
        <Text style={styles.empty}>
          เลือกเมนูด้านบนเพื่อทำ Payroll รายพนักงานหรือเปิดหน้าสรุปภาพรวมรอบเดือน
        </Text>
      )}

      <Modal
        visible={payrollDetailOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setPayrollDetailOpen(false)}>
        <View style={styles.pickerBackdrop}>
          <View style={styles.payrollDetailSheet}>
            <View style={styles.pickerHeader}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.pickerTitle}>ทำ Payroll / ยืนยันสลิป</Text>
                <Text style={styles.pickerSub}>
                  เลือกพนักงาน แก้ค่าตอบแทน คำนวณ Draft และจัดการสถานะสลิป
                </Text>
              </View>
              <Pressable style={styles.pickerCloseBtn} onPress={() => setPayrollDetailOpen(false)}>
                <Text style={styles.pickerCloseText}>ปิด</Text>
              </Pressable>
            </View>
            <ScrollView style={styles.payrollDetailScroll} contentContainerStyle={styles.payrollDetailContent}>
      <Text style={styles.label}>เลือกพนักงาน</Text>
      <Pressable style={styles.employeeSelectBtn} onPress={() => setEmployeePickerOpen(true)}>
        {selectedProfile ? (
          <>
            <UserAvatar uri={selectedProfile.avatar_url} label={selectedEmployeeDisplay?.primary} size={42} />
            <View style={styles.employeeCardBody}>
              <Text style={styles.employeeSelectTitle} numberOfLines={1}>
                {selectedEmployeeDisplay?.primary ?? profileName(selectedProfile, employeeDisplayByUserId)}
              </Text>
              <Text style={styles.employeeSelectSub} numberOfLines={2}>
                {selectedEmployeeDisplay?.secondary ?? selectedProfile.email ?? 'แตะเพื่อเปลี่ยนพนักงาน'}
              </Text>
            </View>
            <Text style={styles.employeeSelectChevron}>เลือก</Text>
          </>
        ) : (
          <Text style={styles.employeeSelectPlaceholder}>แตะเพื่อเลือกพนักงาน</Text>
        )}
      </Pressable>

      {loading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator color={c.primary} />
          <Text style={styles.sub}>กำลังโหลดข้อมูล payroll...</Text>
        </View>
      ) : null}

      {selectedProfile ? (
        <>
          <View style={styles.grid}>
            {renderInput('ฐานเงินเดือน', 'base_salary')}
            {renderInput('ค่าตำแหน่ง', 'position_allowance')}
            {renderInput('เงินพิเศษ', 'special_allowance')}
            {renderInput('เบี้ยขยัน', 'diligence_allowance')}
            {renderInput('ค่าเดินทาง', 'travel_allowance')}
            {renderInput('ค่าคอมมิชชั่น', 'commission')}
            {renderInput('รายได้อื่นๆ', 'other_income')}
          </View>

          <View style={styles.modeBox}>
            <Text style={styles.label}>ค่า OT ที่อนุมัติแล้ว</Text>
            <Text style={styles.sub}>
              รายการ OT ที่พนักงานกดขอและ manager/admin อนุมัติแล้วจะเข้ารายได้ใน Draft อัตโนมัติ
            </Text>
            <View style={styles.chipRow}>
              {(['auto', 'manual'] as const).map((mode) => (
                <Pressable
                  key={mode}
                  style={[styles.chip, draft.overtime_hourly_rate_mode === mode && styles.chipOn]}
                  onPress={() => setDraft((prev) => ({ ...prev, overtime_hourly_rate_mode: mode }))}>
                  <Text style={[styles.chipText, draft.overtime_hourly_rate_mode === mode && styles.chipTextOn]}>
                    {mode === 'auto' ? 'Auto จากฐานเงินเดือน' : 'กำหนดต่อชั่วโมง'}
                  </Text>
                  <Text style={[styles.chipSubText, draft.overtime_hourly_rate_mode === mode && styles.chipSubTextOn]}>
                    {mode === 'auto' ? 'ฐานเงินเดือน / 30 / 8' : 'ใช้ค่า OT ต่อชั่วโมงที่กรอก'}
                  </Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.grid}>
              {renderInput('ตัวคูณ OT', 'overtime_multiplier', '1.5')}
              {draft.overtime_hourly_rate_mode === 'manual'
                ? renderInput('ค่า OT ต่อชั่วโมง', 'overtime_manual_hourly_rate')
                : null}
            </View>
          </View>

          <View style={styles.modeBox}>
            <Text style={styles.label}>ประกันสังคม</Text>
            <View style={styles.chipRow}>
              {(['auto', 'manual'] as const).map((mode) => (
                <Pressable
                  key={mode}
                  style={[styles.chip, draft.social_security_mode === mode && styles.chipOn]}
                  onPress={() => setDraft((prev) => ({ ...prev, social_security_mode: mode }))}>
                  <Text style={[styles.chipText, draft.social_security_mode === mode && styles.chipTextOn]}>
                    {mode === 'auto' ? 'Auto 5% สูงสุด 875' : 'กรอกเอง'}
                  </Text>
                </Pressable>
              ))}
            </View>
            {draft.social_security_mode === 'manual'
              ? renderInput('ยอดประกันสังคมที่หัก', 'social_security_manual_amount')
              : null}
          </View>

          <View style={styles.modeBox}>
            <Text style={styles.label}>หักภาษี ณ ที่จ่าย</Text>
            <View style={styles.chipRow}>
              {(['auto', 'manual'] as const).map((mode) => (
                <Pressable
                  key={mode}
                  style={[styles.chip, draft.withholding_tax_mode === mode && styles.chipOn]}
                  onPress={() => setDraft((prev) => ({ ...prev, withholding_tax_mode: mode }))}>
                  <Text style={[styles.chipText, draft.withholding_tax_mode === mode && styles.chipTextOn]}>
                    {mode === 'auto' ? 'Auto ตามสูตร' : 'กรอกเอง'}
                  </Text>
                </Pressable>
              ))}
            </View>
            {draft.withholding_tax_mode === 'manual'
              ? renderInput('ยอดภาษีที่หัก', 'withholding_tax_manual_amount')
              : null}
          </View>

          <Text style={styles.label}>หมายเหตุ payroll</Text>
          <TextInput
            style={[styles.input, styles.textarea]}
            value={draft.notes}
            onChangeText={(text) => setDraft((prev) => ({ ...prev, notes: text }))}
            placeholder="หมายเหตุสำหรับสลิป"
            placeholderTextColor={c.textMuted}
            multiline
          />

          <View style={styles.actions}>
            <Pressable style={[styles.secondaryBtn, savingComp && styles.disabled]} disabled={savingComp} onPress={() => void saveCompensation()}>
              <Text style={styles.secondaryBtnText}>{savingComp ? 'กำลังบันทึก...' : 'บันทึกฐานเงินเดือน'}</Text>
            </Pressable>
            <Pressable
              style={[
                styles.primaryBtn,
                (generating || !cycleBounds || (!!slip && slip.status !== 'draft')) && styles.disabled,
              ]}
              disabled={generating || !cycleBounds || (!!slip && slip.status !== 'draft')}
              onPress={() => void generateDraftSlip()}>
              <Text style={styles.primaryBtnText}>{generating ? 'กำลังคำนวณ...' : 'คำนวณ Draft'}</Text>
            </Pressable>
            <Pressable
              style={[styles.confirmBtn, (!slip || slip.status !== 'draft' || confirming) && styles.disabled]}
              disabled={!slip || slip.status !== 'draft' || confirming}
              onPress={() => void confirmSlip()}>
              <Text style={styles.confirmBtnText}>{confirming ? 'กำลังยืนยัน...' : 'ยืนยันสลิป'}</Text>
            </Pressable>
            <Pressable
              style={[styles.paidBtn, (!slip || slip.status !== 'confirmed' || markingPaid) && styles.disabled]}
              disabled={!slip || slip.status !== 'confirmed' || markingPaid}
              onPress={() => void markSlipPaid()}>
              <Text style={styles.paidBtnText}>{markingPaid ? 'กำลังบันทึก...' : 'บันทึกจ่ายแล้ว'}</Text>
            </Pressable>
          </View>

          {slip ? (
            <View style={styles.slipBox}>
              <View style={styles.slipHeader}>
                <Text style={styles.slipTitle}>
                  สลิป {slip.cycle_key} · {slipStatusLabel(slip.status)}
                </Text>
                <Text style={styles.netPay}>สุทธิ {money(Number(slip.net_pay || 0))} บาท</Text>
              </View>
              <Text style={styles.sub}>
                รายได้ {money(Number(slip.income_total || 0))} · เงินคืน {money(Number(slip.reimbursement_total || 0))} · รายการหัก {money(Number(slip.deduction_total || 0))}
              </Text>
              <Pressable
                style={[styles.pdfBtn, exportingPdf && styles.disabled]}
                disabled={exportingPdf}
                onPress={() => void printSlipPdf()}>
                {exportingPdf ? (
                  <ActivityIndicator color={c.primaryDark} />
                ) : (
                  <Text style={styles.pdfBtnText}>พิมพ์ / ดาวน์โหลด PDF</Text>
                )}
              </Pressable>
              {slip.status === 'draft' ? (
                <View style={styles.adjustmentBox}>
                  <Text style={styles.itemGroupTitle}>Manual adjustment ก่อนยืนยัน</Text>
                  <Text style={styles.sub}>
                    เพิ่มรายการพิเศษเฉพาะสลิปนี้ เช่น โบนัส หักอื่นๆ หรือเงินคืนเพิ่มเติม
                  </Text>
                  <View style={styles.adjustmentKindRow}>
                    {(['income', 'deduction', 'reimbursement'] as PayrollItemKind[]).map((kind) => {
                      const on = manualAdjustment.item_kind === kind;
                      return (
                        <Pressable
                          key={kind}
                          style={[styles.adjustChip, on && styles.adjustChipOn]}
                          onPress={() =>
                            setManualAdjustment((prev) => ({
                              ...prev,
                              item_kind: kind,
                              taxable: kind === 'income' ? prev.taxable : false,
                            }))
                          }>
                          <Text style={[styles.adjustChipText, on && styles.chipTextOn]}>
                            {manualKindLabel(kind)}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <TextInput
                    style={styles.input}
                    value={manualAdjustment.label}
                    onChangeText={(text) => setManualAdjustment((prev) => ({ ...prev, label: text }))}
                    placeholder="ชื่อรายการ เช่น โบนัสพิเศษ / หักค่าอุปกรณ์"
                    placeholderTextColor={c.textMuted}
                  />
                  <TextInput
                    style={[styles.input, styles.adjustAmountInput]}
                    value={manualAdjustment.amount}
                    onChangeText={(text) => setManualAdjustment((prev) => ({ ...prev, amount: text }))}
                    placeholder="ยอดเงิน"
                    placeholderTextColor={c.textMuted}
                    keyboardType="decimal-pad"
                  />
                  {manualAdjustment.item_kind === 'income' ? (
                    <Pressable
                      style={styles.taxableToggle}
                      onPress={() => setManualAdjustment((prev) => ({ ...prev, taxable: !prev.taxable }))}>
                      <Text style={styles.taxableToggleText}>
                        {manualAdjustment.taxable ? '✓ คิดเป็นรายได้ taxable' : 'ไม่คิดภาษี'}
                      </Text>
                    </Pressable>
                  ) : null}
                  <Pressable
                    style={[styles.secondaryBtn, savingManualAdjustment && styles.disabled]}
                    disabled={savingManualAdjustment}
                    onPress={() => void addManualAdjustment()}>
                    <Text style={styles.secondaryBtnText}>
                      {savingManualAdjustment ? 'กำลังเพิ่ม...' : 'เพิ่มรายการปรับเอง'}
                    </Text>
                  </Pressable>
                </View>
              ) : (
                <View style={styles.lockedSlipBox}>
                  <Text style={styles.lockedSlipTitle}>สลิปนี้ถูกยืนยัน/จ่ายแล้ว</Text>
                  <Text style={styles.lockedSlipText}>
                    หากต้องเพิ่ม OT หรือแก้ยอดหลังพนักงานตรวจสอบแล้ว ให้ยกเลิกสลิปเดิมและออก Draft ใหม่
                    ระบบจะเก็บสลิปเดิมเป็นประวัติ และพนักงานต้องตรวจสอบสลิปฉบับใหม่อีกครั้ง
                  </Text>
                  <Pressable
                    style={styles.historyDangerBtn}
                    onPress={() => setVoidPrompt({ slip, reason: '' })}>
                    <Text style={styles.historyDangerText}>ออก Draft ใหม่เพื่อแก้ไข</Text>
                  </Pressable>
                </View>
              )}
              <PayrollItemGroup
                title="รายได้"
                rows={groupedItems.income}
                editable={slip.status === 'draft'}
                deletingItemId={deletingItemId}
                onDeleteManual={(row) => void deleteManualAdjustment(row)}
              />
              <PayrollItemGroup
                title="รายการหัก"
                rows={groupedItems.deduction}
                editable={slip.status === 'draft'}
                deletingItemId={deletingItemId}
                onDeleteManual={(row) => void deleteManualAdjustment(row)}
              />
              <PayrollItemGroup
                title="เงินคืน/เบิกจ่าย"
                rows={groupedItems.reimbursement}
                editable={slip.status === 'draft'}
                deletingItemId={deletingItemId}
                onDeleteManual={(row) => void deleteManualAdjustment(row)}
              />
            </View>
          ) : (
            <Text style={styles.empty}>ยังไม่มีสลิปรอบนี้ กด “คำนวณ Draft” เพื่อเริ่ม</Text>
          )}
        </>
      ) : (
        <Text style={styles.empty}>ยังไม่มีรายชื่อพนักงานสำหรับ payroll</Text>
      )}
            </ScrollView>
          </View>
        </View>
      </Modal>
      <Modal
        visible={employeePickerOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setEmployeePickerOpen(false)}>
        <View style={styles.pickerBackdrop}>
          <View style={styles.pickerCard}>
            <View style={styles.pickerHeader}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.pickerTitle}>เลือกพนักงาน</Text>
                <Text style={styles.pickerSub}>ค้นหาจากชื่อ ชื่อเล่น อีเมล รหัส หรือเลขบัญชี</Text>
              </View>
              <Pressable style={styles.pickerCloseBtn} onPress={() => setEmployeePickerOpen(false)}>
                <Text style={styles.pickerCloseText}>ปิด</Text>
              </Pressable>
            </View>
            <TextInput
              style={styles.input}
              value={employeeSearch}
              onChangeText={setEmployeeSearch}
              placeholder="ค้นหาพนักงาน"
              placeholderTextColor={c.textMuted}
            />
            <ScrollView style={styles.pickerList} contentContainerStyle={styles.pickerListContent}>
              {filteredProfiles.map((p) => {
                const on = p.id === selectedUserId;
                const display = employeeDisplayByUserId.get(p.id) ?? buildPayrollDisplay(p);
                return (
                  <Pressable
                    key={p.id}
                    style={[styles.pickerEmployeeRow, on && styles.pickerEmployeeRowOn]}
                    onPress={() => {
                      setSelectedUserId(p.id);
                      setEmployeePickerOpen(false);
                    }}>
                    <UserAvatar uri={p.avatar_url} label={display.primary} size={44} />
                    <View style={styles.employeeCardBody}>
                      <Text style={[styles.pickerEmployeeTitle, on && styles.chipTextOn]} numberOfLines={1}>
                        {display.primary}
                      </Text>
                      <Text style={styles.pickerEmployeeSub} numberOfLines={3}>
                        {display.secondary}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
              {filteredProfiles.length === 0 ? (
                <Text style={styles.empty}>ไม่พบพนักงานตามคำค้น</Text>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>
      <Modal
        visible={!!voidPrompt}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!voiding) setVoidPrompt(null);
        }}>
        <View style={styles.pickerBackdrop}>
          <View style={styles.voidCard}>
            <Text style={styles.pickerTitle}>ยกเลิกสลิปและออก Draft ใหม่</Text>
            <Text style={styles.pickerSub}>
              สลิปเดิมจะถูกเก็บเป็น `voided` พร้อม audit log และระบบจะ clone รายการเดิมเป็น Draft ใหม่ให้แก้ไขต่อ
            </Text>
            {voidPrompt ? (
              <View style={styles.voidSummary}>
                <Text style={styles.historyEmployee}>
                  {displayForUserId(voidPrompt.slip.user_id).primary}
                </Text>
                <Text style={styles.historyMeta}>
                  {voidPrompt.slip.cycle_key} · {slipStatusLabel(voidPrompt.slip.status)} · สุทธิ{' '}
                  {money(Number(voidPrompt.slip.net_pay || 0))} บาท
                </Text>
              </View>
            ) : null}
            <Text style={styles.label}>เหตุผลการยกเลิก</Text>
            <TextInput
              style={[styles.input, styles.textarea]}
              value={voidPrompt?.reason ?? ''}
              onChangeText={(text) =>
                setVoidPrompt((prev) => (prev ? { ...prev, reason: text } : prev))
              }
              placeholder="เช่น แก้ยอดรายการหัก / เปลี่ยนบัญชีโอน / แก้ OT"
              placeholderTextColor={c.textMuted}
              multiline
            />
            <View style={styles.actions}>
              <Pressable
                style={[styles.secondaryBtn, voiding && styles.disabled]}
                disabled={voiding}
                onPress={() => setVoidPrompt(null)}>
                <Text style={styles.secondaryBtnText}>ยกเลิก</Text>
              </Pressable>
              <Pressable
                style={[styles.historyDangerBtn, voiding && styles.disabled]}
                disabled={voiding}
                onPress={() => void voidAndReissueSlip()}>
                <Text style={styles.historyDangerText}>
                  {voiding ? 'กำลังดำเนินการ...' : 'ยืนยัน Void + Draft'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function payrollStatusPillStyle(status: PayrollSlipRow['status']) {
  if (status === 'paid') return styles.status_paid;
  if (status === 'confirmed') return styles.status_confirmed;
  if (status === 'voided') return styles.status_voided;
  return styles.status_draft;
}

function PayrollItemGroup({
  title,
  rows,
  editable = false,
  deletingItemId,
  onDeleteManual,
}: {
  title: string;
  rows: PayrollItemRow[];
  editable?: boolean;
  deletingItemId?: string | null;
  onDeleteManual?: (row: PayrollItemRow) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <View style={styles.itemGroup}>
      <Text style={styles.itemGroupTitle}>{title}</Text>
      {rows.map((row) => {
        const manual = isManualAdjustmentItem(row);
        return (
          <View key={row.id} style={styles.itemRow}>
            <Text style={styles.itemLabel}>
              {row.label}
              {row.taxable ? ' · คิดภาษี' : ''}
              {manual ? ' · manual' : ''}
            </Text>
            <View style={styles.itemRight}>
              <Text style={styles.itemAmount}>{money(Number(row.amount || 0))}</Text>
              {editable && manual && onDeleteManual ? (
                <Pressable
                  style={[styles.deleteItemBtn, deletingItemId === row.id && styles.disabled]}
                  disabled={deletingItemId === row.id}
                  onPress={() => onDeleteManual(row)}>
                  <Text style={styles.deleteItemText}>ลบ</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 24,
    padding: 14,
    borderRadius: r.lg,
    backgroundColor: c.surfaceElevated,
    borderWidth: 1,
    borderColor: c.borderSoft,
  },
  title: { fontSize: 18, fontWeight: '800', color: c.text, marginBottom: 6 },
  sub: { fontSize: 12, color: c.textMuted, lineHeight: 18 },
  hint: { marginTop: 6, color: c.primaryDark, fontSize: 12, fontWeight: '700' },
  warn: { marginTop: 6, color: c.error, fontSize: 12, fontWeight: '700' },
  label: { marginTop: 12, marginBottom: 6, color: c.textSecondary, fontSize: 12, fontWeight: '800' },
  input: {
    borderWidth: 1,
    borderColor: c.borderSoft,
    borderRadius: r.sm,
    backgroundColor: c.surfaceMuted,
    color: c.text,
    paddingVertical: 10,
    paddingHorizontal: 12,
    fontSize: 14,
  },
  textarea: { minHeight: 78, textAlignVertical: 'top' },
  monthCardRow: {
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 4,
    paddingRight: 8,
  },
  monthCard: {
    width: 148,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: r.md,
    backgroundColor: c.surfaceMuted,
    borderWidth: 1,
    borderColor: c.borderSoft,
  },
  monthCardOn: {
    backgroundColor: c.primaryLight,
    borderColor: c.primaryMuted,
  },
  monthCardTitle: { color: c.text, fontSize: 12, fontWeight: '900' },
  monthCardTitleOn: { color: c.primaryDark },
  monthCardSub: { marginTop: 3, color: c.textMuted, fontSize: 9, lineHeight: 13 },
  monthCardSubOn: { color: c.textSecondary },
  payrollMenuGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 14,
  },
  payrollMenuCard: {
    flexGrow: 1,
    flexBasis: '47%',
    minHeight: 152,
    padding: 12,
    borderRadius: r.lg,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.borderSoft,
  },
  payrollMenuCardOn: {
    backgroundColor: c.primaryLight,
    borderColor: c.primaryMuted,
  },
  payrollMenuIcon: {
    alignSelf: 'flex-start',
    minWidth: 34,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: c.surfaceMuted,
    color: c.primaryDark,
    fontSize: 15,
    fontWeight: '900',
    textAlign: 'center',
  },
  payrollMenuTitle: { marginTop: 10, color: c.text, fontSize: 14, lineHeight: 18, fontWeight: '900' },
  payrollMenuSub: { marginTop: 6, color: c.textMuted, fontSize: 11, lineHeight: 16 },
  payrollMenuAction: { marginTop: 'auto', paddingTop: 10, color: c.primaryDark, fontSize: 11, fontWeight: '900' },
  historyBox: {
    marginTop: 14,
    gap: 10,
    padding: 12,
    borderRadius: r.lg,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.borderSoft,
  },
  historyHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  historyTitle: { color: c.text, fontSize: 15, fontWeight: '900' },
  historyStatGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  historyStatCard: {
    flexGrow: 1,
    flexBasis: '47%',
    padding: 10,
    borderRadius: r.md,
    backgroundColor: c.surfaceMuted,
    borderWidth: 1,
    borderColor: c.borderSoft,
  },
  historyStatLabel: { color: c.textMuted, fontSize: 11, fontWeight: '800' },
  historyStatValue: { marginTop: 4, color: c.text, fontSize: 14, fontWeight: '900' },
  statusFilterRow: { flexDirection: 'row', gap: 8, paddingRight: 8 },
  statusFilterChip: {
    minHeight: 38,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: c.surfaceMuted,
    borderWidth: 1,
    borderColor: c.borderSoft,
  },
  statusFilterChipOn: { backgroundColor: c.primaryLight, borderColor: c.primaryMuted },
  statusFilterText: { color: c.textSecondary, fontSize: 12, fontWeight: '900' },
  historyList: { gap: 8 },
  historySlipCard: {
    padding: 10,
    borderRadius: r.md,
    backgroundColor: c.surfaceElevated,
    borderWidth: 1,
    borderColor: c.borderSoft,
  },
  historySlipTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  historyEmployee: { color: c.text, fontSize: 14, fontWeight: '900' },
  historyMeta: { marginTop: 3, color: c.textMuted, fontSize: 11, lineHeight: 16 },
  historyMoney: { marginTop: 8, color: c.primaryDark, fontSize: 14, fontWeight: '900' },
  historyReviewText: {
    alignSelf: 'flex-start',
    marginTop: 7,
    paddingVertical: 5,
    paddingHorizontal: 9,
    borderRadius: 999,
    fontSize: 10,
    fontWeight: '900',
    overflow: 'hidden',
  },
  historyReviewOk: { color: c.primaryDark, backgroundColor: c.primaryLight },
  historyReviewPending: { color: c.warningTitle, backgroundColor: c.warningBg },
  historyVoidReason: {
    marginTop: 6,
    padding: 8,
    borderRadius: r.sm,
    color: c.error,
    backgroundColor: c.errorBg,
    fontSize: 11,
    lineHeight: 16,
  },
  historyActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  historyActionBtn: {
    flexGrow: 1,
    alignItems: 'center',
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: c.surfaceMuted,
  },
  historyActionText: { color: c.textSecondary, fontSize: 11, fontWeight: '900' },
  historyDangerBtn: {
    flexGrow: 1,
    alignItems: 'center',
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: c.errorBg,
    borderWidth: 1,
    borderColor: c.error,
  },
  historyDangerText: { color: c.error, fontSize: 11, fontWeight: '900' },
  statusPill: {
    alignSelf: 'flex-start',
    paddingVertical: 5,
    paddingHorizontal: 9,
    borderRadius: 999,
    borderWidth: 1,
  },
  statusPillText: { color: c.textSecondary, fontSize: 10, fontWeight: '900' },
  status_draft: { backgroundColor: c.surfaceMuted, borderColor: c.borderSoft },
  status_confirmed: { backgroundColor: c.accentWarmLight, borderColor: c.accentWarm },
  status_paid: { backgroundColor: c.primaryLight, borderColor: c.primaryMuted },
  status_voided: { backgroundColor: c.errorBg, borderColor: c.error },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingVertical: 4 },
  chip: {
    flexGrow: 1,
    flexBasis: '48%',
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: r.md,
    backgroundColor: c.surfaceMuted,
    borderWidth: 1,
    borderColor: c.borderSoft,
  },
  chipOn: { backgroundColor: c.primaryLight, borderColor: c.primaryMuted },
  employeeCardBody: { flex: 1, minWidth: 0 },
  chipText: { color: c.text, fontSize: 14, fontWeight: '900' },
  chipSubText: { marginTop: 3, color: c.textMuted, fontSize: 11, fontWeight: '600', lineHeight: 16 },
  chipSubTextOn: { color: c.textSecondary },
  chipTextOn: { color: c.primaryDark },
  employeeSelectBtn: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: r.md,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.borderSoft,
  },
  employeeSelectTitle: { color: c.text, fontSize: 14, fontWeight: '900' },
  employeeSelectSub: { marginTop: 3, color: c.textMuted, fontSize: 11, lineHeight: 16 },
  employeeSelectChevron: { color: c.primaryDark, fontSize: 12, fontWeight: '900' },
  employeeSelectPlaceholder: { color: c.textMuted, fontSize: 13, fontWeight: '800' },
  pickerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.62)',
    justifyContent: 'flex-end',
  },
  pickerCard: {
    maxHeight: '86%',
    padding: 14,
    borderTopLeftRadius: r.xl,
    borderTopRightRadius: r.xl,
    backgroundColor: c.surfaceElevated,
    borderWidth: 1,
    borderColor: c.borderSoft,
  },
  payrollDetailSheet: {
    maxHeight: '92%',
    padding: 14,
    borderTopLeftRadius: r.xl,
    borderTopRightRadius: r.xl,
    backgroundColor: c.surfaceElevated,
    borderWidth: 1,
    borderColor: c.borderSoft,
  },
  payrollDetailScroll: { maxHeight: 720 },
  payrollDetailContent: { paddingBottom: 24 },
  voidCard: {
    margin: 14,
    padding: 14,
    borderRadius: r.xl,
    backgroundColor: c.surfaceElevated,
    borderWidth: 1,
    borderColor: c.borderSoft,
  },
  voidSummary: {
    marginTop: 12,
    padding: 10,
    borderRadius: r.md,
    backgroundColor: c.surfaceMuted,
    borderWidth: 1,
    borderColor: c.borderSoft,
  },
  pickerHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 10,
  },
  pickerTitle: { color: c.text, fontSize: 17, fontWeight: '900' },
  pickerSub: { marginTop: 3, color: c.textMuted, fontSize: 11, lineHeight: 16 },
  pickerCloseBtn: {
    paddingVertical: 7,
    paddingHorizontal: 11,
    borderRadius: 999,
    backgroundColor: c.surfaceMuted,
  },
  pickerCloseText: { color: c.textSecondary, fontSize: 12, fontWeight: '900' },
  pickerList: { maxHeight: 520 },
  pickerListContent: { gap: 8, paddingBottom: 18 },
  pickerEmployeeRow: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    borderRadius: r.md,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.borderSoft,
  },
  pickerEmployeeRowOn: {
    backgroundColor: c.primaryLight,
    borderColor: c.primaryMuted,
  },
  pickerEmployeeTitle: { color: c.text, fontSize: 14, fontWeight: '900' },
  pickerEmployeeSub: { marginTop: 3, color: c.textMuted, fontSize: 11, lineHeight: 16 },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  grid: { gap: 8 },
  field: { marginTop: 2 },
  modeBox: {
    marginTop: 12,
    padding: 10,
    borderRadius: r.md,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.borderSoft,
  },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  primaryBtn: {
    flexGrow: 1,
    alignItems: 'center',
    padding: 12,
    borderRadius: r.sm,
    backgroundColor: c.primary,
  },
  primaryBtnText: { color: c.canvas, fontSize: 13, fontWeight: '900' },
  secondaryBtn: {
    flexGrow: 1,
    alignItems: 'center',
    padding: 12,
    borderRadius: r.sm,
    backgroundColor: c.surfaceMuted,
  },
  secondaryBtnText: { color: c.textSecondary, fontSize: 13, fontWeight: '800' },
  confirmBtn: {
    flexGrow: 1,
    alignItems: 'center',
    padding: 12,
    borderRadius: r.sm,
    backgroundColor: c.accentWarm,
  },
  confirmBtnText: { color: c.canvas, fontSize: 13, fontWeight: '900' },
  paidBtn: {
    flexGrow: 1,
    alignItems: 'center',
    padding: 12,
    borderRadius: r.sm,
    backgroundColor: c.primaryDark,
  },
  paidBtnText: { color: c.canvas, fontSize: 13, fontWeight: '900' },
  disabled: { opacity: 0.55 },
  empty: {
    marginTop: 12,
    padding: 12,
    borderRadius: r.sm,
    color: c.textMuted,
    backgroundColor: c.surfaceMuted,
    textAlign: 'center',
    fontSize: 12,
  },
  slipBox: {
    marginTop: 14,
    padding: 12,
    borderRadius: r.md,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.borderSoft,
  },
  slipHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, justifyContent: 'space-between' },
  slipTitle: { flex: 1, minWidth: 0, color: c.text, fontSize: 15, fontWeight: '800' },
  netPay: { color: c.primaryDark, fontSize: 14, fontWeight: '900' },
  pdfBtn: {
    marginTop: 12,
    borderRadius: r.sm,
    backgroundColor: c.primaryLight,
    borderWidth: 1,
    borderColor: c.primaryMuted,
    paddingVertical: 10,
    alignItems: 'center',
  },
  pdfBtnText: { color: c.primaryDark, fontSize: 12, fontWeight: '900' },
  adjustmentBox: {
    marginTop: 12,
    gap: 8,
    padding: 10,
    borderRadius: r.md,
    backgroundColor: c.surfaceMuted,
    borderWidth: 1,
    borderColor: c.borderSoft,
  },
  lockedSlipBox: {
    marginTop: 12,
    gap: 8,
    padding: 10,
    borderRadius: r.md,
    backgroundColor: c.warningBg,
    borderWidth: 1,
    borderColor: c.warningBorder,
  },
  lockedSlipTitle: { color: c.warningTitle, fontSize: 13, fontWeight: '900' },
  lockedSlipText: { color: c.warningBody, fontSize: 11, lineHeight: 16 },
  adjustmentKindRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  adjustChip: {
    flexGrow: 1,
    flexBasis: '31%',
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.borderSoft,
  },
  adjustChipOn: { backgroundColor: c.primaryLight, borderColor: c.primaryMuted },
  adjustChipText: { color: c.textSecondary, fontSize: 12, fontWeight: '900' },
  adjustAmountInput: { marginTop: 0 },
  taxableToggle: {
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.borderSoft,
  },
  taxableToggleText: { color: c.textSecondary, fontSize: 12, fontWeight: '800' },
  itemGroup: { marginTop: 12, gap: 6 },
  itemGroupTitle: { color: c.textSecondary, fontSize: 13, fontWeight: '800' },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: c.borderSoft,
  },
  itemLabel: { flex: 1, minWidth: 0, color: c.text, fontSize: 12 },
  itemRight: { alignItems: 'flex-end', gap: 4 },
  itemAmount: { color: c.textSecondary, fontSize: 12, fontWeight: '800' },
  deleteItemBtn: {
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 999,
    backgroundColor: c.errorBg,
  },
  deleteItemText: { color: c.error, fontSize: 10, fontWeight: '900' },
});
