import type { AttendanceLog, AttendanceOvertimeRequestRow } from '@/lib/types';

export function formatDurationMinutesTh(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes));
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  if (h > 0 && m > 0) return `${h} ชม. ${m} นาที`;
  if (h > 0) return `${h} ชม.`;
  return `${m} นาที`;
}

export function calculateBreakMinutes(dayLogs: AttendanceLog[], fallbackEndIso?: string | null): number {
  const ordered = [...dayLogs].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
  let openStartMs: number | null = null;
  let totalMs = 0;
  for (const row of ordered) {
    const ts = new Date(row.created_at).getTime();
    if (!Number.isFinite(ts)) continue;
    if (row.kind === 'break_start' && openStartMs == null) {
      openStartMs = ts;
      continue;
    }
    if (row.kind === 'break_end' && openStartMs != null) {
      totalMs += Math.max(0, ts - openStartMs);
      openStartMs = null;
    }
  }
  if (openStartMs != null && fallbackEndIso) {
    const endMs = new Date(fallbackEndIso).getTime();
    if (Number.isFinite(endMs)) totalMs += Math.max(0, endMs - openStartMs);
  }
  return Math.round(totalMs / 60_000);
}

export function calculateWorkMinutes(
  checkInIso: string | null | undefined,
  checkOutIso: string | null | undefined,
  breakMinutes: number
): number {
  if (!checkInIso || !checkOutIso) return 0;
  const startMs = new Date(checkInIso).getTime();
  const endMs = new Date(checkOutIso).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return 0;
  return Math.max(0, Math.round((endMs - startMs) / 60_000) - Math.max(0, breakMinutes));
}

export function calculateOvertimeMinutes(
  overtime: AttendanceOvertimeRequestRow | null | undefined,
  checkOutIso: string | null | undefined,
  checkInIso?: string | null | undefined
): number {
  if (!overtime || overtime.status !== 'accepted') return 0;
  if (overtime.overtime_kind === 'manual') {
    return Math.max(0, Math.round(overtime.manual_minutes ?? 0));
  }
  if (overtime.overtime_kind === 'before_work') {
    if (!checkInIso) return 0;
    const planStartMs = new Date(overtime.plan_start_at).getTime();
    const inMs = new Date(checkInIso).getTime();
    if (!Number.isFinite(planStartMs) || !Number.isFinite(inMs)) return 0;
    return Math.max(0, Math.round((planStartMs - inMs) / 60_000));
  }
  if (!checkOutIso) return 0;
  const planEndMs = new Date(overtime.plan_end_at).getTime();
  const outMs = new Date(checkOutIso).getTime();
  if (!Number.isFinite(planEndMs) || !Number.isFinite(outMs)) return 0;
  return Math.max(0, Math.round((outMs - planEndMs) / 60_000));
}

export function overtimeApprovalLabel(
  status: AttendanceOvertimeRequestRow['approval_status']
): string {
  if (status === 'approved') return 'อนุมัติแล้ว';
  if (status === 'rejected') return 'ปฏิเสธแล้ว';
  return 'รออนุมัติ';
}

export function overtimeStatusLabel(status: AttendanceOvertimeRequestRow['status']): string {
  if (status === 'accepted') return 'พนักงานขอทำ OT';
  if (status === 'declined') return 'ไม่ทำ OT';
  if (status === 'auto_checked_out') return 'ออกงานอัตโนมัติ';
  return 'รอพนักงานตอบรับ';
}

export function overtimeSummaryStatusLabel(
  overtime: AttendanceOvertimeRequestRow | null | undefined
): string {
  if (!overtime) return '-';
  if (overtime.status !== 'accepted') return '-';
  return overtimeApprovalLabel(overtime.approval_status);
}
