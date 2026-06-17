import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';
import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import {
  ActivityIndicator,
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
import { AppLoadingScreen } from '@/components/AppLoadingScreen';
import { DatePickerField } from '@/components/DatePickerField';
import { AdminManagerDelegationModal } from '@/components/AdminManagerDelegationModal';
import { AdminPayrollPanel } from '@/components/AdminPayrollPanel';
import { ZoomableImage } from '@/components/ZoomableImage';
import type { AppTheme } from '@/constants/Theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import { useCuteToast } from '@/contexts/CuteToastContext';
import { mergeEmployeeWithProfiles, isUuidLike } from '@/lib/adminEmployeeMerge';
import {
  ANNOUNCEMENT_DEFAULT_DURATION_MS,
  ANNOUNCEMENT_SETTINGS_KEY,
  buildAnnouncementSettingsValue,
  parseAnnouncementSettings,
  type AnnouncementTransitionMode,
} from '@/lib/announcementSlides';
import {
  ATTENDANCE_KPI_SETTINGS_KEY,
  DEFAULT_ATTENDANCE_KPI_SETTINGS,
  parseAttendanceKpiSettings,
  type AttendanceKpiSettings,
} from '@/lib/attendanceKpi';
import { fetchCompanyHolidayDates } from '@/lib/companyHolidays';
import {
  PAYROLL_COMPANY_INFO_KEY,
  parsePayrollCompanyInfo,
} from '@/lib/payrollCompanyInfo';
import {
  computeLateFromAttendanceData,
  payrollPeriodCheckInIsoRange,
  type AssignmentWithShiftTimes,
  type LateActualFromScheduleRow,
} from '@/lib/computeLateFromAttendance';
import { mapBranchInformationRows } from '@/lib/mapBranchInformation';
import { supabase } from '@/lib/supabase';
import { dateToBangkokYmd } from '@/lib/taskHelpers';
import { uploadAnnouncementSlideFromUri } from '@/lib/uploadAnnouncementSlide';
import type {
  AdminEmployeePasswordRow,
  Branch,
  CompanyHolidayDateRow,
  ExpenseClaimItemRow,
  ExpenseClaimRow,
  Profile,
  SalaryClaimRow,
  WorkScheduleRow,
} from '@/lib/types';
const BREAK_START_KEY = 'attendance_break_start_messages';
const BREAK_END_KEY = 'attendance_break_end_messages';
const LEAVE_PROMPT_KEY = 'attendance_leave_prompt_messages';
const HOLIDAY_PROMPT_KEY = 'attendance_holiday_prompt_messages';
const OVERTIME_PROMPT_SETTINGS_KEY = 'attendance_overtime_prompt_settings';
const DEFAULT_OVERTIME_PROMPT_SETTINGS = {
  prompt_after_minutes: 15,
  auto_checkout_after_minutes: 30,
};
type ClaimStatus = SalaryClaimRow['status'];
type ClaimHistoryKind = 'salary' | 'expense';
type ClaimHistoryStatusFilter = 'all' | Exclude<ClaimStatus, 'pending'>;
type ExpensePayrollHandling = ExpenseClaimRow['payroll_handling'];
type LateRankSortMode = 'count' | 'minutes';
type AdminSectionKey =
  | 'announcements'
  | 'employees'
  | 'managers'
  | 'salaryClaims'
  | 'expenseClaims'
  | 'payroll'
  | 'branches'
  | 'breakMessages'
  | 'companyHolidays'
  | 'kpi';
type EmployeeConfirmAction = {
  kind: 'resign' | 'delete';
  row: AdminEmployeePasswordRow;
};
const ADMIN_SECTIONS: Array<{
  key: AdminSectionKey;
  no: string;
  title: string;
  subtitle: string;
  icon: ComponentProps<typeof FontAwesome>['name'];
}> = [
  {
    key: 'announcements',
    no: '1',
    title: 'รูปประกาศหน้าเข้า-ออกงาน',
    subtitle: 'สไลด์และรูปหน้า attendance',
    icon: 'image',
  },
  {
    key: 'employees',
    no: '2',
    title: 'พนักงาน',
    subtitle: 'employee + profiles',
    icon: 'users',
  },
  {
    key: 'managers',
    no: '3',
    title: 'ผู้จัดการ',
    subtitle: 'สิทธิ์ & ลูกทีม',
    icon: 'sitemap',
  },
  {
    key: 'salaryClaims',
    no: '4',
    title: 'คำขอเบิกเงินเดือน',
    subtitle: 'Claim Salary',
    icon: 'credit-card',
  },
  {
    key: 'expenseClaims',
    no: '5',
    title: 'คำขอเบิกเงิน',
    subtitle: 'Expense Claim',
    icon: 'file-text-o',
  },
  {
    key: 'payroll',
    no: '6',
    title: 'Payroll / สลิปเงินเดือน',
    subtitle: 'ฐานเงินเดือนและสลิป',
    icon: 'money',
  },
  {
    key: 'branches',
    no: '7',
    title: 'สาขา',
    subtitle: 'branch_information',
    icon: 'map-marker',
  },
  {
    key: 'breakMessages',
    no: '8',
    title: 'ข้อความการ์ดพักเบรก',
    subtitle: 'ข้อความ popup พัก/กลับงาน/ลา',
    icon: 'coffee',
  },
  {
    key: 'companyHolidays',
    no: '9',
    title: 'วันหยุดประจำปีบริษัท',
    subtitle: 'ตั้งวันหยุดบริษัทแสดงในปฏิทิน',
    icon: 'calendar',
  },
  {
    key: 'kpi',
    no: '10',
    title: 'ตั้งค่าระบบ',
    subtitle: 'KPI, OT และ JSON ระบบ',
    icon: 'sliders',
  },
];
const CLAIM_HISTORY_STATUS_FILTERS: ClaimHistoryStatusFilter[] = [
  'all',
  'approved',
  'rejected',
  'paid',
];
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
  label: string;
  value: number;
  sub?: string;
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
type AnnouncementDraftItem =
  | { key: string; kind: 'saved'; url: string; durationSeconds: string }
  | { key: string; kind: 'pending'; localUri: string; durationSeconds: string };
type KpiDraftSection = 'personalNotice' | 'sickNotice' | 'vacationNotice' | 'late';
type KpiSettingsDraft = {
  leaveMaxScore: string;
  lateMaxScore: string;
  personalNotice: Record<string, string>;
  sickNotice: Record<string, string>;
  vacationNotice: Record<string, string>;
  late: Record<string, string>;
};
type KpiFormField = {
  section: 'root' | KpiDraftSection;
  key: string;
  label: string;
  hint?: string;
};
type KpiFormGroup = {
  title: string;
  description: string;
  rows: Array<{
    title?: string;
    fields: KpiFormField[];
  }>;
};

const KPI_FORM_GROUPS: KpiFormGroup[] = [
  {
    title: 'คะแนนเต็ม',
    description: 'กำหนดคะแนนเต็มต่อไตรมาสของหมวดลาและหมวดมาสาย',
    rows: [
      {
        fields: [
          { section: 'root', key: 'leaveMaxScore', label: 'คะแนนเต็มหมวดลา' },
          { section: 'root', key: 'lateMaxScore', label: 'คะแนนเต็มหมวดขอเข้าสาย/มาสาย' },
        ],
      },
    ],
  },
  {
    title: 'ลากิจ: เกณฑ์แจ้งล่วงหน้า',
    description: 'ระบบคิดจำนวนวันจากเวลาที่ส่งคำขอถึงเวลาเริ่มงานของวันลา',
    rows: [
      {
        title: 'ดีมาก',
        fields: [
          { section: 'personalNotice', key: 'goodDays', label: 'แจ้งล่วงหน้าอย่างน้อย (วัน)' },
          { section: 'personalNotice', key: 'penaltyBelowGood', label: 'หักคะแนนเมื่อต่ำกว่าดีมาก' },
        ],
      },
      {
        title: 'ปานกลาง',
        fields: [
          { section: 'personalNotice', key: 'midDays', label: 'แจ้งล่วงหน้าอย่างน้อย (วัน)' },
          { section: 'personalNotice', key: 'penaltyBelowMid', label: 'หักคะแนนเมื่อต่ำกว่าปานกลาง' },
        ],
      },
      {
        title: 'ขั้นต่ำ',
        fields: [
          { section: 'personalNotice', key: 'lowDays', label: 'แจ้งล่วงหน้าอย่างน้อย (วัน)' },
          { section: 'personalNotice', key: 'penaltyBelowLow', label: 'หักคะแนนเมื่อต่ำกว่าขั้นต่ำ' },
        ],
      },
    ],
  },
  {
    title: 'ลาป่วย: เกณฑ์แจ้งล่วงหน้า',
    description: 'ใช้เปรียบเทียบเวลาส่งคำขอกับเวลาเริ่มงานของวันลา',
    rows: [
      {
        fields: [
          { section: 'sickNotice', key: 'minHours', label: 'ต้องแจ้งล่วงหน้าอย่างน้อย (ชั่วโมง)' },
          { section: 'sickNotice', key: 'penaltyBelowMin', label: 'หักคะแนนถ้าแจ้งน้อยกว่ากำหนด' },
        ],
      },
    ],
  },
  {
    title: 'ลาพักร้อน: เกณฑ์แจ้งล่วงหน้า',
    description: 'ระบบคิดจำนวนวันจากเวลาที่ส่งคำขอถึงเวลาเริ่มงานของวันลา',
    rows: [
      {
        title: 'ดีมาก',
        fields: [
          { section: 'vacationNotice', key: 'goodDays', label: 'แจ้งล่วงหน้าอย่างน้อย (วัน)' },
          { section: 'vacationNotice', key: 'penaltyBelowGood', label: 'หักคะแนนเมื่อต่ำกว่าดีมาก' },
        ],
      },
      {
        title: 'ปานกลาง',
        fields: [
          { section: 'vacationNotice', key: 'midDays', label: 'แจ้งล่วงหน้าอย่างน้อย (วัน)' },
          { section: 'vacationNotice', key: 'penaltyBelowMid', label: 'หักคะแนนเมื่อต่ำกว่าปานกลาง' },
        ],
      },
      {
        title: 'ขั้นต่ำ',
        fields: [
          { section: 'vacationNotice', key: 'lowDays', label: 'แจ้งล่วงหน้าอย่างน้อย (วัน)' },
          { section: 'vacationNotice', key: 'penaltyBelowLow', label: 'หักคะแนนเมื่อต่ำกว่าขั้นต่ำ' },
        ],
      },
    ],
  },
  {
    title: 'ขอเข้าสาย / มาสายจริง',
    description: 'กำหนดช่วงจำนวนครั้ง/นาทีรวมในไตรมาส และคะแนนที่หักตามระดับ',
    rows: [
      {
        title: 'ระดับแรก',
        fields: [
          { section: 'late', key: 'firstMinCount', label: 'จำนวนครั้งขั้นต่ำ' },
          { section: 'late', key: 'firstMaxCount', label: 'จำนวนครั้งสูงสุด' },
          { section: 'late', key: 'firstMaxMinutes', label: 'นาทีรวมสูงสุด' },
          { section: 'late', key: 'firstPenalty', label: 'คะแนนที่หัก' },
        ],
      },
      {
        title: 'ระดับสอง',
        fields: [
          { section: 'late', key: 'secondMaxCount', label: 'จำนวนครั้งสูงสุด' },
          { section: 'late', key: 'secondMaxMinutes', label: 'นาทีรวมสูงสุด' },
          { section: 'late', key: 'secondPenalty', label: 'คะแนนที่หัก' },
        ],
      },
      {
        title: 'รุนแรง',
        fields: [
          { section: 'late', key: 'severeCountOver', label: 'จำนวนครั้งเกิน' },
          { section: 'late', key: 'severeMinutesOver', label: 'นาทีรวมเกิน' },
          { section: 'late', key: 'severePenalty', label: 'คะแนนที่หัก' },
        ],
      },
    ],
  },
];

function newDraftKey(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function announcementDurationSecondsText(durationMs?: number): string {
  const ms =
    typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs > 0
      ? durationMs
      : ANNOUNCEMENT_DEFAULT_DURATION_MS;
  return String(Math.max(1, Math.round(ms / 1000)));
}

function announcementDurationMsFromText(text: string): number {
  const n = Number(text.trim());
  if (!Number.isFinite(n) || n <= 0) return ANNOUNCEMENT_DEFAULT_DURATION_MS;
  return Math.round(n * 1000);
}

function claimStatusLabelTh(status: ClaimStatus | 'all'): string {
  switch (status) {
    case 'all':
      return 'ทั้งหมด';
    case 'pending':
      return 'รอดำเนินการ';
    case 'approved':
      return 'อนุมัติแล้ว';
    case 'rejected':
      return 'ปฏิเสธแล้ว';
    case 'paid':
      return 'จ่ายแล้ว';
    default:
      return status;
  }
}

function expensePayrollHandlingLabelTh(
  handling: ExpensePayrollHandling | null | undefined
): string {
  if (handling === 'payroll') return 'ลง Payroll / สลิปเงินเดือน';
  if (handling === 'direct') return 'จ่ายแยก ไม่ลงเงินเดือน';
  return 'ยังไม่ได้เลือกวิธีจ่าย';
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

function formatCompanyHolidayDateTh(ymd: string): string {
  return new Intl.DateTimeFormat('th-TH-u-ca-gregory-nu-latn', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${ymd}T12:00:00+07:00`));
}

function bangkokYmdFromIso(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
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
    const r = row as {
      id?: string;
      user_id?: string;
      work_date?: string;
      work_shifts?: unknown;
    };
    let ws = r.work_shifts as AssignmentWithShiftTimes['work_shifts'] | null;
    if (Array.isArray(r.work_shifts)) {
      ws = (r.work_shifts[0] as AssignmentWithShiftTimes['work_shifts']) ?? null;
    }
    if (!r.id || !r.user_id || !r.work_date) continue;
    parsed.push({
      id: String(r.id),
      user_id: String(r.user_id),
      work_date: String(r.work_date),
      work_shifts: ws,
    });
  }
  return parsed;
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

function clampMinuteSetting(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(240, Math.round(n)));
}

function parseOvertimePromptSettings(raw: unknown): typeof DEFAULT_OVERTIME_PROMPT_SETTINGS {
  if (!raw || typeof raw !== 'object') return DEFAULT_OVERTIME_PROMPT_SETTINGS;
  const obj = raw as {
    prompt_after_minutes?: unknown;
    auto_checkout_after_minutes?: unknown;
  };
  const promptAfter = clampMinuteSetting(
    obj.prompt_after_minutes,
    DEFAULT_OVERTIME_PROMPT_SETTINGS.prompt_after_minutes
  );
  const autoCheckout = Math.max(
    promptAfter,
    clampMinuteSetting(
      obj.auto_checkout_after_minutes,
      DEFAULT_OVERTIME_PROMPT_SETTINGS.auto_checkout_after_minutes
    )
  );
  return {
    prompt_after_minutes: promptAfter,
    auto_checkout_after_minutes: autoCheckout,
  };
}

function kpiDraftFromSettings(settings: AttendanceKpiSettings): KpiSettingsDraft {
  return {
    leaveMaxScore: String(settings.leaveMaxScore),
    lateMaxScore: String(settings.lateMaxScore),
    personalNotice: {
      goodDays: String(settings.personalNotice.goodDays),
      midDays: String(settings.personalNotice.midDays),
      lowDays: String(settings.personalNotice.lowDays),
      penaltyBelowGood: String(settings.personalNotice.penaltyBelowGood),
      penaltyBelowMid: String(settings.personalNotice.penaltyBelowMid),
      penaltyBelowLow: String(settings.personalNotice.penaltyBelowLow),
    },
    sickNotice: {
      minHours: String(settings.sickNotice.minHours),
      penaltyBelowMin: String(settings.sickNotice.penaltyBelowMin),
    },
    vacationNotice: {
      goodDays: String(settings.vacationNotice.goodDays),
      midDays: String(settings.vacationNotice.midDays),
      lowDays: String(settings.vacationNotice.lowDays),
      penaltyBelowGood: String(settings.vacationNotice.penaltyBelowGood),
      penaltyBelowMid: String(settings.vacationNotice.penaltyBelowMid),
      penaltyBelowLow: String(settings.vacationNotice.penaltyBelowLow),
    },
    late: {
      firstMinCount: String(settings.late.firstMinCount),
      firstMaxCount: String(settings.late.firstMaxCount),
      firstMaxMinutes: String(settings.late.firstMaxMinutes),
      firstPenalty: String(settings.late.firstPenalty),
      secondMaxCount: String(settings.late.secondMaxCount),
      secondMaxMinutes: String(settings.late.secondMaxMinutes),
      secondPenalty: String(settings.late.secondPenalty),
      severeCountOver: String(settings.late.severeCountOver),
      severeMinutesOver: String(settings.late.severeMinutesOver),
      severePenalty: String(settings.late.severePenalty),
    },
  };
}

function nonNegativeDraftNumber(raw: string, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, n);
}

function kpiSettingsFromDraft(draft: KpiSettingsDraft): AttendanceKpiSettings {
  const d = DEFAULT_ATTENDANCE_KPI_SETTINGS;
  return {
    leaveMaxScore: nonNegativeDraftNumber(draft.leaveMaxScore, d.leaveMaxScore),
    lateMaxScore: nonNegativeDraftNumber(draft.lateMaxScore, d.lateMaxScore),
    personalNotice: {
      goodDays: nonNegativeDraftNumber(draft.personalNotice.goodDays, d.personalNotice.goodDays),
      midDays: nonNegativeDraftNumber(draft.personalNotice.midDays, d.personalNotice.midDays),
      lowDays: nonNegativeDraftNumber(draft.personalNotice.lowDays, d.personalNotice.lowDays),
      penaltyBelowGood: nonNegativeDraftNumber(
        draft.personalNotice.penaltyBelowGood,
        d.personalNotice.penaltyBelowGood
      ),
      penaltyBelowMid: nonNegativeDraftNumber(
        draft.personalNotice.penaltyBelowMid,
        d.personalNotice.penaltyBelowMid
      ),
      penaltyBelowLow: nonNegativeDraftNumber(
        draft.personalNotice.penaltyBelowLow,
        d.personalNotice.penaltyBelowLow
      ),
    },
    sickNotice: {
      minHours: nonNegativeDraftNumber(draft.sickNotice.minHours, d.sickNotice.minHours),
      penaltyBelowMin: nonNegativeDraftNumber(
        draft.sickNotice.penaltyBelowMin,
        d.sickNotice.penaltyBelowMin
      ),
    },
    vacationNotice: {
      goodDays: nonNegativeDraftNumber(draft.vacationNotice.goodDays, d.vacationNotice.goodDays),
      midDays: nonNegativeDraftNumber(draft.vacationNotice.midDays, d.vacationNotice.midDays),
      lowDays: nonNegativeDraftNumber(draft.vacationNotice.lowDays, d.vacationNotice.lowDays),
      penaltyBelowGood: nonNegativeDraftNumber(
        draft.vacationNotice.penaltyBelowGood,
        d.vacationNotice.penaltyBelowGood
      ),
      penaltyBelowMid: nonNegativeDraftNumber(
        draft.vacationNotice.penaltyBelowMid,
        d.vacationNotice.penaltyBelowMid
      ),
      penaltyBelowLow: nonNegativeDraftNumber(
        draft.vacationNotice.penaltyBelowLow,
        d.vacationNotice.penaltyBelowLow
      ),
    },
    late: {
      firstMinCount: nonNegativeDraftNumber(draft.late.firstMinCount, d.late.firstMinCount),
      firstMaxCount: nonNegativeDraftNumber(draft.late.firstMaxCount, d.late.firstMaxCount),
      firstMaxMinutes: nonNegativeDraftNumber(
        draft.late.firstMaxMinutes,
        d.late.firstMaxMinutes
      ),
      firstPenalty: nonNegativeDraftNumber(draft.late.firstPenalty, d.late.firstPenalty),
      secondMaxCount: nonNegativeDraftNumber(draft.late.secondMaxCount, d.late.secondMaxCount),
      secondMaxMinutes: nonNegativeDraftNumber(
        draft.late.secondMaxMinutes,
        d.late.secondMaxMinutes
      ),
      secondPenalty: nonNegativeDraftNumber(draft.late.secondPenalty, d.late.secondPenalty),
      severeCountOver: nonNegativeDraftNumber(draft.late.severeCountOver, d.late.severeCountOver),
      severeMinutesOver: nonNegativeDraftNumber(
        draft.late.severeMinutesOver,
        d.late.severeMinutesOver
      ),
      severePenalty: nonNegativeDraftNumber(draft.late.severePenalty, d.late.severePenalty),
    },
  };
}

function getKpiDraftField(draft: KpiSettingsDraft, field: KpiFormField): string {
  if (field.section === 'root') {
    return field.key === 'lateMaxScore' ? draft.lateMaxScore : draft.leaveMaxScore;
  }
  return draft[field.section][field.key] ?? '';
}

export default function AdminScreen() {
  const toast = useCuteToast();
  const { session } = useAuth();
  const { theme } = useAppTheme();
  const c = theme.colors;
  const styles = useMemo(() => createAdminStyles(theme), [theme]);
  const [activeSection, setActiveSection] = useState<AdminSectionKey | null>(null);
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
  const [announcementTransitionMode, setAnnouncementTransitionMode] =
    useState<AnnouncementTransitionMode>('slide');
  const [breakStartLines, setBreakStartLines] = useState<string[]>(['']);
  const [breakEndLines, setBreakEndLines] = useState<string[]>(['']);
  const [leavePromptLines, setLeavePromptLines] = useState<string[]>(['']);
  const [holidayPromptLines, setHolidayPromptLines] = useState<string[]>(['']);
  const [companyHolidays, setCompanyHolidays] = useState<CompanyHolidayDateRow[]>([]);
  const [companyHolidaysLoading, setCompanyHolidaysLoading] = useState(false);
  const [companyHolidayFormOpen, setCompanyHolidayFormOpen] = useState(false);
  const [companyHolidayEditId, setCompanyHolidayEditId] = useState<string | null>(null);
  const [companyHolidayDate, setCompanyHolidayDate] = useState<Date | null>(null);
  const [companyHolidayTitle, setCompanyHolidayTitle] = useState('');
  const [companyHolidayDescription, setCompanyHolidayDescription] = useState('');
  const [companyHolidaySaving, setCompanyHolidaySaving] = useState(false);
  const [kpiSettingsDraft, setKpiSettingsDraft] = useState(() =>
    kpiDraftFromSettings(DEFAULT_ATTENDANCE_KPI_SETTINGS)
  );
  const [kpiSettingsSaving, setKpiSettingsSaving] = useState(false);
  const [otPromptAfterMinutes, setOtPromptAfterMinutes] = useState(
    String(DEFAULT_OVERTIME_PROMPT_SETTINGS.prompt_after_minutes)
  );
  const [otAutoCheckoutAfterMinutes, setOtAutoCheckoutAfterMinutes] = useState(
    String(DEFAULT_OVERTIME_PROMPT_SETTINGS.auto_checkout_after_minutes)
  );
  const [otPromptSettingsSaving, setOtPromptSettingsSaving] = useState(false);
  const [payrollCompanyName, setPayrollCompanyName] = useState('');
  const [payrollCompanyAddressText, setPayrollCompanyAddressText] = useState('');
  const [payrollCompanyJuristicId, setPayrollCompanyJuristicId] = useState('');
  const [payrollCompanySaving, setPayrollCompanySaving] = useState(false);
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
  const [expenseApprovalPrompt, setExpenseApprovalPrompt] =
    useState<ExpenseClaimRow | null>(null);
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [employeeActionBusyId, setEmployeeActionBusyId] = useState<string | null>(null);
  const [employeeConfirmAction, setEmployeeConfirmAction] =
    useState<EmployeeConfirmAction | null>(null);
  const [claimHistoryKind, setClaimHistoryKind] = useState<ClaimHistoryKind | null>(null);
  const [claimHistoryStatusFilter, setClaimHistoryStatusFilter] =
    useState<ClaimHistoryStatusFilter>('all');
  const [claimMonthFilter, setClaimMonthFilter] = useState(monthKeyOf(new Date()));
  const [claimDateFrom, setClaimDateFrom] = useState('');
  const [claimDateTo, setClaimDateTo] = useState('');
  const [datePickerTarget, setDatePickerTarget] = useState<'from' | 'to' | null>(null);
  const [analyticsMonthFilter, setAnalyticsMonthFilter] = useState(monthKeyOf(new Date()));
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);
  const [lateRankSortMode, setLateRankSortMode] = useState<LateRankSortMode>('count');
  const [workAnalytics, setWorkAnalytics] = useState<WorkAnalyticsData>({
    wellbeingRows: [],
    lateRows: [],
    sickLeaveRows: [],
  });
  const analyticsMonthChoices = useMemo(() => analyticsMonthOptions(18), []);

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
      { data: leavePromptRow },
      { data: holidayPromptRow },
      { data: kpiRow },
      { data: otPromptRow },
      { data: payrollCompanyRow },
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
          .eq('key', LEAVE_PROMPT_KEY)
          .maybeSingle(),
        supabase
          .from('app_settings')
          .select('value')
          .eq('key', HOLIDAY_PROMPT_KEY)
          .maybeSingle(),
        supabase
          .from('app_settings')
          .select('value')
          .eq('key', ATTENDANCE_KPI_SETTINGS_KEY)
          .maybeSingle(),
        supabase
          .from('app_settings')
          .select('value')
          .eq('key', OVERTIME_PROMPT_SETTINGS_KEY)
          .maybeSingle(),
        supabase
          .from('app_settings')
          .select('value')
          .eq('key', PAYROLL_COMPANY_INFO_KEY)
          .maybeSingle(),
      ]);
    const annParsed = parseAnnouncementSettings(annRow?.value);
    setAnnouncementSlideHeightPx(annParsed.slideHeightPx);
    setAnnouncementTransitionMode(annParsed.transitionMode);
    setAnnouncementItems(
      annParsed.slides.map((slide, i) => ({
        key: newDraftKey(`s${i}`),
        kind: 'saved' as const,
        url: slide.url,
        durationSeconds: announcementDurationSecondsText(slide.durationMs),
      }))
    );
    setBreakStartLines(breakMessagesToEditorLines(breakStartRow?.value));
    setBreakEndLines(breakMessagesToEditorLines(breakEndRow?.value));
    setLeavePromptLines(breakMessagesToEditorLines(leavePromptRow?.value));
    setHolidayPromptLines(breakMessagesToEditorLines(holidayPromptRow?.value));
    setKpiSettingsDraft(kpiDraftFromSettings(parseAttendanceKpiSettings(kpiRow?.value)));
    const otPromptSettings = parseOvertimePromptSettings(otPromptRow?.value);
    setOtPromptAfterMinutes(String(otPromptSettings.prompt_after_minutes));
    setOtAutoCheckoutAfterMinutes(String(otPromptSettings.auto_checkout_after_minutes));
    const payrollCompanyInfo = parsePayrollCompanyInfo(payrollCompanyRow?.value);
    setPayrollCompanyName(payrollCompanyInfo.name);
    setPayrollCompanyAddressText(payrollCompanyInfo.addressLines.join('\n'));
    setPayrollCompanyJuristicId(payrollCompanyInfo.juristicId);
  }, [fetchAdminEmployeePasswordList]);

  const analyticsPeriod = useMemo(
    () => attendancePeriodFromMonthKey(analyticsMonthFilter),
    [analyticsMonthFilter]
  );

  const loadWorkAnalytics = useCallback(async () => {
    const { fromIso, toIso } = payrollPeriodCheckInIsoRange(
      analyticsPeriod.from,
      analyticsPeriod.to
    );
    setAnalyticsLoading(true);
    setAnalyticsError(null);
    try {
      const [
        wellbeingRes,
        assignmentRes,
        legacyScheduleRes,
        checkInRes,
        lateRequestRes,
        sickLeaveRes,
      ] = await Promise.all([
        supabase
          .from('wellbeing_checkins')
          .select('user_id, score, created_at')
          .gte('created_at', fromIso)
          .lte('created_at', toIso)
          .order('created_at', { ascending: true }),
        supabase
          .from('work_schedule_assignments')
          .select('id, user_id, work_date, work_shifts(name, start_time, end_time)')
          .gte('work_date', analyticsPeriod.from)
          .lte('work_date', analyticsPeriod.to)
          .order('work_date', { ascending: true }),
        supabase
          .from('work_schedules')
          .select('id, user_id, start_at, end_at, title, created_by')
          .lte('start_at', toIso)
          .gte('end_at', fromIso)
          .order('start_at', { ascending: true }),
        supabase
          .from('attendance_logs')
          .select('user_id, created_at')
          .eq('kind', 'check_in')
          .gte('created_at', fromIso)
          .lte('created_at', toIso)
          .order('created_at', { ascending: true }),
        supabase
          .from('late_requests')
          .select('user_id, work_date, minutes_late')
          .gte('work_date', analyticsPeriod.from)
          .lte('work_date', analyticsPeriod.to),
        supabase
          .from('leave_requests')
          .select('user_id, leave_type, starts_on, ends_on, status')
          .eq('leave_type', 'sick')
          .eq('status', 'approved')
          .lte('starts_on', analyticsPeriod.to)
          .gte('ends_on', analyticsPeriod.from)
          .order('starts_on', { ascending: true }),
      ]);
      if (wellbeingRes.error) throw new Error(wellbeingRes.error.message);
      if (assignmentRes.error) throw new Error(assignmentRes.error.message);
      if (legacyScheduleRes.error) throw new Error(legacyScheduleRes.error.message);
      if (checkInRes.error) throw new Error(checkInRes.error.message);
      if (lateRequestRes.error) throw new Error(lateRequestRes.error.message);
      if (sickLeaveRes.error) throw new Error(sickLeaveRes.error.message);
      const assignments = parseAssignmentRowsWithUser((assignmentRes.data as unknown[]) ?? []);
      const legacySchedules = (legacyScheduleRes.data as WorkScheduleRow[]) ?? [];
      const checkIns =
        (checkInRes.data as Array<{ user_id: string; created_at: string }>) ?? [];
      const lateRequests =
        (lateRequestRes.data as Array<{
          user_id: string;
          work_date: string;
          minutes_late: number;
        }>) ?? [];
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
        wellbeingRows: (wellbeingRes.data as WorkAnalyticsData['wellbeingRows']) ?? [],
        lateRows,
        sickLeaveRows: (sickLeaveRes.data as WorkAnalyticsData['sickLeaveRows']) ?? [],
      });
    } catch (e) {
      setAnalyticsError(e instanceof Error ? e.message : String(e));
      setWorkAnalytics({ wellbeingRows: [], lateRows: [], sickLeaveRows: [] });
    } finally {
      setAnalyticsLoading(false);
    }
  }, [analyticsPeriod.from, analyticsPeriod.to]);

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
    const noteDraft = salaryReviewNotes[row.id];
    const note = noteDraft === undefined ? row.review_note : noteDraft.trim() || null;
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
    toast.success(
      'อัปเดตสถานะแล้ว',
      `คำขอเบิกเงินเดือนถูกย้ายไปประวัติ (${claimStatusLabelTh(status)})`
    );
  }

  async function updateExpenseClaimStatus(
    row: ExpenseClaimRow,
    status: 'approved' | 'rejected' | 'paid',
    payrollHandling?: ExpensePayrollHandling
  ) {
    const busyKey = `expense-${row.id}-${status}`;
    setClaimActionBusyKey(busyKey);
    const noteDraft = expenseReviewNotes[row.id];
    const note = noteDraft === undefined ? row.review_note : noteDraft.trim() || null;
    const actorId = session?.user?.id ?? null;
    const reviewedAt = new Date().toISOString();
    const handlingDecided = payrollHandling === 'payroll' || payrollHandling === 'direct';
    const { error } = await supabase
      .from('expense_claims')
      .update({
        status,
        review_note: note,
        reviewed_at: reviewedAt,
        reviewed_by: actorId,
        ...(handlingDecided
          ? {
              payroll_handling: payrollHandling,
              payroll_handling_decided_by: actorId,
              payroll_handling_decided_at: reviewedAt,
            }
          : {}),
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
              ...(handlingDecided
                ? {
                    payroll_handling: payrollHandling,
                    payroll_handling_decided_by: actorId,
                    payroll_handling_decided_at: reviewedAt,
                  }
                : {}),
            }
          : it
      )
    );
    setClaimActionBusyKey(null);
    toast.success(
      'อัปเดตสถานะแล้ว',
      `คำขอเบิกค่าใช้จ่ายถูกย้ายไปประวัติ (${claimStatusLabelTh(status)})`
    );
  }

  async function approveExpenseClaimWithHandling(
    handling: Extract<ExpensePayrollHandling, 'payroll' | 'direct'>
  ) {
    const claim = expenseApprovalPrompt;
    if (!claim) return;
    const nextStatus: 'approved' | 'paid' = handling === 'payroll' ? 'approved' : 'paid';
    setExpenseApprovalPrompt(null);
    await updateExpenseClaimStatus(claim, nextStatus, handling);
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
  const activeSectionMeta = useMemo(
    () => ADMIN_SECTIONS.find((section) => section.key === activeSection) ?? null,
    [activeSection]
  );

  const employeeNameByProfile = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of profiles) {
      map.set(p.id, p.full_name?.trim() || p.email?.trim() || p.id.slice(0, 8));
    }
    for (const row of mergedEmployeeRows) {
      if (!row.profile?.id) continue;
      const nickname = String((row.employee as { nickname?: unknown }).nickname ?? '').trim();
      const display = row.employee.display_name?.trim();
      const profileName = row.profile.full_name?.trim() || row.profile.email?.trim();
      map.set(row.profile.id, nickname || display || profileName || row.profile.id.slice(0, 8));
    }
    return map;
  }, [mergedEmployeeRows, profiles]);

  const workAnalyticsSummary = useMemo(() => {
    const days = enumerateYmdRange(analyticsPeriod.from, analyticsPeriod.to);
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
        name: employeeNameByProfile.get(userId) ?? userId.slice(0, 8),
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
      label: shortThaiDayLabel(ymd),
      value: sickDaily.get(ymd) ?? 0,
    }));
    const topSickLeaveEmployees: RankRow[] = [...sickRank.entries()]
      .map(([userId, value]) => ({
        userId,
        name: employeeNameByProfile.get(userId) ?? userId.slice(0, 8),
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
    workAnalytics.lateRows,
    workAnalytics.sickLeaveRows,
    workAnalytics.wellbeingRows,
  ]);

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

  const closeEmployeeConfirmAction = useCallback(() => {
    if (employeeActionBusyId !== null) return;
    setEmployeeConfirmAction(null);
  }, [employeeActionBusyId]);

  const employeeConfirmTitle =
    employeeConfirmAction?.kind === 'delete' ? 'ลบข้อมูลพนักงาน?' : 'บันทึกการลาออก?';
  const employeeConfirmMessage =
    employeeConfirmAction?.kind === 'delete'
      ? 'จะลบแถวใน employee ถาวร — ข้อมูลที่อ้างอิง employee จะถูกปลดตามกฎ FK เช่น profiles.employee_id แต่บัญชี Auth ไม่ถูกลบ'
      : 'จะบันทึกประวัติใน employee_resignations และตั้ง employee.status เป็นลาออก';
  const employeeConfirmName = employeeConfirmAction
    ? [
        employeeConfirmAction.row.employee_no
          ? `#${employeeConfirmAction.row.employee_no}`
          : null,
        employeeConfirmAction.row.display_name?.trim() || employeeConfirmAction.row.legacy_user_id,
      ]
        .filter(Boolean)
        .join(' · ')
    : '';
  const employeeConfirmBusy =
    employeeConfirmAction != null && employeeActionBusyId === employeeConfirmAction.row.id;
  const employeeConfirmDanger = employeeConfirmAction?.kind === 'delete';

  function confirmDeleteEmployee(row: AdminEmployeePasswordRow) {
    setEmployeeConfirmAction({ kind: 'delete', row });
  }

  function confirmResignEmployee(row: AdminEmployeePasswordRow) {
    setEmployeeConfirmAction({ kind: 'resign', row });
  }

  async function runEmployeeConfirmAction() {
    if (!employeeConfirmAction || employeeConfirmBusy) return;
    const { kind, row } = employeeConfirmAction;
    if (kind === 'delete') {
      await deleteEmployeeRecord(row);
    } else {
      await resignEmployeeRecord(row);
    }
    setEmployeeConfirmAction(null);
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
    () => salaryClaims.filter((row) => row.status === 'pending'),
    [salaryClaims]
  );

  const filteredExpenseClaims = useMemo(
    () => expenseClaims.filter((row) => row.status === 'pending'),
    [expenseClaims]
  );

  const historySalaryClaims = useMemo(
    () =>
      salaryClaims.filter((row) => {
        if (row.status === 'pending') return false;
        if (claimHistoryStatusFilter !== 'all' && row.status !== claimHistoryStatusFilter) {
          return false;
        }
        if (!inAttendancePeriod(row.created_at)) return false;
        return inClaimDateRange(row.created_at);
      }),
    [salaryClaims, claimHistoryStatusFilter, inAttendancePeriod, inClaimDateRange]
  );

  const historyExpenseClaims = useMemo(
    () =>
      expenseClaims.filter((row) => {
        if (row.status === 'pending') return false;
        if (claimHistoryStatusFilter !== 'all' && row.status !== claimHistoryStatusFilter) {
          return false;
        }
        if (!inAttendancePeriod(row.created_at)) return false;
        return inClaimDateRange(row.created_at);
      }),
    [expenseClaims, claimHistoryStatusFilter, inAttendancePeriod, inClaimDateRange]
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

  function closeClaimHistory() {
    setClaimHistoryKind(null);
    setDatePickerTarget(null);
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
    let value: unknown = { text: setVal };
    const trimmed = setVal.trim();
    if (trimmed) {
      try {
        value = JSON.parse(trimmed) as unknown;
      } catch {
        value = { text: setVal };
      }
    }
    const { error } = await supabase.from('app_settings').upsert({
      key: setKey.trim(),
      value,
    });
    if (error) {
      toast.error('บันทึกการตั้งค่าไม่สำเร็จ', error.message);
      return;
    }
    toast.success('บันทึกการตั้งค่าแล้ว', 'ค่าระบบอัปเดตแล้วนะ ✨');
    await load();
  }

  async function savePayrollCompanyInfo() {
    setPayrollCompanySaving(true);
    try {
      const value = {
        name: payrollCompanyName.trim(),
        address_lines: payrollCompanyAddressText
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean),
        juristic_id: payrollCompanyJuristicId.trim(),
      };
      const { error } = await supabase.from('app_settings').upsert({
        key: PAYROLL_COMPANY_INFO_KEY,
        value,
      });
      if (error) throw new Error(error.message);
      toast.success('บันทึกข้อมูลบริษัทแล้ว', 'หัวสลิปเงินเดือนจะใช้ข้อมูลนี้ในการพิมพ์/ดาวน์โหลด PDF');
      await load();
    } catch (e) {
      toast.error('บันทึกข้อมูลบริษัทไม่สำเร็จ', e instanceof Error ? e.message : String(e));
    } finally {
      setPayrollCompanySaving(false);
    }
  }

  async function uploadAndSaveAnnouncementSlides() {
    setAnnouncementUploading(true);
    try {
      const slides: { url: string; durationMs: number }[] = [];
      for (const item of announcementItems) {
        const durationMs = announcementDurationMsFromText(item.durationSeconds);
        if (item.kind === 'saved') {
          slides.push({ url: item.url, durationMs });
        } else {
          const url = await uploadAnnouncementSlideFromUri(
            item.localUri,
            null
          );
          slides.push({ url, durationMs });
        }
      }
      const value = buildAnnouncementSettingsValue(
        slides,
        announcementSlideHeightPx,
        announcementTransitionMode
      );
      const { error } = await supabase.from('app_settings').upsert({
        key: ANNOUNCEMENT_SETTINGS_KEY,
        value,
      });
      if (error) throw new Error(error.message);
      setAnnouncementItems(
        value.slides.map((slide, i) => ({
          key: newDraftKey(`s${i}`),
          kind: 'saved' as const,
          url: slide.url,
          durationSeconds: announcementDurationSecondsText(slide.duration_ms),
        }))
      );
      const transitionLabel = value.transition_mode === 'fade' ? 'Fade' : 'Slide';
      const durationList =
        value.slides.length > 0
          ? value.slides
              .map((slide, i) => `#${i + 1} ${Math.round(slide.duration_ms / 1000)}s`)
              .join(', ')
          : 'ไม่มีภาพ';
      toast.success(
        'บันทึกภาพประกาศแล้ว',
        `อัปเดต ${value.slides.length} ภาพ · Transition: ${transitionLabel} · Height: ${value.slide_height_px}px · Duration: ${durationList}`
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
            durationSeconds: announcementDurationSecondsText(),
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
      {
        key: newDraftKey('u'),
        kind: 'saved',
        url: u,
        durationSeconds: announcementDurationSecondsText(),
      },
    ]);
    setAnnouncementUrlDraft('');
  }

  function moveAnnouncementItem(index: number, direction: -1 | 1) {
    setAnnouncementItems((prev) => {
      const to = index + direction;
      if (to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      const [picked] = next.splice(index, 1);
      if (!picked) return prev;
      next.splice(to, 0, picked);
      return next;
    });
  }

  function updateAnnouncementItemDuration(index: number, durationSeconds: string) {
    setAnnouncementItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, durationSeconds } : item))
    );
  }

  async function saveBreakMessages() {
    const startMessages = breakStartLines
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const endMessages = breakEndLines
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const leaveMessages = leavePromptLines
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const holidayMessages = holidayPromptLines
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const { error } = await supabase.from('app_settings').upsert([
      { key: BREAK_START_KEY, value: { messages: startMessages } },
      { key: BREAK_END_KEY, value: { messages: endMessages } },
      { key: LEAVE_PROMPT_KEY, value: { messages: leaveMessages } },
      { key: HOLIDAY_PROMPT_KEY, value: { messages: holidayMessages } },
    ]);
    if (error) {
      toast.error('บันทึกข้อความ popup ไม่สำเร็จ', error.message);
      return;
    }
    toast.success('บันทึกข้อความ popup แล้ว', 'พักเบรก / กลับงาน / ลา / วันหยุด อัปเดตแล้ว');
    await load();
  }

  async function saveKpiSettings() {
    setKpiSettingsSaving(true);
    try {
      const normalized = parseAttendanceKpiSettings(kpiSettingsFromDraft(kpiSettingsDraft));
      const { error } = await supabase.from('app_settings').upsert({
        key: ATTENDANCE_KPI_SETTINGS_KEY,
        value: normalized,
      });
      if (error) throw new Error(error.message);
      setKpiSettingsDraft(kpiDraftFromSettings(normalized));
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

  async function saveOvertimePromptSettings() {
    setOtPromptSettingsSaving(true);
    try {
      const promptAfter = clampMinuteSetting(
        otPromptAfterMinutes,
        DEFAULT_OVERTIME_PROMPT_SETTINGS.prompt_after_minutes
      );
      const autoCheckout = Math.max(
        promptAfter,
        clampMinuteSetting(
          otAutoCheckoutAfterMinutes,
          DEFAULT_OVERTIME_PROMPT_SETTINGS.auto_checkout_after_minutes
        )
      );
      const value = {
        prompt_after_minutes: promptAfter,
        auto_checkout_after_minutes: autoCheckout,
      };
      const { error } = await supabase.from('app_settings').upsert({
        key: OVERTIME_PROMPT_SETTINGS_KEY,
        value,
      });
      if (error) throw new Error(error.message);
      setOtPromptAfterMinutes(String(promptAfter));
      setOtAutoCheckoutAfterMinutes(String(autoCheckout));
      toast.success(
        'บันทึกตั้งค่า OT แล้ว',
        `ถามทำ OT หลังเลิกงาน ${promptAfter} นาที · ออกงานอัตโนมัติ ${autoCheckout} นาที`
      );
      await load();
    } catch (e) {
      toast.error(
        'บันทึกตั้งค่า OT ไม่สำเร็จ',
        e instanceof Error ? e.message : String(e)
      );
    } finally {
      setOtPromptSettingsSaving(false);
    }
  }

  const loadCompanyHolidays = useCallback(async () => {
    setCompanyHolidaysLoading(true);
    try {
      const rows = await fetchCompanyHolidayDates();
      setCompanyHolidays(rows);
    } catch (e) {
      toast.error(
        'โหลดวันหยุดบริษัทไม่สำเร็จ',
        e instanceof Error ? e.message : String(e)
      );
      setCompanyHolidays([]);
    } finally {
      setCompanyHolidaysLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (activeSection !== 'companyHolidays') return;
    void loadCompanyHolidays();
  }, [activeSection, loadCompanyHolidays]);

  function openCompanyHolidayForm(row?: CompanyHolidayDateRow) {
    if (row) {
      setCompanyHolidayEditId(row.id);
      setCompanyHolidayDate(new Date(`${row.holiday_date}T12:00:00+07:00`));
      setCompanyHolidayTitle(row.title);
      setCompanyHolidayDescription(row.description ?? '');
    } else {
      setCompanyHolidayEditId(null);
      setCompanyHolidayDate(new Date());
      setCompanyHolidayTitle('');
      setCompanyHolidayDescription('');
    }
    setCompanyHolidayFormOpen(true);
  }

  async function saveCompanyHoliday() {
    const title = companyHolidayTitle.trim();
    if (!companyHolidayDate) {
      toast.info('กรอกข้อมูล', 'เลือกวันที่วันหยุด');
      return;
    }
    if (!title) {
      toast.info('กรอกข้อมูล', 'ตั้งชื่อวันหยุด เช่น วันแรงงาน');
      return;
    }
    const holidayDate = dateToBangkokYmd(companyHolidayDate);
    const uid = session?.user?.id ?? null;
    setCompanyHolidaySaving(true);
    try {
      const description = companyHolidayDescription.trim() || null;
      if (companyHolidayEditId) {
        const { error } = await supabase
          .from('company_holiday_dates')
          .update({
            holiday_date: holidayDate,
            title,
            description,
            updated_at: new Date().toISOString(),
          })
          .eq('id', companyHolidayEditId);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await supabase.from('company_holiday_dates').insert({
          holiday_date: holidayDate,
          title,
          description,
          created_by: uid,
        });
        if (error) throw new Error(error.message);
      }
      toast.success('บันทึกแล้ว', `วันหยุด ${title} · ${formatCompanyHolidayDateTh(holidayDate)}`);
      setCompanyHolidayFormOpen(false);
      await loadCompanyHolidays();
    } catch (e) {
      toast.error('บันทึกวันหยุดไม่สำเร็จ', e instanceof Error ? e.message : String(e));
    } finally {
      setCompanyHolidaySaving(false);
    }
  }

  async function deleteCompanyHoliday(row: CompanyHolidayDateRow) {
    const { error } = await supabase.from('company_holiday_dates').delete().eq('id', row.id);
    if (error) {
      toast.error('ลบไม่สำเร็จ', error.message);
      return;
    }
    toast.success('ลบแล้ว', row.title);
    await loadCompanyHolidays();
  }

  if (loading) {
    return (
      <AppLoadingScreen
        title="กำลังโหลดหน้าแอดมิน"
        subtitle="กำลังเตรียมข้อมูล HR สาขา สิทธิ์ผู้จัดการ และการตั้งค่าระบบ"
      />
    );
  }

  return (
    <>
      <ScrollView
        ref={adminScrollRef}
        style={styles.screen}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled">
        {activeSection === null ? (
          <>
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

        <View style={styles.adminMenuWrap}>
          <Text style={styles.adminMenuTitle}>เลือกเมนูแอดมิน</Text>
          <Text style={styles.adminMenuSub}>
            แตะการ์ดเพื่อเปิดเฉพาะหมวดที่ต้องการจัดการ
          </Text>
          <View style={styles.adminMenuGrid}>
            {ADMIN_SECTIONS.map((section) => {
              const on = activeSection === section.key;
              return (
                <Pressable
                  key={section.key}
                  style={[styles.adminMenuCard, on && styles.adminMenuCardOn]}
                  onPress={() => setActiveSection(section.key)}>
                  <View style={styles.adminMenuCardTop}>
                    <View style={[styles.adminMenuIcon, on && styles.adminMenuIconOn]}>
                      <FontAwesome
                        name={section.icon}
                        size={18}
                        color={on ? c.canvas : c.primaryDark}
                      />
                    </View>
                    <Text style={[styles.adminMenuNo, on && styles.adminMenuNoOn]}>
                      {section.no}
                    </Text>
                  </View>
                  <View style={styles.adminMenuTextBox}>
                    <Text
                      style={[styles.adminMenuCardTitle, on && styles.adminMenuCardTitleOn]}
                      numberOfLines={2}>
                      {section.title}
                    </Text>
                    <Text
                      style={[styles.adminMenuCardSub, on && styles.adminMenuCardSubOn]}
                      numberOfLines={2}>
                      {section.subtitle}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>
          </>
        ) : null}

        {activeSectionMeta ? (
          <View style={styles.adminSectionHeader}>
            <Pressable style={styles.adminBackBtn} onPress={() => setActiveSection(null)}>
              <FontAwesome name="arrow-left" size={14} color={c.primaryDark} />
              <Text style={styles.adminBackBtnText}>กลับสู่เมนูแอดมิน</Text>
            </Pressable>
            <View style={styles.adminSectionHeaderTitleRow}>
              <View style={styles.adminSectionHeaderIcon}>
                <FontAwesome name={activeSectionMeta.icon} size={18} color={c.canvas} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.adminSectionHeaderNo}>หมวด {activeSectionMeta.no}</Text>
                <Text style={styles.adminSectionHeaderTitle}>{activeSectionMeta.title}</Text>
                <Text style={styles.adminSectionHeaderSub}>{activeSectionMeta.subtitle}</Text>
              </View>
            </View>
          </View>
        ) : null}

        {activeSection === 'announcements' ? (
          <View style={styles.adminSectionCard}>
        <Text style={styles.h2}>1 · รูปประกาศหน้าเข้า-ออกงาน</Text>
        <Text style={styles.muted}>
          เลือกรูปหรือ URL ก่อน — ลากลำดับด้วยปุ่มขึ้น/ลงได้ — ตั้งเวลาเฉพาะภาพได้
          ถ้าเว้นว่างระบบจะใช้ 4 วินาที — กดปุ่มสีหลักเพื่ออัปโหลดและบันทึกทั้งหมด
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
        <Text style={styles.label}>Transition</Text>
        <View style={styles.annTransitionRow}>
          {(
            [
              { key: 'slide', label: 'Slide' },
              { key: 'fade', label: 'Fade' },
            ] as const
          ).map((option) => {
            const on = announcementTransitionMode === option.key;
            return (
              <Pressable
                key={option.key}
                style={[styles.annTransitionChip, on && styles.annTransitionChipOn]}
                onPress={() => setAnnouncementTransitionMode(option.key)}
                disabled={announcementUploading}>
                <Text
                  style={[
                    styles.annTransitionChipText,
                    on && styles.annTransitionChipTextOn,
                  ]}>
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
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
                  <View style={styles.annOrderRow}>
                    <Text style={styles.annOrderBadge}>#{i + 1}</Text>
                    <View style={styles.annOrderButtons}>
                      <Pressable
                        style={[styles.annOrderBtn, i === 0 && styles.disabledSoft]}
                        disabled={i === 0 || announcementUploading}
                        onPress={() => moveAnnouncementItem(i, -1)}>
                        <Text style={styles.annOrderBtnText}>ขึ้น</Text>
                      </Pressable>
                      <Pressable
                        style={[
                          styles.annOrderBtn,
                          i === announcementItems.length - 1 && styles.disabledSoft,
                        ]}
                        disabled={i === announcementItems.length - 1 || announcementUploading}
                        onPress={() => moveAnnouncementItem(i, 1)}>
                        <Text style={styles.annOrderBtnText}>ลง</Text>
                      </Pressable>
                    </View>
                  </View>
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
                  <Text style={styles.annDurationLabel}>เวลาแสดง (วินาที)</Text>
                  <TextInput
                    style={styles.annDurationInput}
                    value={item.durationSeconds}
                    onChangeText={(text) => updateAnnouncementItemDuration(i, text)}
                    placeholder="4"
                    placeholderTextColor={c.textMuted}
                    keyboardType="numeric"
                    editable={!announcementUploading}
                  />
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
            <ActivityIndicator color={c.onAccent} />
          ) : (
            <Text style={styles.btnText}>อัปโหลดและบันทึกสไลด์</Text>
          )}
        </Pressable>
          </View>
        ) : null}

        {activeSection === 'employees' ? (
          <View style={styles.adminSectionCard}>
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
          </View>
        ) : null}

        {activeSection === 'managers' ? (
          <View style={styles.adminSectionCard}>
        <Text style={[styles.h2, { marginTop: 24 }]}>3 · ผู้จัดการ (สิทธิ์ & ลูกทีม)</Text>
        <Text style={styles.muted}>
          กำหนดว่าใครอนุมัติลา / จัดตารางกะ / มอบหมายงานให้คนในทีมได้ — สามารถเลือก
          Admin/HR เข้าทีมเพื่อให้ manager มอบหมายงานได้
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
          </View>
        ) : null}

        {activeSection === 'salaryClaims' ? (
          <View style={styles.adminSectionCard}>
        <Text style={[styles.h2, { marginTop: 24 }]}>4 · คำขอเบิกเงินเดือน (Claim Salary)</Text>
        <Text style={styles.muted}>
          รายการรอดำเนินการจากหน้าโปรไฟล์ช่วงวันที่ 10-14 ของเดือน
        </Text>
        <View style={styles.claimFilterWrap}>
          <Text style={styles.label}>คิวรอดำเนินการ</Text>
          <Text style={styles.muted}>
            เมื่อกดอนุมัติ / ปฏิเสธ / จ่ายแล้ว รายการจะหายจากหน้านี้และย้ายไปอยู่หน้าประวัติ
          </Text>
          <View style={styles.claimHistorySummaryRow}>
            <Pressable
              style={[styles.btnSecondary, styles.claimHistoryBtn]}
              onPress={() => setClaimHistoryKind('salary')}>
              <Text style={styles.btnSecondaryText}>ดูประวัติ Claim Salary</Text>
            </Pressable>
            <Text style={styles.muted}>
              รออนุมัติ: {filteredSalaryClaims.length} รายการ
            </Text>
          </View>
          <Text style={styles.muted}>
            ประวัติ Claim Salary ที่ตรงตัวกรองล่าสุด: {historySalaryClaims.length} รายการ
          </Text>
        </View>
        {filteredSalaryClaims.length === 0 ? (
          <Text style={styles.muted}>ยังไม่มีคำขอเบิกเงินเดือนที่รอดำเนินการ</Text>
        ) : (
          filteredSalaryClaims.map((row) => (
            <View key={row.id} style={styles.pwCard}>
              <Text style={styles.rowTitle}>
                {row.full_name || row.user_id.slice(0, 8)} · {money(row.requested_amount)} บาท
              </Text>
              <Text style={styles.rowSub}>
                สถานะ: {claimStatusLabelTh(row.status)} · เดือน: {row.claim_month} · ส่งเมื่อ{' '}
                {row.created_at}
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
          <Text style={styles.btnText}>ส่งออกคิว Claim Salary เป็น CSV</Text>
        </Pressable>
          </View>
        ) : null}

        {activeSection === 'expenseClaims' ? (
          <View style={styles.adminSectionCard}>
        <Text style={[styles.h2, { marginTop: 24 }]}>5 · คำขอเบิกเงิน (Expense Claim)</Text>
        <Text style={styles.muted}>
          รายการรอดำเนินการ แสดงแยกรายการตามหลักฐานการเบิก
        </Text>
        <View style={styles.claimFilterWrap}>
          <Text style={styles.label}>คิวรอดำเนินการ</Text>
          <Text style={styles.muted}>
            เมื่อกดอนุมัติ / ปฏิเสธ / จ่ายแล้ว รายการจะหายจากหัวข้อนี้และย้ายไปอยู่ประวัติ Expense Claim
          </Text>
          <View style={styles.claimHistorySummaryRow}>
            <Pressable
              style={[styles.btnSecondary, styles.claimHistoryBtn]}
              onPress={() => setClaimHistoryKind('expense')}>
              <Text style={styles.btnSecondaryText}>ดูประวัติ Expense Claim</Text>
            </Pressable>
            <Text style={styles.muted}>
              รออนุมัติ: {filteredExpenseClaims.length} รายการ
            </Text>
          </View>
          <Text style={styles.muted}>
            ประวัติ Expense Claim ที่ตรงตัวกรองล่าสุด: {historyExpenseClaims.length} รายการ
          </Text>
        </View>
        {filteredExpenseClaims.length === 0 ? (
          <Text style={styles.muted}>ยังไม่มีคำขอเบิกค่าใช้จ่ายที่รอดำเนินการ</Text>
        ) : (
          filteredExpenseClaims.map((claim) => {
            const items = expenseClaimItems.filter((it) => it.expense_claim_id === claim.id);
            return (
              <View key={claim.id} style={styles.pwCard}>
                <Text style={styles.rowTitle}>
                  {claim.full_name || claim.user_id.slice(0, 8)} · รวม {money(claim.total_amount)} บาท
                </Text>
                <Text style={styles.rowSub}>
                  สถานะ: {claimStatusLabelTh(claim.status)} · ส่งเมื่อ {claim.created_at}
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
                    onPress={() => setExpenseApprovalPrompt(claim)}>
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
                    onPress={() => void updateExpenseClaimStatus(claim, 'paid', 'direct')}>
                    <Text style={styles.claimBtnText}>จ่ายแยก</Text>
                  </Pressable>
                </View>
                <Text style={styles.expensePayrollHint}>
                  การอนุมัติจะถามก่อนว่าจะลง Payroll / สลิปเงินเดือน หรือจ่ายแยกไม่ลงเงินเดือน
                </Text>
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
          <Text style={styles.btnText}>ส่งออกคิว Expense Claim เป็น CSV</Text>
        </Pressable>
          </View>
        ) : null}

        {activeSection === 'payroll' ? (
          <View style={styles.adminSectionCard}>
        <Text style={[styles.h2, { marginTop: 24 }]}>6 · Payroll / สลิปเงินเดือน</Text>
        <AdminPayrollPanel />
          </View>
        ) : null}

        {activeSection === 'branches' ? (
          <View style={styles.adminSectionCard}>
        <Text style={[styles.h2, { marginTop: 24 }]}>7 · สาขา (branch_information)</Text>
        <Text style={styles.muted}>
          รหัสสาขา (id) ต้องไม่ซ้ำ — ดึงจากตารางเดิมของคุณ
        </Text>
        <TextInput
          style={styles.input}
          placeholder="รหัสสาขา เช่น 101"
          keyboardType="number-pad"
          value={bId}
          onChangeText={setBId}
        />
        <TextInput
          style={styles.input}
          placeholder="branch_code เช่น BKK01"
          value={bCode}
          onChangeText={setBCode}
        />
        <TextInput
          style={styles.input}
          placeholder="ชื่อสาขา"
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
          placeholder="เบอร์โทร"
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
          placeholder="รัศมี เมตร"
          value={bRad}
          onChangeText={setBRad}
          keyboardType="number-pad"
        />
        <Pressable style={styles.btn} onPress={addBranch}>
          <Text style={styles.btnText}>เพิ่มสาขา</Text>
        </Pressable>
        {branches.map((b) => (
          <View key={b.id} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>
                {b.id} · {b.branch_name}
              </Text>
              <Text style={styles.rowSub}>
                code: {b.branch_code ?? '—'} · lat/lon: {b.latitude},{b.longitude} · r:{' '}
                {b.radius_meters}m
              </Text>
            </View>
            <View style={styles.branchActions}>
              <TouchableOpacity
                activeOpacity={0.85}
                style={[styles.editBtn, Platform.OS === 'web' && styles.pressableWeb]}
                onPress={() => openEditBranch(b)}>
                <Text style={styles.editBtnText}>แก้ไข</Text>
              </TouchableOpacity>
              <Pressable
                onPress={() => {
                  void deleteBranch(b.id);
                }}>
                <Text style={styles.danger}>ลบ</Text>
              </Pressable>
            </View>
          </View>
        ))}
          </View>
        ) : null}

        {activeSection === 'breakMessages' ? (
          <View style={styles.adminSectionCard}>
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

        <Text style={[styles.label, { marginTop: 16 }]}>
          ข้อความก่อนเปิดฟอร์มลางาน
        </Text>
        {leavePromptLines.map((line, i) => (
          <View key={`lp-${i}`} style={styles.breakLineBlock}>
            <Text style={styles.breakLineTag}>ข้อความ {i + 1}</Text>
            <TextInput
              style={[styles.input, styles.breakLineInput]}
              placeholder="พิมพ์ข้อความที่จะแสดงในป๊อปอัพก่อนคีย์ลา"
              value={line}
              onChangeText={(t) => {
                setLeavePromptLines((prev) => {
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
                leavePromptLines.length <= 1 && styles.breakRemoveBtnDisabled,
              ]}
              disabled={leavePromptLines.length <= 1}
              onPress={() => {
                setLeavePromptLines((prev) =>
                  prev.length <= 1 ? [''] : prev.filter((_, j) => j !== i)
                );
              }}>
              <Text
                style={[
                  styles.breakRemoveBtnText,
                  leavePromptLines.length <= 1 && styles.breakRemoveBtnTextDisabled,
                ]}>
                ลบช่องนี้
              </Text>
            </Pressable>
          </View>
        ))}
        <Pressable
          style={styles.btnSecondary}
          onPress={() => setLeavePromptLines((p) => [...p, ''])}>
          <Text style={styles.btnSecondaryText}>+ เพิ่มข้อความ (ก่อนลา)</Text>
        </Pressable>

        <Text style={[styles.label, { marginTop: 16 }]}>
          ข้อความเมื่อวันนี้เป็นวันหยุด (เข้า-ออกงาน)
        </Text>
        <Text style={styles.muted}>
          แสดงอัตโนมัติเมื่อวันนี้เป็นวันหยุดบริษัท หรือวันหยุดส่วนตัวที่ตั้งในตารางงาน
        </Text>
        {holidayPromptLines.map((line, i) => (
          <View key={`hp-${i}`} style={styles.breakLineBlock}>
            <Text style={styles.breakLineTag}>ข้อความ {i + 1}</Text>
            <TextInput
              style={[styles.input, styles.breakLineInput]}
              placeholder="พิมพ์ข้อความแจ้งเตือนเมื่อวันนี้เป็นวันหยุด"
              value={line}
              onChangeText={(t) => {
                setHolidayPromptLines((prev) => {
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
                holidayPromptLines.length <= 1 && styles.breakRemoveBtnDisabled,
              ]}
              disabled={holidayPromptLines.length <= 1}
              onPress={() => {
                setHolidayPromptLines((prev) =>
                  prev.length <= 1 ? [''] : prev.filter((_, j) => j !== i)
                );
              }}>
              <Text
                style={[
                  styles.breakRemoveBtnText,
                  holidayPromptLines.length <= 1 && styles.breakRemoveBtnTextDisabled,
                ]}>
                ลบช่องนี้
              </Text>
            </Pressable>
          </View>
        ))}
        <Pressable
          style={styles.btnSecondary}
          onPress={() => setHolidayPromptLines((p) => [...p, ''])}>
          <Text style={styles.btnSecondaryText}>+ เพิ่มข้อความ (วันหยุด)</Text>
        </Pressable>

        <Pressable style={styles.btn} onPress={saveBreakMessages}>
          <Text style={styles.btnText}>บันทึกข้อความ popup</Text>
        </Pressable>
          </View>
        ) : null}

        {activeSection === 'companyHolidays' ? (
          <View style={styles.adminSectionCard}>
            <Text style={[styles.h2, { marginTop: 24 }]}>วันหยุดประจำปีบริษัท</Text>
            <Text style={styles.muted}>
              ตั้งวันหยุดของบริษัท (เช่น วันแรงงาน 1 พ.ค.) — แสดงเป็นตัวสีแดงในปฏิทินหน้าตารางและปฏิทินส่วนตัวของพนักงาน
            </Text>
            <Pressable style={styles.btn} onPress={() => openCompanyHolidayForm()}>
              <Text style={styles.btnText}>+ เพิ่มวันหยุดบริษัท</Text>
            </Pressable>
            {companyHolidaysLoading ? (
              <ActivityIndicator color={c.primary} style={{ marginVertical: 16 }} />
            ) : companyHolidays.length === 0 ? (
              <Text style={styles.muted}>ยังไม่มีวันหยุดประจำปี</Text>
            ) : (
              companyHolidays.map((row) => (
                <View key={row.id} style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>{row.title}</Text>
                    <Text style={styles.rowSub}>
                      {formatCompanyHolidayDateTh(row.holiday_date)}
                    </Text>
                    {row.description?.trim() ? (
                      <Text style={styles.rowSub}>{row.description.trim()}</Text>
                    ) : null}
                  </View>
                  <View style={styles.branchActions}>
                    <TouchableOpacity
                      activeOpacity={0.85}
                      style={[styles.editBtn, Platform.OS === 'web' && styles.pressableWeb]}
                      onPress={() => openCompanyHolidayForm(row)}>
                      <Text style={styles.editBtnText}>แก้ไข</Text>
                    </TouchableOpacity>
                    <Pressable onPress={() => void deleteCompanyHoliday(row)}>
                      <Text style={styles.danger}>ลบ</Text>
                    </Pressable>
                  </View>
                </View>
              ))
            )}
          </View>
        ) : null}

        {activeSection === 'kpi' ? (
          <View style={styles.adminSectionCard}>
        <Text style={[styles.h2, { marginTop: 24 }]}>ตั้งค่า KPI ลา / ขอเข้าสาย</Text>
        <Text style={styles.muted}>
          เกณฑ์นี้ใช้คำนวณการ์ด KPI ในหน้าโปรไฟล์แบบรายไตรมาสและภาพรวมปี — กรอกตัวเลขแล้วบันทึกได้ทันที
        </Text>
        {KPI_FORM_GROUPS.map((group) => (
          <View key={group.title} style={styles.kpiFormGroupCard}>
            <Text style={styles.kpiFormGroupTitle}>{group.title}</Text>
            <Text style={styles.kpiFormGroupSub}>{group.description}</Text>
            {group.rows.map((row, rowIndex) => (
              <View key={`${group.title}-${row.title ?? rowIndex}`} style={styles.kpiFormPairRow}>
                {row.title ? <Text style={styles.kpiFormPairTitle}>{row.title}</Text> : null}
                <View style={styles.kpiFormGrid}>
                  {row.fields.map((field) => (
                    <View key={`${field.section}-${field.key}`} style={styles.kpiFormField}>
                      <Text style={styles.label}>{field.label}</Text>
                      <TextInput
                        style={styles.input}
                        value={getKpiDraftField(kpiSettingsDraft, field)}
                        onChangeText={(value) => {
                          setKpiSettingsDraft((prev) => {
                            if (field.section === 'root') {
                              return { ...prev, [field.key]: value };
                            }
                            return {
                              ...prev,
                              [field.section]: {
                                ...prev[field.section],
                                [field.key]: value,
                              },
                            };
                          });
                        }}
                        keyboardType="decimal-pad"
                        placeholder="0"
                        placeholderTextColor={c.textMuted}
                      />
                      {field.hint ? <Text style={styles.kpiFormFieldHint}>{field.hint}</Text> : null}
                    </View>
                  ))}
                </View>
              </View>
            ))}
          </View>
        ))}
        <View style={styles.kpiSettingsActions}>
          <Pressable
            style={styles.btnSecondary}
            onPress={() => setKpiSettingsDraft(kpiDraftFromSettings(DEFAULT_ATTENDANCE_KPI_SETTINGS))}>
            <Text style={styles.btnSecondaryText}>คืนค่าเริ่มต้น</Text>
          </Pressable>
          <Pressable
            style={[styles.btn, kpiSettingsSaving && styles.disabledSoft]}
            disabled={kpiSettingsSaving}
            onPress={() => void saveKpiSettings()}>
            {kpiSettingsSaving ? (
              <ActivityIndicator color={c.onAccent} />
            ) : (
              <Text style={styles.btnText}>บันทึกเกณฑ์ KPI</Text>
            )}
          </Pressable>
        </View>

        <View style={styles.payrollCompanyCard}>
          <Text style={styles.h2}>ตั้งค่าระบบถามทำ OT หลังเลิกงาน</Text>
          <Text style={styles.muted}>
            ระบบจะถามพนักงานหลังเวลาเลิกงานตามตาราง และถ้าไม่ตอบจะออกงานให้อัตโนมัติตามเวลาที่กำหนด
          </Text>
          <View style={styles.otPromptSettingGrid}>
            <View style={styles.otPromptSettingField}>
              <Text style={styles.label}>ถามทำ OT หลังเลิกงาน (นาที)</Text>
              <TextInput
                style={styles.input}
                placeholder="15"
                placeholderTextColor={c.textMuted}
                value={otPromptAfterMinutes}
                onChangeText={setOtPromptAfterMinutes}
                keyboardType="number-pad"
              />
              <Text style={styles.otPromptSettingHint}>
                ค่าเริ่มต้น 15 นาที · ระบบ cron ตรวจทุกนาที
              </Text>
            </View>
            <View style={styles.otPromptSettingField}>
              <Text style={styles.label}>ออกงานอัตโนมัติหลังเลิกงาน (นาที)</Text>
              <TextInput
                style={styles.input}
                placeholder="30"
                placeholderTextColor={c.textMuted}
                value={otAutoCheckoutAfterMinutes}
                onChangeText={setOtAutoCheckoutAfterMinutes}
                keyboardType="number-pad"
              />
              <Text style={styles.otPromptSettingHint}>
                ค่าเริ่มต้น 30 นาที · ต้องไม่น้อยกว่าเวลาถาม OT
              </Text>
            </View>
          </View>
          <Pressable
            style={[styles.btn, otPromptSettingsSaving && styles.disabledSoft]}
            disabled={otPromptSettingsSaving}
            onPress={() => void saveOvertimePromptSettings()}>
            {otPromptSettingsSaving ? (
              <ActivityIndicator color={c.onAccent} />
            ) : (
              <Text style={styles.btnText}>บันทึกตั้งค่า OT</Text>
            )}
          </Pressable>
        </View>

        <View style={styles.payrollCompanyCard}>
          <Text style={styles.h2}>ข้อมูลบริษัทบนหัวสลิปเงินเดือน</Text>
          <Text style={styles.muted}>
            ข้อมูลนี้จะแสดงมุมซ้ายบนของ PDF สลิปเงินเดือน ส่วนชื่อเอกสารและรอบเงินเดือนอยู่มุมขวา
          </Text>
          <Text style={styles.label}>ชื่อบริษัท</Text>
          <TextInput
            style={styles.input}
            placeholder="เช่น บริษัท ตัวอย่าง จำกัด"
            placeholderTextColor={c.textMuted}
            value={payrollCompanyName}
            onChangeText={setPayrollCompanyName}
          />
          <Text style={styles.label}>ที่อยู่บริษัท</Text>
          <TextInput
            style={[styles.input, styles.companyAddressInput]}
            placeholder={'กรอกที่อยู่ได้หลายบรรทัด\nเช่น 123 ถนนสุขุมวิท แขวง... เขต... กรุงเทพฯ'}
            placeholderTextColor={c.textMuted}
            value={payrollCompanyAddressText}
            onChangeText={setPayrollCompanyAddressText}
            multiline
            textAlignVertical="top"
          />
          <Text style={styles.label}>เลขนิติบุคคล</Text>
          <TextInput
            style={styles.input}
            placeholder="เช่น 010555..."
            placeholderTextColor={c.textMuted}
            value={payrollCompanyJuristicId}
            onChangeText={setPayrollCompanyJuristicId}
          />
          <Pressable
            style={[styles.btn, payrollCompanySaving && styles.disabledSoft]}
            disabled={payrollCompanySaving}
            onPress={() => void savePayrollCompanyInfo()}>
            {payrollCompanySaving ? (
              <ActivityIndicator color={c.onAccent} />
            ) : (
              <Text style={styles.btnText}>บันทึกข้อมูลบริษัทบนสลิป</Text>
            )}
          </Pressable>
        </View>

        <Text style={[styles.h2, { marginTop: 24 }]}>ตั้งค่าระบบขั้นสูง (JSON text)</Text>
        <Text style={styles.muted}>
          ใช้สำหรับ key อื่น ๆ ที่ยังไม่มีฟอร์มเฉพาะ ถ้ากรอกเป็น JSON ที่ถูกต้อง ระบบจะบันทึกเป็น JSON โดยตรง
        </Text>
        <TextInput
          style={styles.input}
          placeholder="key เช่น payroll_company_info"
          value={setKey}
          onChangeText={setSetKey}
        />
        <TextInput
          style={[styles.input, styles.tall]}
          placeholder={'ค่า JSON เช่น {"name":"ชื่อบริษัท","address_lines":["ที่อยู่บรรทัด 1"],"juristic_id":"เลขนิติบุคคล"}'}
          value={setVal}
          onChangeText={setSetVal}
          multiline
        />
        <Pressable style={styles.btn} onPress={saveSetting}>
          <Text style={styles.btnText}>บันทึกการตั้งค่า</Text>
        </Pressable>
          </View>
        ) : null}
      </ScrollView>

      <Modal
        visible={companyHolidayFormOpen}
        transparent
        animationType="slide"
        presentationStyle="overFullScreen"
        onRequestClose={() => setCompanyHolidayFormOpen(false)}>
        <Pressable
          style={[styles.linkBackdrop, WEB_MODAL_BACKDROP]}
          onPress={() => setCompanyHolidayFormOpen(false)}>
          <Pressable style={styles.linkModalCard} onPress={() => {}}>
            <Text style={styles.linkModalTitle}>
              {companyHolidayEditId ? 'แก้ไขวันหยุดบริษัท' : 'เพิ่มวันหยุดบริษัท'}
            </Text>
            <DatePickerField
              label="วันที่วันหยุด"
              value={companyHolidayDate}
              onChange={setCompanyHolidayDate}
            />
            <Text style={styles.label}>ชื่อวันหยุด</Text>
            <TextInput
              style={styles.input}
              placeholder='เช่น วันแรงงาน'
              placeholderTextColor={c.textMuted}
              value={companyHolidayTitle}
              onChangeText={setCompanyHolidayTitle}
            />
            <Text style={styles.label}>รายละเอียด (ไม่บังคับ)</Text>
            <TextInput
              style={[styles.input, { minHeight: 88 }]}
              placeholder="คำอธิบายเพิ่มเติม"
              placeholderTextColor={c.textMuted}
              value={companyHolidayDescription}
              onChangeText={setCompanyHolidayDescription}
              multiline
            />
            <View style={styles.employeeConfirmActions}>
              <Pressable
                style={styles.employeeConfirmCancelBtn}
                onPress={() => setCompanyHolidayFormOpen(false)}
                disabled={companyHolidaySaving}>
                <Text style={styles.employeeConfirmCancelText}>ยกเลิก</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.employeeConfirmPrimaryBtn,
                  styles.employeeConfirmResignBtn,
                  companyHolidaySaving && styles.empActionBtnDisabled,
                ]}
                onPress={() => void saveCompanyHoliday()}
                disabled={companyHolidaySaving}>
                {companyHolidaySaving ? (
                  <ActivityIndicator color={c.warningTitle} />
                ) : (
                  <Text style={[styles.employeeConfirmPrimaryText, styles.employeeConfirmResignText]}>
                    บันทึก
                  </Text>
                )}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={expenseApprovalPrompt !== null}
        transparent
        animationType="fade"
        presentationStyle="overFullScreen"
        onRequestClose={() => setExpenseApprovalPrompt(null)}>
        <Pressable
          style={[styles.linkBackdrop, WEB_MODAL_BACKDROP]}
          onPress={() => setExpenseApprovalPrompt(null)}>
          <Pressable style={styles.expenseApprovalCard} onPress={() => {}}>
            <Text style={styles.linkModalTitle}>อนุมัติ Expense Claim</Text>
            <Text style={styles.linkModalSub}>
              เลือกว่าจะนำยอดเบิกนี้เข้า Payroll / สลิปเงินเดือน หรือบันทึกเป็นการจ่ายแยก
            </Text>
            {expenseApprovalPrompt ? (
              <View style={styles.expenseApprovalSummary}>
                <Text style={styles.rowTitle}>
                  {expenseApprovalPrompt.full_name || expenseApprovalPrompt.user_id.slice(0, 8)}
                </Text>
                <Text style={styles.rowSub}>
                  ยอดรวม {money(expenseApprovalPrompt.total_amount)} บาท · บัญชี{' '}
                  {expenseApprovalPrompt.bank_name ?? '-'} /{' '}
                  {expenseApprovalPrompt.account_number ?? '-'}
                </Text>
              </View>
            ) : null}
            <View style={styles.expenseApprovalOptions}>
              <Pressable
                style={[styles.expenseApprovalOption, claimActionBusyKey !== null && styles.disabledSoft]}
                disabled={claimActionBusyKey !== null}
                onPress={() => void approveExpenseClaimWithHandling('payroll')}>
                <Text style={styles.expenseApprovalOptionTitle}>
                  ลง Payroll / สลิปเงินเดือน
                </Text>
                <Text style={styles.expenseApprovalOptionSub}>
                  สถานะจะเป็นอนุมัติแล้ว และยอดนี้จะถูกดึงเข้าเงินคืน/เบิกจ่ายตอนคำนวณสลิป
                </Text>
              </Pressable>
              <Pressable
                style={[
                  styles.expenseApprovalOption,
                  styles.expenseApprovalOptionDirect,
                  claimActionBusyKey !== null && styles.disabledSoft,
                ]}
                disabled={claimActionBusyKey !== null}
                onPress={() => void approveExpenseClaimWithHandling('direct')}>
                <Text style={styles.expenseApprovalOptionTitle}>
                  บันทึกจ่ายแยก ไม่ลงเงินเดือน
                </Text>
                <Text style={styles.expenseApprovalOptionSub}>
                  สถานะจะเป็นจ่ายแล้วทันที และยอดนี้จะไม่ถูกนำไปรวมใน Payroll / สลิปเงินเดือน
                </Text>
              </Pressable>
            </View>
            <Pressable
              style={styles.expenseApprovalCancel}
              disabled={claimActionBusyKey !== null}
              onPress={() => setExpenseApprovalPrompt(null)}>
              <Text style={styles.btnSecondaryText}>ยกเลิก</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={claimHistoryKind !== null}
        transparent
        animationType="slide"
        presentationStyle="overFullScreen"
        statusBarTranslucent
        onRequestClose={closeClaimHistory}>
        <Pressable
          style={[styles.linkBackdrop, WEB_MODAL_BACKDROP]}
          onPress={closeClaimHistory}>
          <Pressable style={styles.linkModalCard} onPress={() => {}}>
            <View style={styles.claimHistoryHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.linkModalTitle}>
                  {claimHistoryKind === 'salary'
                    ? 'ประวัติ Claim Salary'
                    : 'ประวัติ Expense Claim'}
                </Text>
                <Text style={styles.linkModalSub}>
                  รายการที่อนุมัติ / ปฏิเสธ / จ่ายแล้วของหัวข้อนี้จะถูกแสดงในหน้านี้
                </Text>
              </View>
              <Pressable
                hitSlop={12}
                onPress={closeClaimHistory}
                accessibilityRole="button"
                accessibilityLabel="ปิดประวัติคำขอ">
                <Text style={styles.linkAction}>ปิด</Text>
              </Pressable>
            </View>
            <ScrollView
              style={styles.claimHistoryScroll}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}>
              <View style={styles.claimFilterWrap}>
                <Text style={styles.label}>สถานะประวัติ</Text>
                <View style={styles.claimFilterStatusRow}>
                  {CLAIM_HISTORY_STATUS_FILTERS.map((status) => (
                    <Pressable
                      key={status}
                      style={[
                        styles.claimFilterChip,
                        claimHistoryStatusFilter === status && styles.claimFilterChipActive,
                      ]}
                      onPress={() => setClaimHistoryStatusFilter(status)}>
                      <Text
                        style={[
                          styles.claimFilterChipText,
                          claimHistoryStatusFilter === status &&
                            styles.claimFilterChipTextActive,
                        ]}>
                        {claimStatusLabelTh(status)}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <Text style={styles.label}>ช่วงวันที่สร้างคำขอ</Text>
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
                    <Text
                      style={claimDateFrom ? styles.claimDateValue : styles.claimDatePlaceholder}>
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
                {datePickerTarget ? (
                  <DateTimePicker
                    value={pickerDateValue}
                    mode="date"
                    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                    onChange={onPickFilterDate}
                  />
                ) : null}
                <Text style={styles.muted}>
                  ผลลัพธ์:{' '}
                  {claimHistoryKind === 'salary'
                    ? `Claim Salary ${historySalaryClaims.length} รายการ`
                    : `Expense Claim ${historyExpenseClaims.length} รายการ`}
                </Text>
              </View>

              {claimHistoryKind === 'salary' ? (
                <>
                  <Text style={styles.h2}>ประวัติ Claim Salary</Text>
                  {historySalaryClaims.length === 0 ? (
                    <Text style={styles.muted}>ไม่พบประวัติคำขอเบิกเงินเดือนตามตัวกรอง</Text>
                  ) : (
                    historySalaryClaims.map((row) => (
                      <View key={row.id} style={styles.pwCard}>
                        <Text style={styles.rowTitle}>
                          {row.full_name || row.user_id.slice(0, 8)} ·{' '}
                          {money(row.requested_amount)} บาท
                        </Text>
                        <Text style={styles.rowSub}>
                          สถานะ: {claimStatusLabelTh(row.status)} · เดือน: {row.claim_month} ·
                          ส่งเมื่อ {row.created_at}
                        </Text>
                        <Text style={styles.rowSub}>
                          บัญชี: {row.bank_name ?? '-'} / {row.account_number ?? '-'} · สังกัด{' '}
                          {row.branch_name ?? '-'}
                        </Text>
                        <Text style={styles.rowSub}>
                          ตรวจเมื่อ: {row.reviewed_at ?? '-'} · ผู้ตรวจ: {row.reviewed_by ?? '-'}
                        </Text>
                        {row.review_note ? (
                          <Text style={styles.rowSub}>บันทึกผล: {row.review_note}</Text>
                        ) : null}
                        {row.note ? (
                          <Text style={styles.rowSub}>หมายเหตุผู้ขอ: {row.note}</Text>
                        ) : null}
                        {row.status === 'approved' ? (
                          <View style={styles.claimActionRow}>
                            <Pressable
                              style={[
                                styles.claimBtn,
                                styles.claimBtnPaid,
                                claimActionBusyKey !== null && styles.disabledSoft,
                              ]}
                              disabled={claimActionBusyKey !== null}
                              onPress={() => void updateSalaryClaimStatus(row, 'paid')}>
                              <Text style={styles.claimBtnText}>จ่ายแล้ว</Text>
                            </Pressable>
                          </View>
                        ) : null}
                      </View>
                    ))
                  )}
                </>
              ) : null}

              {claimHistoryKind === 'expense' ? (
                <>
                  <Text style={styles.h2}>ประวัติ Expense Claim</Text>
                  {historyExpenseClaims.length === 0 ? (
                    <Text style={styles.muted}>ไม่พบประวัติคำขอเบิกค่าใช้จ่ายตามตัวกรอง</Text>
                  ) : (
                    historyExpenseClaims.map((claim) => {
                  const items = expenseClaimItems.filter(
                    (it) => it.expense_claim_id === claim.id
                  );
                  return (
                    <View key={claim.id} style={styles.pwCard}>
                      <Text style={styles.rowTitle}>
                        {claim.full_name || claim.user_id.slice(0, 8)} · รวม{' '}
                        {money(claim.total_amount)} บาท
                      </Text>
                      <Text style={styles.rowSub}>
                        สถานะ: {claimStatusLabelTh(claim.status)} · ส่งเมื่อ {claim.created_at}
                      </Text>
                      <Text style={styles.rowSub}>
                        การจ่าย: {expensePayrollHandlingLabelTh(claim.payroll_handling)}
                      </Text>
                      <Text style={styles.rowSub}>
                        บัญชี: {claim.bank_name ?? '-'} / {claim.account_number ?? '-'} · สาขา{' '}
                        {claim.branch_name ?? '-'}
                      </Text>
                      <Text style={styles.rowSub}>
                        ตรวจเมื่อ: {claim.reviewed_at ?? '-'} · ผู้ตรวจ: {claim.reviewed_by ?? '-'}
                      </Text>
                      {claim.review_note ? (
                        <Text style={styles.rowSub}>บันทึกผล: {claim.review_note}</Text>
                      ) : null}
                      {claim.status === 'approved' ? (
                        <View style={styles.claimActionRow}>
                          <Pressable
                            style={[
                              styles.claimBtn,
                              styles.claimBtnPaid,
                              claimActionBusyKey !== null && styles.disabledSoft,
                            ]}
                            disabled={claimActionBusyKey !== null}
                            onPress={() =>
                              void updateExpenseClaimStatus(
                                claim,
                                'paid',
                                claim.payroll_handling === 'direct' ? 'direct' : 'payroll'
                              )
                            }>
                            <Text style={styles.claimBtnText}>จ่ายแล้ว</Text>
                          </Pressable>
                        </View>
                      ) : null}
                      {items.length === 0 ? (
                        <Text style={styles.rowSub}>ยังไม่มีรายการย่อย</Text>
                      ) : (
                        items.map((item, idx) => (
                          <View key={item.id} style={styles.claimItemRow}>
                            <Text style={styles.rowSub}>
                              {idx + 1}. {item.item_title} · {money(item.amount)} บาท
                            </Text>
                            {item.note ? (
                              <Text style={styles.rowSub}>หมายเหตุ: {item.note}</Text>
                            ) : null}
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
                                  </>
                                ) : null}
                                <Pressable
                                  onPress={() => {
                                    void Linking.openURL(item.evidence_url);
                                  }}>
                                  <Text style={styles.linkAction}>
                                    {item.evidence_name ?? 'เปิดหลักฐาน'}
                                  </Text>
                                </Pressable>
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
                </>
              ) : null}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

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

      <Modal
        visible={employeeConfirmAction !== null}
        transparent
        animationType="fade"
        onRequestClose={closeEmployeeConfirmAction}>
        <Pressable
          style={[styles.employeeConfirmBackdrop, WEB_MODAL_BACKDROP]}
          onPress={closeEmployeeConfirmAction}>
          <Pressable style={styles.employeeConfirmCard} onPress={() => {}}>
            <View
              style={[
                styles.employeeConfirmIcon,
                employeeConfirmDanger
                  ? styles.employeeConfirmIconDelete
                  : styles.employeeConfirmIconResign,
              ]}>
              <FontAwesome
                name={employeeConfirmDanger ? 'trash' : 'user-times'}
                size={18}
                color={employeeConfirmDanger ? c.error : c.warningTitle}
              />
            </View>
            <Text style={styles.employeeConfirmTitle}>{employeeConfirmTitle}</Text>
            <Text style={styles.employeeConfirmName} numberOfLines={2}>
              {employeeConfirmName || employeeConfirmAction?.row.id.slice(0, 8) || 'พนักงาน'}
            </Text>
            <Text style={styles.employeeConfirmMessage}>{employeeConfirmMessage}</Text>
            <View style={styles.employeeConfirmInfoBox}>
              <Text style={styles.employeeConfirmInfoText}>
                {employeeConfirmDanger
                  ? 'การลบเป็นการลบข้อมูล employee ถาวร ควรใช้เฉพาะกรณีข้อมูลซ้ำหรือคีย์ผิด'
                  : 'การลาออกจะเก็บประวัติไว้และยังตรวจสอบย้อนหลังได้จากข้อมูล HR'}
              </Text>
            </View>
            <View style={styles.employeeConfirmActions}>
              <Pressable
                style={[
                  styles.employeeConfirmCancelBtn,
                  employeeConfirmBusy && styles.empActionBtnDisabled,
                ]}
                onPress={closeEmployeeConfirmAction}
                disabled={employeeConfirmBusy}>
                <Text style={styles.employeeConfirmCancelText}>ยกเลิก</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.employeeConfirmPrimaryBtn,
                  employeeConfirmDanger
                    ? styles.employeeConfirmDeleteBtn
                    : styles.employeeConfirmResignBtn,
                  employeeConfirmBusy && styles.empActionBtnDisabled,
                ]}
                onPress={() => void runEmployeeConfirmAction()}
                disabled={employeeConfirmBusy}>
                {employeeConfirmBusy ? (
                  <ActivityIndicator color={employeeConfirmDanger ? c.error : c.warningTitle} />
                ) : (
                  <Text
                    style={[
                      styles.employeeConfirmPrimaryText,
                      employeeConfirmDanger
                        ? styles.employeeConfirmDeleteText
                        : styles.employeeConfirmResignText,
                    ]}>
                    {employeeConfirmDanger ? 'ลบพนักงาน' : 'ยืนยันลาออก'}
                  </Text>
                )}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <AdminManagerDelegationModal
        visible={!!managerModalProfile}
        manager={managerModalProfile}
        candidateProfiles={profiles.filter(
          (p) => p.id !== managerModalProfile?.id
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

function createAdminStyles(theme: AppTheme) {
  const c = theme.colors;
  const r = theme.radius;
  const s = theme.spacing;
  const sectionAccent =
    c.canvas === '#F8FAF1'
      ? { borderLeftWidth: 4, borderLeftColor: c.primaryMuted, paddingLeft: 10 }
      : {};

  return StyleSheet.create({
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
  adminMenuWrap: {
    marginBottom: 18,
    padding: 14,
    borderRadius: r.xl,
    backgroundColor: c.surfaceElevated,
    borderWidth: 1,
    borderColor: c.borderSoft,
  },
  adminMenuTitle: { fontSize: 18, fontWeight: '900', color: c.text, letterSpacing: 0.1 },
  adminMenuSub: { marginTop: 5, marginBottom: 14, fontSize: 12, color: c.textMuted },
  adminMenuGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    alignItems: 'stretch',
  },
  adminMenuCard: {
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: '47%',
    maxWidth: '47%',
    minWidth: 0,
    minHeight: 148,
    justifyContent: 'space-between',
    padding: 14,
    borderRadius: 18,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.borderSoft,
    shadowColor: c.shadow,
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  adminMenuCardOn: {
    backgroundColor: c.primaryLight,
    borderColor: c.primaryMuted,
  },
  adminMenuCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  adminMenuIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.surfaceMuted,
    borderWidth: 1,
    borderColor: c.borderSoft,
  },
  adminMenuIconOn: {
    backgroundColor: c.primary,
    borderColor: c.primary,
  },
  adminMenuTextBox: { flex: 1, minWidth: 0 },
  adminMenuNo: {
    minWidth: 26,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: c.surfaceMuted,
    color: c.primaryDark,
    fontSize: 11,
    fontWeight: '900',
    textAlign: 'center',
  },
  adminMenuNoOn: { backgroundColor: c.accentWarmLight, color: c.primaryDark },
  adminMenuCardTitle: { color: c.text, fontSize: 14, lineHeight: 18, fontWeight: '900' },
  adminMenuCardTitleOn: { color: c.text },
  adminMenuCardSub: { marginTop: 6, color: c.textMuted, fontSize: 11.5, lineHeight: 16 },
  adminMenuCardSubOn: { color: c.textSecondary },
  adminSectionCard: {
    marginTop: 4,
    padding: 14,
    borderRadius: r.lg,
    backgroundColor: c.surfaceElevated,
    borderWidth: 1,
    borderColor: c.borderSoft,
  },
  adminSectionHeader: {
    marginBottom: 12,
    padding: 14,
    borderRadius: r.lg,
    backgroundColor: c.surfaceElevated,
    borderWidth: 1,
    borderColor: c.borderSoft,
  },
  adminBackBtn: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: c.primaryLight,
    borderWidth: 1,
    borderColor: c.primaryMuted,
    marginBottom: 12,
  },
  adminBackBtnText: { color: c.primaryDark, fontSize: 12, fontWeight: '900' },
  adminSectionHeaderTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    ...sectionAccent,
  },
  adminSectionHeaderIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.primary,
  },
  adminSectionHeaderNo: { color: c.primaryDark, fontSize: 11, fontWeight: '900' },
  adminSectionHeaderTitle: { marginTop: 2, color: c.text, fontSize: 19, fontWeight: '900' },
  adminSectionHeaderSub: { marginTop: 3, color: c.textMuted, fontSize: 12 },
  analyticsPanel: {
    marginBottom: 24,
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
  analyticsStatCardSick: { borderLeftColor: '#9B86C4' },
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
    flex: 1,
    minWidth: 280,
    padding: 10,
    borderRadius: r.sm,
    backgroundColor: c.surfaceElevated,
    borderWidth: 1,
    borderColor: c.borderSoft,
  },
  analyticsRankTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: c.text,
    marginBottom: 8,
  },
  analyticsSortRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 8,
  },
  analyticsSortChip: {
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
  analyticsSortChipText: { fontSize: 11, color: c.textMuted, fontWeight: '800' },
  analyticsSortChipTextOn: { color: c.lateNoticeBar },
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
  annTransitionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  annTransitionChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.surfaceElevated,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  annTransitionChipOn: {
    borderColor: c.primaryMuted,
    backgroundColor: c.primaryLight,
  },
  annTransitionChipText: { color: c.textSecondary, fontSize: 13, fontWeight: '700' },
  annTransitionChipTextOn: { color: c.primaryDark, fontWeight: '800' },
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
  payrollCompanyCard: {
    marginTop: 24,
    marginBottom: 18,
    padding: 14,
    borderRadius: r.md,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.borderSoft,
  },
  otPromptSettingGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 12,
  },
  otPromptSettingField: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 220,
    minWidth: 0,
  },
  otPromptSettingHint: {
    marginTop: 6,
    color: c.textMuted,
    fontSize: 11,
    lineHeight: 16,
  },
  companyAddressInput: { minHeight: 96, textAlignVertical: 'top' },
  kpiFormGroupCard: {
    marginBottom: 12,
    padding: 12,
    borderRadius: r.md,
    borderWidth: 1,
    borderColor: c.borderSoft,
    backgroundColor: c.surface,
  },
  kpiFormGroupTitle: {
    color: c.text,
    fontSize: 15,
    fontWeight: '900',
    marginBottom: 4,
  },
  kpiFormGroupSub: {
    color: c.textMuted,
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 10,
  },
  kpiFormGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  kpiFormPairRow: {
    marginTop: 10,
    padding: 10,
    borderRadius: r.sm,
    borderWidth: 1,
    borderColor: c.borderSoft,
    backgroundColor: c.surfaceMuted,
  },
  kpiFormPairTitle: {
    color: c.primaryDark,
    fontSize: 12,
    fontWeight: '900',
    marginBottom: 8,
  },
  kpiFormField: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 210,
    minWidth: 0,
  },
  kpiFormFieldHint: {
    marginTop: 5,
    color: c.textMuted,
    fontSize: 11,
    lineHeight: 15,
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
  annThumbCard: {
    width: 144,
    borderWidth: 1,
    borderColor: c.borderSoft,
    borderRadius: r.sm,
    backgroundColor: c.surfaceElevated,
    padding: 8,
  },
  annOrderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
    marginBottom: 6,
  },
  annOrderBadge: {
    minWidth: 32,
    borderRadius: 999,
    overflow: 'hidden',
    paddingVertical: 4,
    paddingHorizontal: 7,
    backgroundColor: c.primaryLight,
    color: c.primaryDark,
    fontSize: 11,
    fontWeight: '800',
    textAlign: 'center',
  },
  annOrderButtons: { flexDirection: 'row', gap: 4 },
  annOrderBtn: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.surface,
    paddingVertical: 4,
    paddingHorizontal: 7,
  },
  annOrderBtnText: { color: c.textSecondary, fontSize: 11, fontWeight: '700' },
  annThumb: {
    width: '100%',
    height: 72,
    borderRadius: r.sm,
    backgroundColor: c.surfaceMuted,
  },
  annDurationLabel: { marginTop: 8, fontSize: 11, color: c.textMuted, fontWeight: '700' },
  annDurationInput: {
    marginTop: 4,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: r.sm,
    paddingVertical: 7,
    paddingHorizontal: 8,
    color: c.text,
    backgroundColor: c.surface,
    fontSize: 13,
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
  expensePayrollHint: {
    marginTop: 6,
    color: c.textMuted,
    fontSize: 11,
    lineHeight: 15,
  },
  expenseApprovalCard: {
    width: '92%',
    maxWidth: 520,
    maxHeight: '86%',
    alignSelf: 'center',
    borderRadius: r.xl,
    backgroundColor: c.surfaceElevated,
    borderWidth: 1,
    borderColor: c.borderSoft,
    padding: 16,
  },
  expenseApprovalSummary: {
    marginTop: 12,
    marginBottom: 12,
    padding: 12,
    borderRadius: r.md,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.borderSoft,
  },
  expenseApprovalOptions: {
    gap: 10,
  },
  expenseApprovalOption: {
    padding: 13,
    borderRadius: r.md,
    borderWidth: 1,
    borderColor: c.primaryMuted,
    backgroundColor: c.primaryLight,
  },
  expenseApprovalOptionDirect: {
    borderColor: c.link,
    backgroundColor: c.linkLight,
  },
  expenseApprovalOptionTitle: {
    color: c.text,
    fontSize: 14,
    fontWeight: '900',
  },
  expenseApprovalOptionSub: {
    marginTop: 4,
    color: c.textSecondary,
    fontSize: 12,
    lineHeight: 17,
  },
  expenseApprovalCancel: {
    alignSelf: 'flex-start',
    marginTop: 12,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  claimFilterWrap: {
    borderWidth: 1,
    borderColor: c.borderSoft,
    borderRadius: r.sm,
    padding: 10,
    backgroundColor: c.surface,
    marginBottom: 12,
  },
  claimHistorySummaryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
    marginTop: 10,
    marginBottom: 8,
  },
  claimHistoryBtn: { marginBottom: 0 },
  claimHistoryHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  claimHistoryScroll: { maxHeight: 620 },
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
    backgroundColor: c.overlay,
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
    color: c.text,
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
    color: c.textSecondary,
    fontSize: 12,
  },
  employeeConfirmBackdrop: {
    flex: 1,
    backgroundColor: c.overlay,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 18,
  },
  employeeConfirmCard: {
    width: '100%',
    maxWidth: 420,
    borderRadius: r.xl,
    backgroundColor: c.surfaceElevated,
    borderWidth: 1,
    borderColor: c.borderSoft,
    padding: 18,
    alignItems: 'center',
    shadowColor: c.shadow,
    shadowOpacity: 0.28,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 14 },
    elevation: 12,
  },
  employeeConfirmIcon: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  employeeConfirmIconResign: {
    backgroundColor: c.warningBg,
    borderColor: c.warningBorder,
  },
  employeeConfirmIconDelete: {
    backgroundColor: c.errorBg,
    borderColor: 'rgba(229, 115, 115, 0.35)',
  },
  employeeConfirmTitle: {
    fontSize: 19,
    fontWeight: '900',
    color: c.text,
    textAlign: 'center',
  },
  employeeConfirmName: {
    marginTop: 6,
    fontSize: 14,
    fontWeight: '800',
    color: c.primaryDark,
    textAlign: 'center',
  },
  employeeConfirmMessage: {
    marginTop: 10,
    fontSize: 13,
    color: c.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  employeeConfirmInfoBox: {
    alignSelf: 'stretch',
    marginTop: 14,
    borderRadius: r.sm,
    borderWidth: 1,
    borderColor: c.borderSoft,
    backgroundColor: c.surfaceMuted,
    padding: 10,
  },
  employeeConfirmInfoText: {
    fontSize: 12,
    color: c.textMuted,
    lineHeight: 18,
    textAlign: 'center',
  },
  employeeConfirmActions: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  employeeConfirmCancelBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: r.sm,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  employeeConfirmCancelText: { color: c.textSecondary, fontWeight: '800', fontSize: 14 },
  employeeConfirmPrimaryBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: r.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  employeeConfirmResignBtn: {
    backgroundColor: c.warningBg,
    borderColor: c.warningBorder,
  },
  employeeConfirmDeleteBtn: {
    backgroundColor: c.errorBg,
    borderColor: 'rgba(229, 115, 115, 0.35)',
  },
  employeeConfirmPrimaryText: { fontWeight: '900', fontSize: 14 },
  employeeConfirmResignText: { color: c.warningTitle },
  employeeConfirmDeleteText: { color: c.error },
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
}
