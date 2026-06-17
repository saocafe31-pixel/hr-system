export type UserRole = 'employee' | 'manager' | 'admin';

/** สิทธิ์เสริมของผู้จัดการ — แอดมินกำหนดใน manager_scopes */
export type ManagerScopeRow = {
  manager_id: string;
  can_approve_leave: boolean;
  can_manage_schedule: boolean;
};

export type Profile = {
  id: string;
  email: string | null;
  full_name: string | null;
  role: UserRole;
  /** FK → branch_information.id (bigint) */
  branch_id: number | null;
  employee_code: string | null;
  phone: string | null;
  /** FK → public.employee.id (เชื่อมกับข้อมูล HR / CSV) */
  employee_id?: string | null;
  /** รูปโปรไฟล์ (public URL จาก Storage bucket avatars) */
  avatar_url?: string | null;
  /** Expo push token — ตั้งจากแอปเมื่ออนุญาตการแจ้งเตือน */
  expo_push_token?: string | null;
  /** ถ้า true ระบบจะลบโพสต์ฟีดคอมมูนิตี้ของผู้ใช้หลัง 30 วัน (cron) */
  community_feed_auto_delete_enabled?: boolean | null;
};

/** แถวจาก public.branch_information */
export type Branch = {
  id: number;
  branch_code: string | null;
  branch_name: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  phone_number: number | null;
  radius_meters: number;
};

export type AttendanceKind =
  | 'check_in'
  | 'check_out'
  | 'break_start'
  | 'break_end';

export type AttendanceLog = {
  id: string;
  user_id: string;
  branch_id: number | null;
  kind: AttendanceKind;
  latitude: number | null;
  longitude: number | null;
  within_branch: boolean;
  note: string | null;
  created_at: string;
};

export type TaskPriority = 'urgent' | 'high' | 'medium' | 'normal';

export type TaskChecklistItemRow = {
  id: string;
  task_id: string;
  label: string;
  done: boolean;
  sort_order: number;
};

export type TaskAttachmentRow = {
  id: string;
  task_id: string;
  kind: 'link' | 'image' | 'file';
  url: string;
  title: string | null;
  created_by: string;
  created_at: string;
};

export type TaskNotificationRow = {
  id: string;
  task_id: string;
  recipient_id: string;
  body: string;
  read_at: string | null;
  created_at: string;
};

export type TaskAssigneeRow = {
  id: string;
  task_id: string;
  user_id: string;
  is_primary: boolean;
  sort_order: number;
  created_at?: string;
};

export type TaskRow = {
  id: string;
  title: string;
  description: string | null;
  assigned_to: string;
  assigned_by: string | null;
  status: string;
  due_at: string | null;
  start_at: string | null;
  /** วันเวลาที่ทำงานเสร็จจริง (สถานะ done) — ใช้คำนวณทัน/ล่าช้า */
  completed_at?: string | null;
  priority: TaskPriority;
  created_at: string;
  updated_at?: string;
  task_assignees?: TaskAssigneeRow[] | null;
  task_checklist_items?: TaskChecklistItemRow[] | null;
  task_attachments?: TaskAttachmentRow[] | null;
};

export type WorkScheduleRow = {
  id: string;
  user_id: string;
  start_at: string;
  end_at: string;
  title: string | null;
  created_by: string | null;
};

export type LeaveRequestType = 'sick' | 'personal' | 'vacation' | 'unpaid';

export type LeaveRequestRow = {
  id: string;
  user_id: string;
  leave_type: LeaveRequestType;
  starts_on: string;
  ends_on: string;
  reason: string | null;
  medical_certificate_url: string | null;
  supplementary_note: string | null;
  supplementary_document_url: string | null;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  is_kpi_exempt?: boolean | null;
  admin_adjusted_by?: string | null;
  admin_adjusted_at?: string | null;
};

export type VacationGrantRow = {
  user_id: string;
  year: number;
  days_granted: number;
  sick_days_granted?: number | null;
  personal_days_granted?: number | null;
  updated_at: string;
  updated_by: string | null;
};

export type NotificationPreferencesRow = {
  user_id: string;
  task_enabled: boolean;
  mention_enabled: boolean;
  checkout_enabled: boolean;
  updated_at: string;
};

export type LateRequestRow = {
  id: string;
  user_id: string;
  work_date: string;
  minutes_late: number;
  note: string | null;
  created_at: string;
};

export type WorkShiftRow = {
  id: string;
  name: string;
  start_time: string;
  end_time: string;
  created_by: string | null;
  created_at: string;
};

export type WorkScheduleAssignmentRow = {
  id: string;
  user_id: string;
  work_date: string;
  shift_id: string;
  allowed_branch_id?: number | null;
  created_by: string | null;
  created_at: string;
};

export type EmployeeHolidayDateRow = {
  id: string;
  user_id: string;
  /** วันที่หยุด (YYYY-MM-DD) */
  holiday_date: string;
  created_by: string | null;
  created_at: string;
};

export type CompanyHolidayDateRow = {
  id: string;
  /** วันที่หยุดบริษัท (YYYY-MM-DD) */
  holiday_date: string;
  title: string;
  description: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type ChatMessage = {
  id: string;
  user_id: string;
  body: string;
  created_at: string;
};

export type AttendanceChatMentionNotificationRow = {
  id: string;
  message_id: string;
  recipient_id: string;
  body: string;
  read_at: string | null;
  created_at: string;
};

export type CommunityPost = {
  id: string;
  user_id: string;
  body: string;
  created_at: string;
};

export type CommunityNote = {
  id: string;
  user_id: string;
  body: string;
  created_at: string;
  updated_at: string;
};

export type CommunityNoteReply = {
  id: string;
  note_id: string;
  user_id: string;
  body: string;
  created_at: string;
};

/** โพสต์ฟีดคอมมูนิตี้ (รูปหรือวิดีโอ + แคปชัน) */
export type CommunityFeedPost = {
  id: string;
  user_id: string;
  image_url: string;
  caption: string | null;
  created_at: string;
  media_type: 'image' | 'video';
  image_layout: 'square' | 'portrait' | 'landscape' | null;
};

/** คอมเมนต์ใต้โพสต์ฟีด (parent_id = ตอบกลับคอมเมนต์ใด) */
export type CommunityFeedComment = {
  id: string;
  post_id: string;
  user_id: string;
  body: string;
  created_at: string;
  parent_id: string | null;
};

/** แถวจาก view employee_directory */
export type EmployeeDirectory = {
  id: string;
  legacy_user_id: string | null;
  employee_no: number | null;
  prefix: string | null;
  name: string | null;
  surname: string | null;
  nickname: string | null;
  position: string | null;
  branch: string | null;
  /** รหัสสาขาในตาราง employee.branch_code (ถ้ามี) */
  branch_code?: string | null;
  branch_id: number | null;
  phone: string | null;
  start_date: string | null;
  national_id: string | null;
  address_id_card: string | null;
  current_address: string | null;
  bank: string | null;
  account_number: string | null;
  status: string | null;
};

/** ผลลัพธ์จาก RPC admin_list_employee_passwords */
export type AdminEmployeePasswordRow = {
  id: string;
  legacy_user_id: string | null;
  legacy_password: string | null;
  employee_no: number | null;
  display_name: string | null;
  branch: string | null;
  /** ค่าจากคอลัมน์ employee.status (RPC หลัง migration 20260521120000) */
  employment_status?: string | null;
};

export type SalaryClaimRow = {
  id: string;
  user_id: string;
  employee_id: string | null;
  claim_month: string;
  base_salary: number;
  eligible_base_amount: number;
  max_claim_amount: number;
  requested_amount: number;
  full_name: string | null;
  bank_name: string | null;
  account_number: string | null;
  branch_name: string | null;
  branch_id: number | null;
  note: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'paid';
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
  updated_at: string;
};

export type ExpenseClaimRow = {
  id: string;
  user_id: string;
  employee_id: string | null;
  full_name: string | null;
  bank_name: string | null;
  account_number: string | null;
  branch_name: string | null;
  branch_id: number | null;
  total_amount: number;
  status: 'pending' | 'approved' | 'rejected' | 'paid';
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  payroll_handling: 'undecided' | 'payroll' | 'direct';
  payroll_handling_decided_by: string | null;
  payroll_handling_decided_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ExpenseClaimItemRow = {
  id: string;
  expense_claim_id: string;
  item_title: string;
  amount: number;
  note: string | null;
  evidence_url: string;
  evidence_name: string | null;
  created_at: string;
};

export type PayrollCompensationRow = {
  user_id: string;
  base_salary: number;
  position_allowance: number;
  special_allowance: number;
  diligence_allowance: number;
  travel_allowance: number;
  commission: number;
  other_income: number;
  overtime_hourly_rate_mode?: 'auto' | 'manual';
  overtime_manual_hourly_rate?: number | null;
  overtime_multiplier?: number | null;
  social_security_mode: 'auto' | 'manual';
  social_security_manual_amount: number | null;
  withholding_tax_mode: 'auto' | 'manual';
  withholding_tax_manual_amount: number | null;
  notes: string | null;
  updated_by: string | null;
  updated_at: string;
};

export type PayrollSlipRow = {
  id: string;
  user_id: string;
  employee_id: string | null;
  cycle_key: string;
  period_start: string;
  period_end: string;
  status: 'draft' | 'confirmed' | 'paid' | 'voided';
  taxable_income: number;
  reimbursement_total: number;
  income_total: number;
  deduction_total: number;
  net_pay: number;
  generated_by: string | null;
  generated_at: string;
  confirmed_by: string | null;
  confirmed_at: string | null;
  paid_by?: string | null;
  paid_at?: string | null;
  voided_by?: string | null;
  voided_at?: string | null;
  void_reason?: string | null;
  reissued_from_slip_id?: string | null;
  employee_confirmed_by?: string | null;
  employee_confirmed_at?: string | null;
  notes: string | null;
};

export type PayrollItemKind = 'income' | 'deduction' | 'reimbursement';

export type PayrollItemRow = {
  id: string;
  slip_id: string;
  item_kind: PayrollItemKind;
  item_code: string;
  label: string;
  amount: number;
  taxable: boolean;
  source_table: string | null;
  source_id: string | null;
  sort_order: number;
  created_at: string;
};

export type FinanceClaimNotificationRow = {
  id: string;
  recipient_id: string;
  actor_id: string | null;
  claim_kind: 'salary' | 'expense';
  claim_id: string;
  event_type: 'submitted' | 'status_updated';
  status: 'pending' | 'approved' | 'rejected' | 'paid' | null;
  body: string;
  read_at: string | null;
  created_at: string;
};

export type StatusNotificationRow = {
  id: string;
  recipient_id: string;
  actor_id: string | null;
  event_type: 'leave_status' | 'overtime_status';
  entity_kind: 'leave' | 'overtime';
  entity_id: string;
  status: string;
  body: string;
  read_at: string | null;
  created_at: string;
};

export type AttendanceOvertimeRequestRow = {
  id: string;
  user_id: string;
  work_date: string;
  source: 'shift' | 'legacy' | 'manual';
  overtime_kind?: 'after_work' | 'before_work' | 'manual';
  plan_title: string | null;
  plan_start_at: string;
  plan_end_at: string;
  prompt_at: string;
  response_deadline_at: string;
  status: 'pending' | 'accepted' | 'declined' | 'auto_checked_out';
  responded_at: string | null;
  auto_checked_out_at: string | null;
  approval_status?: 'pending' | 'approved' | 'rejected';
  approved_by?: string | null;
  approved_at?: string | null;
  approval_note?: string | null;
  reason?: string | null;
  manual_minutes?: number | null;
  manual_created_by?: string | null;
  created_at: string;
  updated_at: string;
};
