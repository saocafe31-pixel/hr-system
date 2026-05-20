import type { SupabaseClient } from '@supabase/supabase-js';

import type { TaskPriority, TaskRow } from '@/lib/types';

export const TASK_PRIORITY_OPTIONS: {
  key: TaskPriority;
  label: string;
  color: string;
}[] = [
  {
    key: 'urgent',
    label: 'สำคัญมาก ต้องทำก่อน',
    color: '#C62828',
  },
  { key: 'high', label: 'สำคัญ', color: '#E65100' },
  { key: 'medium', label: 'ปานกลาง', color: '#F9A825' },
  {
    key: 'normal',
    label: 'ปกติ ทำเสร็จให้ทันกำหนด',
    color: '#2E7D32',
  },
];

export function priorityLabel(p: TaskPriority): string {
  return TASK_PRIORITY_OPTIONS.find((o) => o.key === p)?.label ?? p;
}

export function priorityColor(p: TaskPriority): string {
  return TASK_PRIORITY_OPTIONS.find((o) => o.key === p)?.color ?? '#666';
}

/** ลำดับเรียง: สำคัญมาก → สำคัญ → ปานกลาง → ปกติ */
export function taskPrioritySortKey(p: string | null | undefined): number {
  const k = (p as TaskPriority) || 'normal';
  if (k === 'urgent') return 0;
  if (k === 'high') return 1;
  if (k === 'medium') return 2;
  return 3;
}

export function compareTasksByPriorityThenCreated(a: TaskRow, b: TaskRow): number {
  const ra = taskPrioritySortKey(a.priority);
  const rb = taskPrioritySortKey(b.priority);
  if (ra !== rb) return ra - rb;
  const ta = new Date(a.created_at).getTime();
  const tb = new Date(b.created_at).getTime();
  return tb - ta;
}

/** งานที่โหลดมาแล้ว — กรองเฉพาะแถวที่มอบหมายให้ผู้ใช้นี้เป็นผู้รับ */
export function filterTasksAssignedToUser<T extends { assigned_to: string }>(
  rows: T[] | null | undefined,
  uid: string
): T[] {
  const u = String(uid);
  return (rows ?? []).filter((r) => String(r.assigned_to) === u);
}

/** user_id ทุกคนที่เกี่ยวกับงาน (จาก task_assignees หรือ fallback assigned_to) */
export function taskParticipantUserIds(
  task: Pick<TaskRow, 'task_assignees' | 'assigned_to'>
): string[] {
  const rows = task.task_assignees ?? [];
  if (rows.length === 0) {
    return task.assigned_to ? [String(task.assigned_to)] : [];
  }
  return [...new Set(rows.map((r) => String(r.user_id)))];
}

/** ผู้รับผิดชอบหลัก (หลายคน = รับผิดชอบร่วมกัน) — ไม่มีแถว assignee ใช้ assigned_to */
export function taskPrimaryUserIds(
  task: Pick<TaskRow, 'task_assignees' | 'assigned_to'>
): string[] {
  const rows = task.task_assignees ?? [];
  const prim = rows.filter((r) => r.is_primary).map((r) => String(r.user_id));
  if (prim.length > 0) return [...new Set(prim)];
  return task.assigned_to ? [String(task.assigned_to)] : [];
}

export function taskUserIsPrimaryResponsible(
  task: Pick<TaskRow, 'task_assignees' | 'assigned_to'>,
  uid: string
): boolean {
  return taskPrimaryUserIds(task).includes(String(uid));
}

/** ร่วมงาน (หลักหรือไม่ก็ตาม) */
export function taskUserIsParticipant(
  task: Pick<TaskRow, 'task_assignees' | 'assigned_to'>,
  uid: string
): boolean {
  return taskParticipantUserIds(task).includes(String(uid));
}

/** รายการหน้างานหลัก: เฉพาะผู้รับผิดชอบ/ร่วมงาน — ไม่รวมแค่ผู้มอบหมาย */
export function userIncludedInMainTaskList(
  task: Pick<TaskRow, 'task_assignees' | 'assigned_to'>,
  uid: string | null | undefined
): boolean {
  if (!uid) return false;
  return taskUserIsParticipant(task, uid);
}

export function canEditTaskStatus(
  task: TaskRow,
  uid: string,
  manager: boolean,
  admin: boolean
): boolean {
  if (admin || manager) return true;
  if (task.assigned_by && String(task.assigned_by) === String(uid)) return true;
  return taskUserIsParticipant(task, uid);
}

export function sortByPriorityThenCreated<
  T extends { priority?: string | null; created_at?: string; id: string },
>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const ra = taskPrioritySortKey(a.priority);
    const rb = taskPrioritySortKey(b.priority);
    if (ra !== rb) return ra - rb;
    const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
    const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
    if (ta !== tb) return tb - ta;
    return a.id.localeCompare(b.id);
  });
}

/** เวลา (ms) ที่นับว่างานเสร็จ — ใช้ completed_at; ข้อมูลเก่า fallback updated_at */
export function taskCompletedAtMs(
  task: Pick<TaskRow, 'status' | 'completed_at' | 'updated_at'>
): number | null {
  if (task.status !== 'done') return null;
  if (task.completed_at) {
    const t = new Date(task.completed_at).getTime();
    if (!Number.isNaN(t)) return t;
  }
  if (task.updated_at) {
    const t = new Date(task.updated_at).getTime();
    if (!Number.isNaN(t)) return t;
  }
  return null;
}

/** งาน done ปิดทันกำหนด (หรือไม่มี due) — ไม่นับแก้ไขทั่วไปหลัง due เป็น "ล่าช้า" */
export function taskDoneIsOnTime(
  task: Pick<TaskRow, 'status' | 'due_at' | 'completed_at' | 'updated_at'>
): boolean {
  if (task.status !== 'done') return false;
  if (!task.due_at) return true;
  const dueMs = new Date(task.due_at).getTime();
  const doneMs = taskCompletedAtMs(task);
  if (doneMs == null) return true;
  return doneMs <= dueMs;
}

/** เปอร์เซ็นต์ความคืบหน้าจากเช็คลิสต์ (หัวข้อที่ติ๊กแล้ว / ทั้งหมด) */
export function checklistProgress(task: TaskRow): {
  percent: number;
  done: number;
  total: number;
} {
  const items = task.task_checklist_items ?? [];
  const total = items.length;
  if (total === 0) return { percent: 0, done: 0, total: 0 };
  const done = items.filter((i) => i.done).length;
  return {
    percent: Math.round((done / total) * 100),
    done,
    total,
  };
}

/** ค่า YYYY-MM-DD → ISO เริ่มวันใน Asia/Bangkok */
export function dateYmdToIsoBangkokStart(ymd: string): string | null {
  const t = ymd.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  const d = new Date(`${t}T12:00:00+07:00`);
  if (Number.isNaN(d.getTime())) return null;
  const start = new Date(`${t}T00:00:00+07:00`);
  return start.toISOString();
}

export function dateYmdToIsoBangkokEnd(ymd: string): string | null {
  const t = ymd.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  const end = new Date(`${t}T23:59:59.999+07:00`);
  return end.toISOString();
}

/** แปลง Date เป็น YYYY-MM-DD ตามปฏิทินในเขต Asia/Bangkok */
export function dateToBangkokYmd(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/** แจ้งเตือนผู้มอบหมาย (ถ้าไม่ใช่คนทำ) + หัวหน้าสาขาเดียวกัน + ผู้รับงานทุกคน */
export async function notifyTaskStakeholders(
  supabase: SupabaseClient,
  params: {
    taskId: string;
    assignedTo: string;
    assignedBy: string | null;
    title: string;
    message: string;
    /** ผู้รับงานทุกคน (primary + ร่วม) — ถ้าไม่ส่งใช้เฉพาะ assignedTo */
    notifyAssigneeIds?: string[];
  }
): Promise<void> {
  const { taskId, assignedTo, assignedBy, title, message, notifyAssigneeIds } =
    params;
  const body = `งาน "${title}" — ${message}`;
  const ids = new Set<string>();

  const assignees =
    notifyAssigneeIds && notifyAssigneeIds.length > 0
      ? [...new Set(notifyAssigneeIds.map(String))]
      : [String(assignedTo)];
  for (const id of assignees) ids.add(id);

  if (assignedBy) {
    const ab = String(assignedBy);
    if (!assignees.includes(ab)) ids.add(ab);
  }

  const branchSource = assignees[0] ?? assignedTo;
  const { data: assignee } = await supabase
    .from('profiles')
    .select('branch_id')
    .eq('id', branchSource)
    .maybeSingle();

  const bid = assignee?.branch_id as number | null | undefined;
  if (bid != null) {
    const { data: mgrs } = await supabase
      .from('profiles')
      .select('id')
      .eq('role', 'manager')
      .eq('branch_id', bid);
    for (const m of mgrs ?? []) {
      const mid = (m as { id: string }).id;
      if (mid !== String(branchSource)) {
        ids.add(mid);
      }
    }
  }

  const rows = [...ids].map((recipient_id) => ({
    task_id: taskId,
    recipient_id,
    body,
  }));

  if (!rows.length) return;

  const { error } = await supabase.from('task_notifications').insert(rows);
  if (error) throw new Error(error.message);
}

export const TASK_STATUS_TH: Record<string, string> = {
  pending: 'รอดำเนินการ',
  in_progress: 'กำลังทำ',
  done: 'เสร็จแล้ว',
  cancelled: 'ยกเลิก',
};

/** มีหลักฐานแนบอย่างน้อย 1 รายการ (ลิงก์ / รูป / ไฟล์) ก่อนปิดงานสำเร็จ */
export function taskHasDeliverableAttachment(task: TaskRow): boolean {
  return (task.task_attachments ?? []).some(
    (a) => a.kind === 'link' || a.kind === 'image' || a.kind === 'file'
  );
}

/** เช็คลิสต์ครบทุกข้อ (ถ้าไม่มีหัวข้อถือว่าผ่าน) */
export function checklistAllDone(task: TaskRow): boolean {
  const items = task.task_checklist_items ?? [];
  if (items.length === 0) return true;
  return items.every((i) => i.done);
}
