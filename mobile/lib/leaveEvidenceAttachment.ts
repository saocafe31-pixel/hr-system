import { Linking } from 'react-native';

import { inclusiveCalendarDays } from '@/lib/leaveLateRules';
import { supabase } from '@/lib/supabase';
import type { LeaveRequestRow, LeaveRequestType } from '@/lib/types';

/** ลาป่วยและลากิจ — แนบหลักฐานได้ทุกครั้ง */
export function leaveAllowsEvidenceAttachment(
  leaveType: LeaveRequestType,
  _startsOn: string,
  _endsOn: string
): boolean {
  return leaveType === 'sick' || leaveType === 'personal';
}

export function leaveAllowsEvidenceAttachmentRow(row: LeaveRequestRow): boolean {
  return leaveAllowsEvidenceAttachment(row.leave_type, row.starts_on, row.ends_on);
}

export function leaveEvidenceUrl(row: LeaveRequestRow): string | null {
  if (row.leave_type === 'sick') {
    return row.medical_certificate_url?.trim() || null;
  }
  if (row.leave_type === 'personal') {
    return row.supplementary_document_url?.trim() || null;
  }
  return null;
}

/** บังคับแนบเมื่อลาป่วยเกิน 2 วันติดกัน */
export function leaveEvidenceRequired(
  leaveType: LeaveRequestType,
  startsOn: string,
  endsOn: string
): boolean {
  if (leaveType === 'sick') {
    return inclusiveCalendarDays(startsOn, endsOn) > 2;
  }
  return false;
}

export function leaveEvidenceFileLabel(url: string | null | undefined): string {
  const u = (url ?? '').trim().toLowerCase();
  if (!u) return 'เอกสาร';
  if (u.includes('.pdf')) return 'PDF';
  return 'รูปภาพ';
}

export async function attachLeaveRequestEvidence(
  leaveId: string,
  url: string
): Promise<LeaveRequestRow> {
  const { data, error } = await supabase.rpc('attach_leave_request_evidence', {
    p_leave_id: leaveId,
    p_url: url,
  });
  if (error) throw new Error(error.message);
  return data as LeaveRequestRow;
}

export function openLeaveEvidenceUrl(url: string): void {
  void Linking.openURL(url).catch(() => {
    /* noop — toast handled by caller if needed */
  });
}
