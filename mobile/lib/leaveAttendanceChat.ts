/** ข้อความแชทเข้า-ออก สำหรับคำขอลา — แยก parse ด้วยบรรทัด LEAVE_REQ: */

export const LEAVE_REQ_MARKER = 'LEAVE_REQ:';

export function leaveTypeLabelTh(t: string): string {
  if (t === 'sick') return 'ลาป่วย';
  if (t === 'personal') return 'ลากิจ';
  if (t === 'vacation') return 'ลาพักร้อน';
  if (t === 'unpaid') return 'ลาไม่รับเงิน';
  return t;
}

/** ข้อความแชทที่เกี่ยวกับคำขอลาป่วย — ใช้ไฮไลต์แถบสีม่วง */
export function chatBodyIndicatesSickLeave(body: string): boolean {
  return (
    body.includes('ประเภท: ลาป่วย') || body.includes('ส่งคำขอลาป่วย')
  );
}

export function extractLeaveRequestIdFromChatBody(body: string): string | null {
  const lines = body.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]?.trim() ?? '';
    if (line.startsWith(LEAVE_REQ_MARKER)) {
      const id = line.slice(LEAVE_REQ_MARKER.length).trim();
      if (/^[0-9a-f-]{36}$/i.test(id)) return id;
    }
  }
  return null;
}

export function buildLeavePendingChatBody(params: {
  applicantName: string;
  leaveType: string;
  startsOn: string;
  endsOn: string;
  newDays: number;
  reason: string;
  leaveId: string;
}): string {
  const typeTh = leaveTypeLabelTh(params.leaveType);
  const reason = params.reason.trim().slice(0, 400);
  return [
    '📋 ขอลารออนุมัติ',
    `ผู้ขอ: ${params.applicantName}`,
    `ประเภท: ${typeTh}`,
    `ช่วง: ${params.startsOn} – ${params.endsOn} (${params.newDays} วันปฏิทิน)`,
    `เหตุผล: ${reason || '—'}`,
    '',
    'HR / ผู้จัดการ: กดปุ่มด้านล่างข้อความนี้ในแอปเพื่ออนุมัติหรือปฏิเสธ',
    `${LEAVE_REQ_MARKER}${params.leaveId}`,
  ].join('\n');
}

export function buildLeaveBroadcastFollowUpBody(params: {
  applicantName: string;
  leaveType: string;
  startsOn: string;
  endsOn: string;
  newDays: number;
}): string {
  const typeTh = leaveTypeLabelTh(params.leaveType);
  return `แจ้งลา: ${params.applicantName} ส่งคำขอ${typeTh} ${params.startsOn}–${params.endsOn} (${params.newDays} วัน) — รอหัวหน้า/HR อนุมัติ`;
}

export function buildLateAttendanceChatBody(params: {
  applicantName: string;
  workDateYmd: string;
  minutesLate: number;
  note: string | null;
}): string {
  const note = params.note?.trim().slice(0, 200);
  const notePart = note ? ` · ${note}` : '';
  return `แจ้งเข้าสาย: ${params.applicantName} วันทำงาน ${params.workDateYmd} สาย ${params.minutesLate} นาที${notePart}`;
}

/** แยกหัวข้อแชทขอเข้าสาย (แสดงแถบส้ม + หัวข้อใน UI) */
export function parseLateAttendanceChatBody(body: string): {
  isLate: boolean;
  detail: string;
} {
  const t = body.trim();
  if (!t.startsWith('แจ้งเข้าสาย:')) {
    return { isLate: false, detail: body };
  }
  return {
    isLate: true,
    detail: t.replace(/^แจ้งเข้าสาย:\s*/u, '').trim(),
  };
}

/** มีข้อความทีมหลังคำขอที่บอกว่าอนุมัติ/ปฏิเสธแล้ว และอ้างรหัสคำขอเดียวกัน (ไม่ต้อง query leave_requests) */
export function leaveRequestResolvedInThread(
  leaveId: string,
  messageCreatedAt: string,
  messages: readonly { body: string; created_at: string }[]
): boolean {
  const short = leaveId.slice(0, 8).toLowerCase();
  const t0 = new Date(messageCreatedAt).getTime();
  return messages.some((x) => {
    if (Number.isNaN(t0) || new Date(x.created_at).getTime() <= t0) return false;
    const b = x.body;
    if (!b.includes('อนุมัติคำขอลาแล้ว') && !b.includes('ปฏิเสธคำขอลาแล้ว'))
      return false;
    return b.toLowerCase().includes(short);
  });
}
