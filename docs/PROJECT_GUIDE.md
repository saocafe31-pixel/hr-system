# HR System — คู่มือโปรเจกต์สำหรับทีมและ AI Agents

เอกสารนี้สรุปโครงสร้าง บทบาท การเชื่อมหน้าจอกับข้อมูล และสถานะความคืบหน้า **ให้อ่านก่อนแก้โค้ดหรือเพิ่มฟีเจอร์** และให้ **อัปเดตส่วน “ความคืบหน้า” และ “การเปลี่ยนแปลงล่าสุด”** เมื่องานสำคัญเสร็จ

---

## 1) โครงสร้างโฟลเดอร์หลัก

| พาธ | บทบาท |
|------|--------|
| `mobile/` | แอป **Expo Router** (iOS / Android / Web PWA) — UI หลักทั้งหมด |
| `supabase/migrations/` | Schema, RLS, functions, triggers — **แหล่งความจริงของ DB** |
| `supabase/functions/` | Edge Functions (เช่น `push-dispatch`, `webpush-dispatch`) |
| `supabase/schema.sql` | สำเนา/อ้างอิง schema (อาจไม่ sync กับ remote เสมอ — อิง migrations เป็นหลัก) |
| ราก `package.json` | สคริปต์ **Supabase CLI**, Vercel, ชี้ไปรัน `mobile` |

**หมายเหตุโครงสร้าง Git:** โฟลเดอร์ `mobile/` อาจมี `.git` ซ้อน (nested repo) จากการ init แยก — ถ้า commit จากราก `HR System` ให้ตรวจว่าไฟล์ใน `mobile/` ถูก track ตามที่ต้องการ

---

## 2) กฎการทำงานเมื่อพัฒนา (สำหรับ Agents)

1. **แอป Expo รันจาก `mobile/` เท่านั้น** — ดู `mobile/README.md`
2. **เปลี่ยน DB ผ่าน migrations** ใน `supabase/migrations/` แล้ว `npm run db:push` (จากรากโปรเจกต์) หรือ flow ที่ทีมใช้
3. **อย่า commit ลับ** — `.env`, keys, tokens ใช้ env / Supabase dashboard
4. **RLS** มีผลกับทุก query จาก client — ถ้าข้อมูล “ไม่ขึ้น” ให้เช็ก policy และว่าใช้ view/RPC ที่ถูกต้องหรือไม่
5. **แก้ UI ให้สอดคล้องธีม** — `mobile/constants/Theme.ts`, `NatureTheme`
6. **Modal บน Web** — ใช้ pattern `position: fixed` + `zIndex` สูงเมื่อจำเป็น (ดู `FriendlyNoticeModal`, `CuteToastContext`, บาง modal ใน attendance/admin)
7. **หลังฟีเจอร์ใหญ่** — อัปเดตส่วน **§8 ความคืบหน้า** และ **§9 การเปลี่ยนแปลงล่าสุด** ในไฟล์นี้

---

## 3) บทบาทผู้ใช้ (`profiles.role`)

| Role | สิ่งที่ทำได้โดยสรุป |
|------|---------------------|
| `employee` | เข้า-ออกงาน, งานของตัวเอง, แชทเข้า-ออก, คอมมูนิตี้, โปรไฟล์ — **ไม่เห็น** แท็บตาราง/ทีม/แอดมิน |
| `manager` | ทุกอย่างของ employee + **ตารางงาน**, **ทีม**, มอบหมายงาน — **ทีม / อนุมัติลา / จัดกะลูกทีม** ถูกจำกัดด้วย `manager_scopes` + `manager_direct_reports` (แอดมินเป็นคนกำหนด) |
| `admin` | ทุกอย่างของ manager + **แอดมิน** (สาขา, HR legacy, เชื่อมบัญชี, โควตาลา, ประกาศ, ตั้งค่า, **สิทธิ์ผู้จัดการ & ลูกทีม**) |

การตรวจ role ใช้ `mobile/contexts/AuthContext.tsx` (`isAdmin`, `isManagerOrAdmin`, `useRole`)

---

## 4) แท็บและหน้าหลัก (Expo Router)

ไฟล์ layout: `mobile/app/(app)/_layout.tsx`

| แท็บ / หน้า | ไฟล์หลัก | เห็นเมื่อ |
|-------------|-----------|-----------|
| เวลาเข้า-ออก | `attendance.tsx` | ทุกคน |
| งาน | `tasks.tsx` | ทุกคน |
| ตาราง | `schedule.tsx` | manager+ |
| ทีม | `team.tsx` | manager+ |
| แชทเข้า-ออก | `chat.tsx` | ทุกคน |
| คอมมูนิตี้ | `community.tsx` | ทุกคน |
| โปรไฟล์ | `profile.tsx` | ทุกคน |
| แอดมิน | `admin.tsx` | admin |
| สุขภาวะ (ซ่อนจาก tab) | `wellbeing.tsx` | นำทางภายใน |
| สถานะมอบหมาย (ซ่อน) | `tasks-assigned.tsx` | นำทางภายใน |

ล็อกอิน: `mobile/app/login.tsx`, root: `mobile/app/index.tsx`

---

## 5) การเชื่อมข้อมูลระหว่างหน้าจอกับ Supabase

- **Client:** `mobile/lib/supabase.ts` + `@supabase/supabase-js`
- **ตัวตน:** `auth.uid()` → join กับ `profiles.id`
- **เชื่อม HR:** `profiles.employee_id` → FK ไป `employee.id` (uuid) เมื่อเชื่อมแล้ว โปรไฟล์/ลา/บางรายงานจะดึงข้อมูล HR ได้
- **Admin รายชื่อพนักงาน legacy:** RPC `admin_list_employee_passwords` (คืนค่า `employment_status` จาก `employee.status` + ปุ่มลบ/ลาออกในแอป) — ไม่ใช้ `employee_directory` อย่างเดียวเพราะ RLS
- **Admin บันทึกลาออก:** RPC `admin_record_employee_resignation` → แทรก `employee_resignations` และตั้ง `employee.status` เป็นลาออก
- **Admin โหลดฟอร์ม HR รายคน:** RPC `admin_get_employee_directory_row`
- **Admin รายชื่อ HR ทั้งหมด (ทีมแอดมิน):** RPC `admin_list_employee_directory_rows` (เฉพาะ role `admin`)
- **Manager รายชื่อทีมที่ดูแล:** RPC `manager_list_team_directory_rows` (สมาชิกใน `manager_direct_reports` ที่โปรไฟล์มี `employee_id`)
- **แอดมินตั้งสิทธิ์ผู้จัดการ:** RPC `admin_set_manager_scope`, `admin_set_manager_direct_reports` — เพิ่ม Admin/HR เข้า `manager_direct_reports` ได้เพื่อให้ manager มอบหมายงาน/ดูทีมตามโครงสร้างองค์กร
- **มอบหมายงาน (หน้างาน + หน้าทีม):** RPC `create_manager_task_bundle` — สร้าง `tasks` + `task_assignees` + `task_checklist_items` แบบ `SECURITY DEFINER` เพื่อไม่ให้โดน RLS บน client; ตรวจสิทธิ์จาก direct reports / ผู้จัดการ / สาขาใน RPC
- **Admin แก้/ลบประวัติลาและขอเข้าสาย:** RPC `admin_update_leave_request`, `admin_delete_leave_request`, `admin_update_late_request`, `admin_delete_late_request` — ใช้จากหน้า `team` เฉพาะ role `admin` เพื่อแก้หรือลบรายการและคืนสิทธิ์ตามสูตรโควต้าเดิม

---

## 6) ตาราง / view ที่หน้าต่างๆ ใช้ (อ้างอิงหลัก)

> รายการนี้สรุปจาก `.from(...)` / RPC ในโค้ด — ตารางเสริมอื่นอาจมีใน migrations

### Core & org

| ชื่อ | ใช้ทำอะไร |
|------|-----------|
| `profiles` | บัญชี, role, branch_id, employee_code, employee_id, avatar, expo_push_token |
| `manager_scopes` | สิทธิ์เสริมผู้จัดการ: `can_approve_leave`, `can_manage_schedule` (แอดมินเขียน) |
| `manager_direct_reports` | คู่ manager_id ↔ subordinate_id (คนในทีม/direct reports — แอดมินเขียน; รองรับ Admin/HR เพื่อให้ manager มอบหมายงานได้) |
| `employee` | ข้อมูล HR legacy (คอลัมน์ mixed case เช่น `UserID`) — คอลัมน์ `branch_id` เป็น FK ไป `branch_information.id` และคอลัมน์ `branch/branch_code` เป็นสำเนาแสดงผลเพื่อ compatibility; คอลัมน์ `status` ใช้แยกทำงานอยู่ / ลาออก |
| `employee_resignations` | ประวัติการลาออกที่แอดมินบันทึก (`employee_id` อาจ null หลังลบพนักงาน) |
| `employee_directory` | **view** อ่านข้อมูลพนักงานแบบรวม — โดน RLS ตาม policy |
| `branch_information` | สาขา, พิกัด, รัศมี (check-in) |

### เข้า-ออกงาน & แชท

| ชื่อ | ใช้ทำอะไร |
|------|-----------|
| `attendance_logs` | บันทึก check-in/out, break |
| `attendance_chat_messages` | แชทสายเข้า-ออก / แจ้งเตือนในแชท — แอดมินลบย้อนหลังผ่าน RPC `admin_delete_attendance_chat_messages_older_than` (นับวันที่ตาม Asia/Bangkok; แอป: ไอคอนถังขยะในแชท) |
| `attendance_chat_mention_notifications` | mention @ ในแชท — ลบตามเมื่อลบ `attendance_chat_messages` (FK cascade) |
| `attendance_overtime_requests` | OT prompt/คำขอ OT ก่อนเข้างานหรือหลังเลิกงาน (`overtime_kind`) พร้อมเหตุผล (`reason`) + สถานะอนุมัติ OT (`approval_status/approved_*`) สำหรับ manager/admin; รองรับ OT แมนนวลจากแอดมิน/HR (`overtime_kind='manual'`, `manual_minutes`); คิวอนุมัติแสดงเฉพาะรายการที่พนักงานกดขอพร้อมเหตุผลและเวลาจริงครบ 1 ชม.ขึ้นไป |
| `wellbeing_checkins` | อารมณ์หลังเข้างาน |
| `leave_requests` | คำขอลา; คอลัมน์ `is_kpi_exempt/admin_adjusted_*` ใช้สำหรับรายการลาที่แอดมิน/HR คีย์ย้อนหลังจากตารางเวลาเพื่อให้นับโควตาจริงแต่ไม่หัก KPI |
| `late_requests` | ขอเข้าสาย |
| `work_schedules` | ตารางแบบ legacy (ช่วงเวลา) — RLS select: เจ้าของ, แอดมิน, หรือผู้ใช้ที่ไม่ใช่แอดมินและ `same_branch_as` กับเจ้าของตาราง (อ่านอย่างเดียว) |
| `work_shifts` | เทมเพลตกะ |
| `work_schedule_assignments` | มอบหมายกะรายวัน + `allowed_branch_id` — เก็บย้อนหลังเพื่อใช้คำนวณมาสาย/รายงานย้อนหลัง; migration `20260604042000_disable_work_schedule_assignments_retention` ปิด cron ลบ 30 วันแล้ว — RLS select: เจ้าของ, แอดมิน, ผู้จัดการดูลูกทีม, หรือผู้ใช้ที่ไม่ใช่แอดมินและ `same_branch_as` กับผู้ถูกมอบหมาย (อ่านอย่างเดียว) |
| `notification_preferences` | เปิด/ปิดแจ้งเตือน (task, mention, checkout) |
| `attendance_calendar_notes` | โน้ตและเช็กลิสต์รายวันในปฏิทิน (หน้า attendance + ปฏิทินในโปรไฟล์/ทีม/แชท) — RLS select: เจ้าของ; แอดมิน; ผู้จัดการอ่านลูกทีมได้; ผู้ใช้ที่ไม่ใช่แอดมินและ `same_branch_as` กับเจ้าของโน้ตอ่านได้ (อ่านอย่างเดียว); แก้ไขแทนลูกทีมได้เมื่อ `can_manage_schedule`; แอดมินเต็มสิทธิ์ |

### งาน

| ชื่อ | ใช้ทำอะไร |
|------|-----------|
| `tasks` | งานหลัก — RLS `tasks_delete` อนุญาตลบเฉพาะ `admin` (แอป: ปุ่มลบเฉพาะแอดมิน) |
| `task_checklist_items` | เช็คลิสต์ |
| `task_attachments` | ลิงก์/รูปแนบ |
| `task_notifications` | แจ้งเตือนงาน (ร่วมกับ realtime) |

### คอมมูนิตี้

| ชื่อ | ใช้ทำอะไร |
|------|-----------|
| `community_notes` | โน้ต/กระดาน |
| `community_note_replies` | ตอบกลับโน้ต |
| `community_feed_posts` | ฟีดรูป |
| `community_feed_comments` | คอมเมนต์ใต้โพสต์ |

### การตั้งค่า & ลา

| ชื่อ | ใช้ทำอะไร |
|------|-----------|
| `app_settings` | ค่าระบบ — คีย์ `announcement_slides` เก็บ `{ urls, slides: [{ url, duration_ms }], slide_height_px, transition_mode }` สำหรับสไลด์หน้าเข้า-ออก (รองรับข้อมูลเก่าแบบ `urls`, default 4 วินาทีต่อภาพ, transition `slide`/`fade`); คีย์ `attendance_kpi_settings` เก็บเกณฑ์ KPI ลา/เข้าสาย; คีย์ `payroll_company_info` เก็บ `{ name, address_lines, juristic_id }` สำหรับหัว PDF สลิปเงินเดือน |
| `vacation_grants` | โควตาพักร้อน + sick/personal (คอลัมน์เพิ่มตาม migration) |
| `salary_claims` | คำขอเบิกเงินเดือนล่วงหน้า (ช่วงวันที่ 10–14) พร้อมข้อมูลบัญชีและวงเงินคำนวณ |
| `expense_claims` | หัวคำขอเบิกค่าใช้จ่าย (ยอดรวม + ข้อมูลบัญชีผู้ขอ) พร้อม `payroll_handling` ให้แอดมินเลือกตอนอนุมัติว่าจะลง Payroll/สลิป (`payroll`) หรือบันทึกจ่ายแยกไม่ลงเงินเดือน (`direct`) |
| `expense_claim_items` | รายการเบิกย่อยต่อคำขอ (ชื่อรายการ, ยอด, หมายเหตุ, หลักฐาน) |
| `finance_claim_notifications` | แจ้งเตือนกระดิ่งสำหรับคำขอเบิกเงิน (ส่งคำขอ/อัปเดตสถานะ) |
| `status_notifications` | แจ้งเตือนกระดิ่งสำหรับสถานะคำขอ HR เช่น อนุมัติ/ปฏิเสธลา และอนุมัติ/ปฏิเสธ OT |
| `payroll_employee_compensation` | ตั้งค่าฐานเงินเดือน/ค่าตอบแทนประจำ, สูตรค่า OT (`auto` จากฐานเงินเดือน หรือกรอกต่อชั่วโมง), ตัวคูณ OT และโหมดประกันสังคม/ภาษีต่อพนักงาน (admin-only) |
| `payroll_slips` | สลิปเงินเดือนรายรอบ 26–25 แบบ snapshot สถานะ `draft/confirmed/paid/voided`; พนักงานเห็นเฉพาะ `confirmed/paid` ของตัวเอง โดยจับได้ทั้ง `user_id` และ `employee_id` ที่ผูกกับโปรไฟล์; พนักงานกดยืนยันการตรวจสอบสลิปผ่าน `employee_confirmed_at`; สลิปที่ยกเลิกจะถูกเก็บเป็น `voided` แล้วออก Draft ใหม่ผ่าน workflow reissue ซึ่งรีเซ็ตการยืนยันของพนักงาน |
| `payroll_items` | รายการในสลิป แยก `income`, `deduction`, `reimbursement` พร้อม flag taxable และ source อ้างอิง; รองรับ manual adjustment เฉพาะตอนสลิปยังเป็น `draft` |
| `payroll_slip_events` | audit log ของสลิปเงินเดือน เช่น `generated/confirmed/paid/voided/reissued` พร้อม actor, เหตุผล และ metadata |

### Push (สรุป)

| ชื่อ | ใช้ทำอะไร |
|------|-----------|
| `push_notification_jobs` | คิว push native (Expo) |
| `web_push_notification_jobs` | คิว web push |
| `expense_claim_evidence` (Storage bucket) | หลักฐานไฟล์/รูปของการเบิกค่าใช้จ่าย |

รายละเอียด pipeline: `supabase/PUSH_PIPELINE.md`

---

## 7) Edge Functions & cron ที่เกี่ยวข้อง

- `push-dispatch` — ประมวลผลคิว push ไป Expo
- `webpush-dispatch` — ประมวลผล web push
- `admin-create-employee` — แอดมินสร้างผู้ใช้ Auth + แถว `employee` + อัปเดต `profiles.employee_id` (ต้อง deploy และใช้ JWT แอดมินเรียก `supabase.functions.invoke`)
- `admin_profile_id_for_employee(uuid)` — แอดมินหา `profiles.id` จาก `employee.id` / UserID=email / รหัสพนักงาน (ใช้ในโมดัลวันลาเมื่อ client `.eq(employee_id)` ไม่คืนแถว)
- `app_badge_notif_snapshot(p_chat_seen, p_community_seen, p_limit)` — รวม badge counts + notification feed (task/mention/finance/community) ใน RPC เดียวเพื่อลด round-trip
- `admin_delete_attendance_chat_messages_older_than(p_days)` — แอดมินเท่านั้น (`is_admin()`): ลบ `attendance_chat_messages` ที่วันที่ `created_at` ตามปฏิทิน **Asia/Bangkok** เก่ากว่า `p_days` วันนับจากวันนี้ในเขตไทย (ค่าเริ่ม 90)
- `admin_void_and_reissue_payroll_slip(p_slip_id, p_reason)` — แอดมินเท่านั้น: เปลี่ยนสลิป `confirmed/paid` เป็น `voided`, บันทึก audit event และ clone รายการเดิมออกเป็นสลิป `draft` ใหม่ในรอบเดียวกันเพื่อแก้ไขอย่างปลอดภัย
- `confirm_payroll_slip_review(p_slip_id)` — พนักงานกดยืนยันว่าได้ตรวจสอบสลิป `confirmed/paid` ของตัวเองแล้ว; ใช้ RPC เพื่อจำกัดสิทธิ์เฉพาะเจ้าของสลิป/`employee_id` ที่ผูกกับโปรไฟล์
- DB functions / cron: overtime (`process_attendance_overtime`), triggers เกี่ยว OT และ notification — ดู migrations ช่วง `20260427*`
- DB cron: `prune_work_schedule_assignments_retention_30d()` ถูกปิดแล้วและ function เป็น no-op — เก็บ `work_schedule_assignments` ย้อนหลังไว้เพื่อคำนวณมาสาย/รายงานย้อนหลัง

---

## 8) ความคืบหน้าฟีเจอร์หลัก (สถานะปัจจุบัน — อัปเดตเมื่อมีงานใหม่)

- [x] เข้า-ออกงาน + พักเบรก + สรุปรายงานช่วงวันที่
- [x] ตารางงาน (กะ + มอบหมาย + สาขาที่เข้าได้) + ปฏิทินรายวันในหน้า schedule + ปฏิทินส่วนตัวในหน้า attendance
- [x] OT backend (prompt / timeout / respond RPC) + รองรับ OT หลังเลิกงาน, ก่อนเข้างาน และ OT แมนนวลโดยแอดมิน/HR พร้อมเหตุผล; หลังถึงเวลาเลิกงานตามตาราง 1 นาที ระบบถามทำ OT/ออกงานเลย และถ้าไม่ตอบจะออกงานอัตโนมัติเมื่อครบ 30 นาทีหลังเวลาเลิกงาน; รายการพนักงานกดขอจะขึ้นคิวอนุมัติเมื่อเวลาจริงครบ 1 ชม.ขึ้นไปตามสิทธิ์ manager/admin
- [x] ลา / ขอเข้าสาย + กฎโควตา (รอบ 26–25, ไม่เกิน 2 ครั้งหรือ 30 นาที) + แอดมินแก้วันลาคงเหลือ + คีย์วันลาตกหล่นจากตารางเวลาโดยไม่นับ KPI + แก้/ลบประวัติลาและขอเข้าสายในหน้า team เพื่อคืนสิทธิ์ + เพิ่ม `ลาไม่รับเงิน` สำหรับ payroll deduction
- [x] งาน + checklist + แนบไฟล์ + แจ้งเตือนงาน + การ์ดสถานะงานกำลังทำในหน้าเข้า-ออกและข้อมูลพนักงานหน้า team; manager มอบหมายงานให้คนในทีมรวม Admin/HR ได้เมื่อแอดมินเพิ่มใน `manager_direct_reports`
- [x] แชท + mention notifications
- [x] คอมมูนิตี้ (โน้ต + ฟีด)
- [x] โปรไฟล์ (เมนูการ์ดแยกหมวด, รูป crop, notification prefs, push token path, KPI ลา/ขอเข้าสายรายไตรมาสและภาพรวมปี, ประวัติลา และประวัติใช้สิทธิ์ขอเข้าสาย) + หน้า team modal ข้อมูลพนักงานแสดงสรุปลา/เข้าสาย ประวัติลา ประวัติขอเข้าสาย และ KPI แบบเดียวกับหน้าโปรไฟล์
- [x] ทีม: กราฟสรุปสุขภาพใจ/มาสายสุทธิ/ลาป่วยรอบ 26–25 พร้อมเลือกเดือนและอันดับมาสายแบบครั้ง/นาที (manager/admin เห็นภาพรวมองค์กร; สิทธิ์แก้ไข/อนุมัติยังยึด scope ทีมเดิม)
- [x] แอดมิน: พนักงาน legacy, สาขา, เชื่อม HR, โควตา, ประกาศ, ตั้งค่า, สิทธิ์ผู้จัดการ & ลูกทีม (ทีม manager แบบจำกัดขอบเขต รวม Admin/HR สำหรับมอบหมายงาน) และแก้/ใส่เวลาเข้า-ออกของพนักงานจากหน้า team
- [x] โปรไฟล์: เมนูเบิกเงินเดือน (สูตร 70% ของ 50% ฐานเงินเดือนในช่วงวันที่ 10-14) + เบิกค่าใช้จ่ายหลายรายการพร้อมแนบหลักฐาน + ประวัติ Claim Salary / Expense Claim ของพนักงานเอง
- [x] แอดมิน: เมนูรับคำขอเบิกเงินเดือน/ค่าใช้จ่าย พร้อมแสดงข้อมูลบัญชีและหลักฐานแยกรายการ; รายการที่อนุมัติ/ปฏิเสธ/จ่ายแล้วถูกย้ายไปหน้าประวัติแยกตามหัวข้อ พร้อมกรองตามสถานะและวันที่
- [x] Payroll MVP: หน้า `admin` ตั้งค่าค่าตอบแทนต่อพนักงาน, คำนวณสลิป draft รอบ 26–25, รวม OT ที่อนุมัติแล้วเข้าเงินเดือน, เพิ่ม manual adjustment ก่อนยืนยัน, ยืนยัน/บันทึกจ่ายแล้ว (`draft/confirmed/paid`), export summary/bank transfer CSV, ดูประวัติ/ค้นหา/กรองสลิปย้อนหลัง และยกเลิก/ออกสลิปใหม่แบบ `voided + reissue draft` พร้อม audit log; หน้า `profile` แสดงสลิปที่ยืนยันหรือจ่ายแล้วพร้อมปุ่ม PDF และปุ่มให้พนักงานยืนยันการตรวจสอบสลิป
- [ ] **iOS native build + EAS** — ต้องใช้ Apple Developer Program สำหรับ signing; Android เป็นทางเลือกทดสอบ push
- [ ] ทบทวน **nested git** ใน `mobile/` ให้เหลือ repo เดียว (ถ้าต้องการ)

---

## 9) การเปลี่ยนแปลงล่าสุด (changelog สั้น — อัปเดตเป็นประจำ)

| วันที่ (โดยประมาณ) | สรุป |
|---------------------|------|
| 2026-06-12 | หน้า `admin` > Payroll: เพิ่มทางลัดในหน้าต่าง `ทำ Payroll / ยืนยันสลิป` สำหรับสลิป `confirmed/paid` ให้กด `ออก Draft ใหม่เพื่อแก้ไข` ได้ทันทีเมื่อ Admin/HR ต้องเพิ่ม OT หรือแก้ยอดหลังพนักงานยืนยันสลิปแล้ว โดยสลิปใหม่จะกลับไปให้พนักงานตรวจสอบอีกครั้ง |
| 2026-06-12 | หน้า `profile` > `สลิป / เบิกเงิน`: เพิ่มปุ่มให้พนักงานยืนยันการตรวจสอบสลิปเงินเดือนผ่าน RPC `confirm_payroll_slip_review`; หาก Admin/HR ยกเลิกและออกสลิปใหม่หลังพนักงานเคยยืนยันแล้ว สลิปฉบับใหม่จะกลับมาเป็นสถานะรอตรวจสอบและแสดงแจ้งเตือนในหน้าโปรไฟล์อีกครั้ง |
| 2026-06-12 | Payroll ต่อรอบ 4-6: เพิ่มมุมมองภาพรวมรอบเดือนในหน้า Admin Payroll พร้อมค้นหา/กรองสลิปย้อนหลัง, export Payroll summary CSV และ bank transfer CSV, เพิ่มสถานะ `voided`, audit table `payroll_slip_events` และ RPC `admin_void_and_reissue_payroll_slip` สำหรับยกเลิกสลิปที่ยืนยัน/จ่ายแล้วและออก Draft ใหม่อย่างปลอดภัย; ปรับ UI เป็นการ์ดเมนูแยก `ทำ Payroll / ยืนยันสลิป` กับ `สรุปภาพรวม Payroll` และเปิดฟอร์มรายพนักงานในหน้าต่าง modal |
| 2026-06-12 | Payroll ต่อรอบ 1-3: เพิ่มค่า OT ที่อนุมัติแล้วเข้า draft payroll ตามสูตรต่อพนักงาน (`ฐานเงินเดือน/30/8 x ตัวคูณ` หรือค่า OT ต่อชั่วโมงแบบ manual), เพิ่ม manual adjustment เฉพาะสลิป `draft`, และเพิ่มสถานะสลิป `paid` พร้อม RLS ให้พนักงานเห็น `confirmed/paid` |
| 2026-06-12 | หน้า `profile` > `สลิป / เบิกเงิน`: เพิ่มประวัติ `Claim Salary` และ `Expense Claim` ของพนักงานเอง แสดงสถานะ ยอดเงิน วันที่ส่ง/ตรวจ หมายเหตุแอดมิน วิธีจ่ายของ Expense Claim และรายการย่อยพร้อมหลักฐาน |
| 2026-06-12 | ปรับหน้า `admin` เมนูหลักรอบมือถือให้ใช้ grid แบบเปอร์เซ็นต์ 2 คอลัมน์คล้ายหน้าโปรไฟล์ แทนการคำนวณ width จาก viewport เพื่อไม่ให้การ์ดไหลเป็นคอลัมน์เดียว และเพิ่มขนาดการ์ด/ไอคอนให้อ่านง่ายขึ้น |
| 2026-06-12 | หน้า `admin` > Expense Claim: เมื่อกดอนุมัติจะถามผู้อนุมัติว่าจะลง `Payroll / สลิปเงินเดือน` หรือ `จ่ายแยก ไม่ลงเงินเดือน`; เพิ่ม `expense_claims.payroll_handling` และปรับ Payroll ให้ดึงเฉพาะรายการที่เลือกเข้า payroll |
| 2026-06-12 | ปรับหน้า `admin` เมนูหลักให้การ์ดมีขนาดเท่ากัน คำนวณคอลัมน์ตามขนาดหน้าจอ (มือถือ 2 คอลัมน์, จอใหญ่เพิ่มคอลัมน์), แยกไอคอน/เลขเมนู/ข้อความให้สมดุล และจำกัดบรรทัดเพื่อไม่ให้การ์ดยืดหรือแถวสุดท้ายล้น/ยาวผิดรูป |
| 2026-06-12 | ปรับ OT หลังเลิกงาน: `process_attendance_overtime()` สร้าง popup/คำขอ OT หลังเวลาเลิกงานตามตาราง 1 นาที, ตั้ง auto checkout ที่ 30 นาทีหลังเวลาเลิกงานหากไม่ตอบ และปรับข้อความ popup หน้า `attendance` เป็นปุ่ม `ทำโอที` / `ออกงานเลย` |
| 2026-06-09 | ปรับ `DatePickerField` กลางให้เหมาะกับมือถือ: bottom sheet มีขอบซ้ายขวาไม่ชน/ล้นจอ, ช่องเลือกวันที่ยืดตามพื้นที่ และแถวปุ่มด้านล่าง wrap ได้ ส่งผลกับทุกหน้าที่ใช้เลือกวันที่ เช่น chat, attendance, team, schedule, tasks |
| 2026-06-09 | หน้า `chat` เพิ่มตัวกรองวันที่รายวันสำหรับแชทเข้า-ออกงาน ค่าเริ่มต้นเป็นวันนี้ โหลดเฉพาะข้อความในวันที่เลือกตามเขต Asia/Bangkok และยังคงเรียงข้อความล่าสุดไว้ด้านล่างเหมือนเดิม |
| 2026-06-09 | ปรับ UX หน้า `admin`: เมนูแอดมินเป็น grid responsive 2 คอลัมน์บนมือถือและเพิ่มคอลัมน์ตามหน้าจอ; หน้า Payroll เปลี่ยนเลือกรอบเงินเดือนเป็นการ์ดแนวนอนแบบเลื่อน, เลือกพนักงานผ่าน dropdown/modal ค้นหา; หน้าโปรไฟล์เพิ่มการเลือกรอบเดือนแบบเลื่อนเพื่อดูสลิปแต่ละรอบ และเปิดหน้าต่างพิมพ์ PDF แบบ synchronous เพื่อลด popup blocker บนมือถือ |
| 2026-06-09 | ปรับหัว PDF สลิปเงินเดือนให้ซ้ายเป็นข้อมูลบริษัทจาก `app_settings.payroll_company_info` (ชื่อบริษัท, ที่อยู่, เลขนิติบุคคล) และขวาเป็นชื่อเอกสาร/รอบเงินเดือน; หน้า Admin มีฟอร์มกรอกข้อมูลบริษัทโดยตรงและยังคง JSON ขั้นสูงสำหรับ key อื่น |
| 2026-06-09 | เพิ่มปุ่ม `พิมพ์ / ดาวน์โหลด PDF` สำหรับสลิปเงินเดือนทั้งหน้า `profile` และ `admin`; ใช้ utility กลางสร้าง HTML/PDF แสดงชื่อพนักงาน ข้อมูลรับเงินจาก HR (`bank`, `account_number`), รอบเงินเดือน ยอดสุทธิ รายได้ รายการหัก และเงินคืน/เบิกจ่าย |
| 2026-06-09 | แก้การมองเห็นสลิปเงินเดือนหลังแอดมินยืนยัน: หน้า `profile` query สลิปด้วย `user_id` หรือ `employee_id` ที่ผูกกับโปรไฟล์, RLS ของ `payroll_slips/payroll_items` รองรับ `employee_id`, และปุ่มยืนยันฝั่งแอดมินตรวจว่า update สำเร็จจริงก่อนแจ้งสำเร็จ |
| 2026-06-09 | ปรับหน้า `profile` จากหน้ารวมยาวเป็นเมนูการ์ดแยกหมวด เช่น โปรไฟล์, แจ้งเตือน, ลา & เข้าสาย, ข้อมูล HR, สลิป/เบิกเงิน, รายชื่อทีม/แอดมิน และบัญชี พร้อมปุ่มกลับสู่เมนูโปรไฟล์ |
| 2026-06-09 | ปรับหน้า `admin` จากหน้ารวมยาวเป็นเมนูการ์ด 9 หมวด พร้อมไอคอน; เมื่อกดการ์ดจะเข้าสู่หน้าต่างของหมวดนั้นและมีปุ่มกลับสู่เมนูแอดมิน |
| 2026-06-09 | เพิ่ม migration ให้ RPC `admin_update_leave_request` รองรับ `leave_type='unpaid'` เพื่อให้ปุ่มแก้ไขรายการลาในหน้า `team` จัดการลาไม่รับเงินได้หลังเพิ่ม Payroll |
| 2026-06-09 | เพิ่ม Payroll MVP: migration ตาราง `payroll_employee_compensation`, `payroll_slips`, `payroll_items`; ขยาย `leave_requests.leave_type` รองรับ `unpaid`; หน้า `admin` เพิ่ม Payroll panel สำหรับตั้งค่าฐานเงินเดือน/รายได้/รายการหักและสร้าง/ยืนยันสลิป; หน้า `profile` เพิ่มการ์ดสลิปเงินเดือนที่ยืนยันแล้ว |
| 2026-06-08 | หน้า `team` เพิ่มปุ่ม `แก้ไข/ลบรายการ` ในประวัติลาและประวัติใช้สิทธิ์ขอเข้าสายเฉพาะ role `admin`; เพิ่ม RPC admin-only สำหรับแก้/ลบ `leave_requests` และ `late_requests` เพื่อคืนสิทธิ์ตามข้อมูลที่ถูกลบ/แก้ |
| 2026-06-04 | แก้การ์ด `ประวัติการใช้สิทธิ์ขอเข้าสาย` ให้ดึงเหตุผลจาก `late_requests.note` (คอลัมน์จริง) แทน `reason` เพื่อให้ประวัติแสดงตรงกับโควต้าขอเข้าสายที่ถูกนับแล้ว |
| 2026-06-04 | หน้า `community` ลดอาการ Safari/web reload ค้าง: ปิด background interval/realtime reload บนเว็บ, ลดจำนวนโพสต์ที่โหลดต่อรอบ และให้วิดีโอในฟีด mount เมื่อแตะโหลดเท่านั้น |
| 2026-06-04 | หน้า `schedule` เอาปุ่ม `+ ตาราง ISO` และส่วนตาราง ISO legacy ออกจากหน้าหลัก เพิ่มปฏิทินตารางงานรายวัน; แตะวันที่เพื่อเปิด modal รายละเอียดที่จัดกลุ่มตามสาขา พร้อมจำนวนคนเข้างานและรายการพนักงาน/ตำแหน่ง/กะ |
| 2026-06-04 | ปิด cron ลบ `work_schedule_assignments` เก่ากว่า 30 วัน และเปลี่ยน function prune เป็น no-op เพื่อเก็บตารางงานย้อนหลังไว้ใช้คำนวณมาสาย/รายงานย้อนหลัง |
| 2026-06-04 | หน้า `team` กราฟเส้นสรุปรายวัน: แก้ช่วง `ทั้งหมด` ให้โหลดข้อมูลแบบแบ่งหน้าไม่ติด limit 1,000 แถว และตัดแกนกราฟสิ้นสุดที่วันปัจจุบันเสมอ (เช่น 29-30-31-1-2-3-4) |
| 2026-06-04 | หน้า `team` กราฟสรุปข้อมูลการทำงาน: เปลี่ยนกราฟแท่งสุขภาพใจ/มาสายสุทธิ/ลาป่วยรายวันเป็นกราฟเส้นรวม 3 สีในกราฟเดียว เปิดที่ช่วง 7 วันล่าสุดถึงวันปัจจุบันเสมอ เลื่อนย้อนหลังได้ และแตะ/ชี้จุดเพื่อดูค่าแบบ tooltip |
| 2026-06-04 | หน้า `team` กราฟสรุปข้อมูลการทำงาน: รวมการ์ดจัดอันดับมาสาย/ลาป่วยเป็นการ์ดเดียวพร้อมปุ่มสลับข้อมูล และเพิ่มปุ่มช่วงเดือน `ทั้งหมด` เพื่อดูข้อมูลรวมทุกเดือนที่แสดง |
| 2026-06-04 | หน้า `community` ปรับ background reload ให้ไม่เอา request เก่ามาทับ state ใหม่, ไม่ทับโน้ตที่กำลังพิมพ์ และลด realtime ที่กว้างเกินไปเหลือเฉพาะตารางคอมมูนิตี้เพื่อลดอาการเด้งกลับ/ข้อมูลเก่า |
| 2026-05-27 | หน้า `admin` เปลี่ยนการยืนยันปุ่ม `ลาออก` และ `ลบพนักงาน` จาก browser confirm เป็นโมดัลในแอป พร้อมแสดงชื่อ/รหัสพนักงานและคำเตือนก่อนยืนยัน |
| 2026-05-27 | เปิดให้แอดมินเพิ่มบัญชี Admin/HR เข้า `manager_direct_reports` ได้ และปรับรายชื่อมอบหมายงานในหน้า `tasks`/`team` ให้ manager เลือกคนในทีมกลุ่มนี้ได้แม้ข้อมูล HR employee ยังไม่ครบ |
| 2026-05-27 | ปรับ loading บนมือถือให้เล็กลงอีก: เอากรอบการ์ดพื้นหลังออก เหลือโลโก้ลอย + หลอดโหลดเล็ก และเปลี่ยน loading แรกของเว็บแอป (`app/index`, font loading ใน root layout) ให้ใช้ดีไซน์เดียวกัน |
| 2026-05-27 | ปรับ `AppLoadingScreen` ให้ใช้โลโก้ loading จาก Supabase Storage (`logo/MENU.png`) พร้อมเส้น shimmer บนโลโก้และหลอดโหลดขนาดเล็กลง |
| 2026-05-27 | หน้า `team` กราฟสรุปข้อมูลการทำงานของ role `manager` เปลี่ยนเป็นภาพรวมองค์กรเหมือน admin; เพิ่ม migration เปิด select source rows สำหรับ analytics ให้ manager โดยสิทธิ์ mutation/approval ยังใช้กฎเดิม |
| 2026-05-27 | ลดขนาด `AppLoadingScreen` ให้กระชับขึ้นบนมือถือ โดยย่อ card/logo/orbit/progress bar แต่ยังคงแอนิเมชันโลโก้และแถบโหลดเดิม |
| 2026-05-27 | เพิ่ม `AppLoadingScreen` กลางสำหรับหน้าโหลดหลัก ใช้โลโก้แอปพร้อมแอนิเมชันวงแหวน/แถบโหลด และนำไปใช้กับหน้า attendance, tasks, team, schedule, chat, community, admin และ tasks-assigned |
| 2026-05-27 | ย้ายกราฟสรุปข้อมูลการทำงานจากหน้า `admin` ไปหน้า `team` โดยแยกเป็นคอมโพเนนต์ `WorkAnalyticsPanel`; manager เห็นข้อมูลตามรายชื่อทีมที่มีสิทธิ์ ส่วน admin เห็นภาพรวมทั้งระบบ |
| 2026-05-27 | กราฟสรุปงานเลือกเดือนแบบชิปชื่อเดือน (ยังคำนวณรอบ 26–25), แยกสีกราฟ/การ์ดตามประเภท (มาสายสีส้ม, ลาป่วยสีม่วง), คำนวณอันดับมาสายจากสูตรมาสายสุทธิเดียวกับหน้าโปรไฟล์ และเพิ่มปุ่มสลับเรียงอันดับมาสายตามจำนวนครั้ง/นาทีรวม |
| 2026-05-27 | หน้า `admin` เพิ่มกราฟสรุปข้อมูลการทำงานรอบ 26–25: สุขภาพจิตใจเฉลี่ยรายวัน, แนวโน้มการมาสายพร้อมเฉลี่ย/สูงสุด/ต่ำสุด, กราฟลาป่วยรายวัน และอันดับ 10 พนักงานมาสายบ่อย/ลาป่วยบ่อย |
| 2026-05-27 | หน้า `chat` ดาวน์โหลด CSV เวลาเข้า-ออกงานจาก `attendance_logs` เฉพาะวันที่มีเวลาเข้า/ออกจริง ไม่สร้างแถววันที่ว่าง โหลดข้อมูลแบบแบ่งหน้าเพื่อไม่ติด limit 1,000 แถว พร้อมคอลัมน์ วันที่, เวลาเข้างาน, เวลาออกงาน, รหัสพนักงาน, ชื่อเล่น, สถานที่เข้างาน |
| 2026-05-27 | เพิ่ม OT แมนนวลในหน้า `team` > ข้อมูลพนักงาน: แอดมิน/HR กรอกชั่วโมง OT และเหตุผลรายวันในตารางสรุปเวลาได้; บันทึกเป็น `attendance_overtime_requests.overtime_kind='manual'` พร้อม `manual_minutes` และสถานะอนุมัติแล้ว |
| 2026-05-27 | ปรับเงื่อนไข OT เป็น 1 ชั่วโมงขึ้นไป: หลังเลิกงานจะถาม OT เมื่อเลยเวลา 60 นาทีและต้องระบุเหตุผล; ก่อนเข้างานถ้าเช็กอินก่อนกะอย่างน้อย 60 นาทีจะแสดง popup ขออนุมัติ OT พร้อมเหตุผล; หน้า team แสดงเฉพาะคำขอที่มีเวลาจริงครบ 1 ชม.และมีเหตุผล |
| 2026-05-27 | ปรับอนุมัติ OT: หน้า `team` เพิ่มคิว `อนุมัติ OT` คู่กับอนุมัติลา โดยแสดงเฉพาะรายการที่พนักงานกดต้องการทำ OT (`attendance_overtime_requests.status='accepted'`) และซิงค์สถานะกับกล่อง OT ในข้อมูลพนักงานทันที; รายการไม่ทำ OT/ออกงานอัตโนมัติไม่แสดงในคิวอนุมัติ |
| 2026-05-27 | Normalize สาขาในตาราง `employee`: เพิ่ม `employee.branch_id` เป็น FK ไป `branch_information`, backfill จาก `profiles.branch_id`/`branch_code`/ชื่อสาขาเดิม, sync `branch/branch_code` จากข้อมูลสาขาจริง และปรับ `employee_directory`/RPC/หน้า `admin`/`team` ให้เลือกและแสดงสาขาจาก `branch_information` |
| 2026-05-27 | หน้า `attendance` และ `team` modal ตารางสรุปเวลาเข้า-ออกงานเพิ่มคอลัมน์เวลารวมทำงาน, เวลาพัก, OT, สถานะอนุมัติ OT พร้อมการ์ดสรุปรอบเงินเดือน 26–25; ส่วนรายการ OT ในข้อมูลพนักงานหน้า `team` เป็นกรอบเลื่อนดูข้อมูล |
| 2026-05-26 | เพิ่ม approval layer สำหรับ OT: `attendance_overtime_requests.approval_status`, RPC `respond_overtime_approval`, หน้า `team` แสดงรายการ OT ของพนักงานในรอบ 26–25 พร้อมคำนวณนาที OT จากเวลาออกงานจริงเทียบเวลาเลิกงานตามตาราง; manager เห็นเฉพาะลูกทีม direct reports ส่วน admin เห็นทั้งหมด |
| 2026-05-26 | เพิ่ม `status_notifications` และขยาย `app_badge_notif_snapshot`/กระดิ่งแจ้งเตือนให้รับสถานะอนุมัติ/ปฏิเสธลาและ OT; การเงินยังใช้ `finance_claim_notifications` เดิมและรวมในกระดิ่งเหมือนเดิม |
| 2026-05-26 | หน้า `team` modal ตารางเวลาแอดมิน/HR: บันทึกสถานที่/หมายเหตุไม่หาย, เพิ่มคอลัมน์เลือกประเภทลา (ลาป่วย/ลากิจ/พักร้อน) เพื่อคีย์ลาตกหล่นเป็น `leave_requests.is_kpi_exempt=true` ให้นับโควตาจริงแต่ไม่หัก KPI; หน้า `profile` และ `team` เพิ่มการ์ดประวัติการใช้สิทธิ์ขอเข้าสายในปีปัจจุบัน |
| 2026-05-26 | หน้า `team` modal ข้อมูลพนักงาน: ตารางเวลาเข้า-ออกงานของแอดมิน/HR เปลี่ยนจากปุ่มบันทึกรายวันเป็นปุ่ม `บันทึกทั้งหมด` เพื่อกรอกหลายวันแล้วบันทึกครั้งเดียว พร้อม validate เวลา `HH:mm` ก่อนบันทึก |
| 2026-05-26 | แก้ KPI ลาป่วย: ถ้าหาเวลาเริ่มงานจากกะ/legacy ไม่เจอจะ fallback เป็น 09:00 แทน 00:00 และไม่ให้ assignment ที่ไม่มีข้อมูล shift ไปบล็อก fallback ตาราง legacy — กรณีแจ้ง 07:50 ก่อนกะ 09:00 จะไม่ถูกหัก “น้อยกว่า 1 ชม.” |
| 2026-05-25 | หน้า `admin` ส่วนรูปประกาศหน้าเข้า-ออกงานเพิ่มปุ่มเลื่อนลำดับภาพขึ้น/ลง, ตั้งเวลาแสดงรายภาพ และเลือก transition `สไลด์`/`เลือนหาย`; carousel หน้า `attendance` ปัดเองได้, อ่าน `slides.duration_ms` ต่อภาพ, fallback 4 วินาที และวนจากภาพสุดท้ายไปภาพแรกแบบต่อเนื่องไม่สไลด์ย้อนกลับ |
| 2026-05-25 | หน้า `team` modal ข้อมูลพนักงานเพิ่มส่วน `ลา & เข้าสาย`, `ประวัติการลา`, `KPI การลา / ขอเข้าสาย` และสรุปเวลามาสายรอบ 26–25 แบบเดียวกับหน้า `profile`; เพิ่ม RLS ให้ manager อ่านข้อมูล leave/vacation/late ของ direct reports เพื่อคำนวณ KPI |
| 2026-05-25 | หน้า `schedule`: modal รายละเอียดมอบหมายรายพนักงานเพิ่ม checkbox เลือกหลายรายการ, เลือกทั้งหมด, แก้ไขหลายรายการ (กะ/สาขาที่เข้าได้) และลบหลายรายการพร้อมยืนยัน |
| 2026-05-25 | หน้า `tasks-assigned`: แสดงชื่อ/ชื่อเล่นผู้มอบหมายและผู้รับผิดชอบแทน UUID โดยดึงจาก `profiles` + `employee_directory` พร้อม fallback เป็นรหัสย่อ |
| 2026-05-25 | Popup ตารางงาน/โน้ต/Live Work (`EmployeeScheduleCalendarCard`): แตะงานในส่วน Live Work เพื่อเปิด `TaskDetailModal` ดูรายละเอียดงาน/เช็กลิสต์/ไฟล์แนบ/สถานะได้จากโปรไฟล์หน้าแชทและหน้าทีม |
| 2026-05-25 | ปรับ badge/notification read-state: เข้าแท็บ `tasks` จะ mark `task_notifications` อ่านแล้ว, เข้าแท็บ `chat` จะ mark mention ในแชทอ่านแล้ว, community seen sync ข้าม tab/กระดิ่ง และเปิดกระดิ่งจะทำเครื่องหมายรายการที่เห็นว่าอ่านแล้วทันทีเพื่อลดเลขค้าง/ซ้ำ |
| 2026-05-25 | หน้า `profile`: ส่วน `ลา & เข้าสาย` เพิ่มการ์ดประวัติการลา พร้อมสถานะคำขอ (รออนุมัติ/อนุมัติ/ปฏิเสธ), ช่วงวันที่, จำนวนวัน, เหตุผล และ popup ดูประวัติทั้งหมดของปี |
| 2026-05-22 | `EmployeeScheduleCalendarCard`: popup รายวันรวมตารางงาน + โน้ต/เช็กลิสต์ + Live Work งานที่กำลังทำ พร้อม animation; ใช้เหมือนกันทั้ง modal ข้อมูลพนักงานหน้า `team` และโปรไฟล์พนักงานจากหน้า `chat` โดยเปิดอัตโนมัติเมื่อมีตาราง/โน้ต/งาน active |
| 2026-05-22 | หน้า `tasks`/`attendance`/`team`: พนักงานสร้างงานรูทีน/งานทั่วไปพร้อมเลือกสถานะเริ่มต้น “กำลังทำ” ได้; หน้าเข้า-ออกแสดงการ์ด Work Status ของตัวเอง; modal ข้อมูลพนักงานหน้า team แสดงการ์ด Live Work พร้อมงาน active, โน้ตล่าสุดจาก Community/Chat และปุ่มเพิ่มงานให้พนักงาน |
| 2026-05-21 | หน้า `team` modal ข้อมูลพนักงาน: แอดมิน/HR แก้หรือใส่เวลาเข้า-ออกงานรายวันได้จากตารางสรุป พร้อม migration เปิด RLS insert/update/delete `attendance_logs` เฉพาะ admin |
| 2026-05-21 | หน้า `admin`: แยกคำขอเบิกเงินเดือน/เบิกค่าใช้จ่ายเป็นคิวรอดำเนินการ (`pending`) และแยกปุ่ม/modal ประวัติตามหัวข้อ Claim Salary / Expense Claim พร้อมตัวกรองสถานะและช่วงวันที่สร้างคำขอ |
| 2026-05-20 | แก้ KPI ลา: เวลาการแจ้งล่วงหน้าคำขอลาเทียบกับเวลาเริ่มงานตามกะ/ตารางของวันลา ไม่ใช่เที่ยงคืนของ `starts_on` — แก้กรณีลาป่วยแสดง 0.0 ชม. ทั้งหมด |
| 2026-05-20 | เพิ่ม KPI ลา/ขอเข้าสายในหน้า `profile`: คะแนนเต็ม 20 ต่อไตรมาส, สรุปภาพรวมปี, หักคะแนนตามเกณฑ์การลา/สาย; หน้า `admin` เพิ่ม JSON setting `attendance_kpi_settings`; migration เปิด select policy สำหรับผู้ใช้ที่ล็อกอิน |
| 2026-05-20 | หน้า `chat`/`team`: ซิงค์สถานะอนุมัติลาทันที — แชทอ่าน/ฟัง `leave_requests` เพื่อซ่อนปุ่มเมื่ออนุมัติแล้ว และหน้า team ส่งข้อความสถานะเข้าแชทหลังอนุมัติ/ปฏิเสธ |
| 2026-05-20 | หน้า `attendance`: ตารางสรุปเวลาเข้า-ออกงานเพิ่มคอลัมน์หมายเหตุ แสดงประเภทลา (ลากิจ/ลาป่วย/ลาพักร้อน), สิทธิ์ขอเข้าสาย และนาทีสายสุทธิ พร้อมเพิ่มใน CSV/PDF |
| 2026-05-20 | ขอเข้าสาย: ปรับโควต้าเป็นรอบ 26–25 จำกัด 2 ครั้งหรือรวม 30 นาที (ถึงก่อน), เพิ่ม trigger `enforce_late_requests_cycle_quota`, และปรับสรุปมาสายให้หักสิทธิ์ก่อนเทียบเวลาเข้างาน |
| 2026-05-22 | Migration `peer_same_branch_calendar_read_rls`: พนักงาน (ไม่ใช่ manager/admin) อ่าน `work_schedule_assignments` / `work_schedules` / `attendance_calendar_notes` ของเพื่อนร่วมสาขา (`same_branch_as`) ได้ — ปฏิทินในโมดัลแชทเข้า-ออกแสดงตารางและโน้ต; แชท: คำอธิบายใต้ปฏิทิน + prop `sub` ใน `EmployeeScheduleCalendarCard` |
| 2026-05-22 | หน้า `chat` (แชทเข้า-ออก): แก้ `onStartReached` โหลดประวัติซ้ำวนลูป — ปิดการเรียกชั่วคราวหลังแต่ละหน้า, ref กันซ้อน, หยุดเมื่อหน้า API เต็มแต่แถวซ้ำทั้งหมด, `maintainVisibleContentPosition` บน native |
| 2026-05-08 | หน้า `profile`: สรุปเวลามาสายจริงรอบเดือน 26–25 (Bangkok) — เทียบ check-in แรกกับกะ/ตาราง legacy; ต่อวันแสดงนาทีที่ขอจาก `late_requests` และผลต่าง (สิทธิ์ที่ขอ − สายจริง); โควตาขอเข้าสายต่อเดือนปฏิทินยังใช้ `late_requests` |
| 2026-05-08 | Migration `employee_resignations` + RPC `admin_record_employee_resignation` + ขยาย `admin_list_employee_passwords` (employment_status); หน้าแอดมิน: แดชบอร์ด % ทำงานอยู่/ลาออก, ปุ่มลบ/ลาออกในการ์ดพนักงาน |
| 2026-05-08 | หน้าแอดมิน · คำขอเบิกค่าใช้จ่าย: แสดง thumbnail รูปหลักฐาน แตะเปิดโมดัลดูเต็มจอ (ซูม pinch) + ลิงก์เปิดในเบราว์เซอร์ |
| 2026-05-08 | ฟีดคอมมูนิตี้: ย่อรูปก่อนอัปโหลดแบบคงอัตราส่วน (`prepareFeedImageForLayout`); กรอบโพสต์ใช้อัตราส่วนจริงจากรูป (`CommunityFeedPostImage` + ตัวอย่างก่อนโพสต์) — แก้ภาพถูกบีบ/ยืด |
| 2026-05-08 | Migration `tasks_delete_admin_only`: ลบแถว `tasks` ได้เฉพาะ admin; หน้า `tasks`: ค้นหาหัวข้อ/รายละเอียด, กรองช่วงวันที่สร้างงาน (`created_at`) บน query + ปุ่มลบงาน (การ์ดและโมดัลรายละเอียด) |
| 2026-05-08 | Migration `admin_delete_old_attendance_chat_messages`: RPC ลบ `attendance_chat_messages` ตามปฏิทิน Asia/Bangkok เก่ากว่า N วัน (แอดมิน); หน้าแชท: ปุ่มถังขยะ + ยืนยัน |
| 2026-05-08 | Migration `work_schedule_assignments_retention_30d_cron`: เคยเพิ่มฟังก์ชัน + pg_cron รายวันลบมอบหมายกะเก่ากว่า 30 วัน (Bangkok); ภายหลังปิดแล้วเมื่อ 2026-06-04 เพื่อเก็บข้อมูลคำนวณมาสายย้อนหลัง |
| 2026-05-08 | หน้า `schedule`: เอา `limit(120)` ออกจาก `work_schedule_assignments` — โหลดมอบหมายรายวันครบ; โมดัลรายละเอียดพนักงานดึงรายการตาม `user_id` แยก + รีเฟรชหลัง `load()` |
| 2026-05-08 | หน้า `team` โมดัลข้อมูลพนักงาน: ค้นหางาน (manager/admin), KPI/สรุป deadline/Task Status ตามคำค้น, กรอบเลื่อนรายการงาน, ปุ่มลบงานเฉพาะ admin; แก้ความคืบหน้าเช็กลิสต์ (`checklistProgress` รับ `TaskRow`) |
| 2026-05-09 | Migration `create_manager_task_bundle` RPC + แอปเรียก RPC แทน insert ตรง — แก้มอบหมายงานของผู้จัดการที่ยังติด RLS บน production |
| 2026-05-09 | หน้า `team`: โมดัลมอบหมายงานจัดเรียงและ UI เหมือนหน้า `tasks` (หัวข้อย่อยเช็คลิสต์, ชิปความสำคัญมีสี/จุด), มอบหมายทีละคน + เช็คลิสต์ + แจ้งเตือน; ข้อความ RLS แยกตาราง tasks / task_assignees |
| 2026-05-09 | Migration `tasks_rls_helpers_v2`: ปรับ `tasks_insert_policy_check` ให้ลูกทีม `manager_direct_reports` ผ่านได้แม้ `profiles.role` ยังไม่เป็น manager; `task_assignee_mutation_allowed` อ่าน `tasks` แบบปิด row_security ชั่วคราว — แก้ RLS หลังรัน migration ก่อนหน้าแล้วยังมอบหมายไม่ได้ |
| 2026-05-09 | Migration `tasks_rls_insert_definer_helpers`: `tasks_insert_policy_check` + `task_assignee_mutation_allowed` (SECURITY DEFINER) ให้เงื่อนไขมอบหมาย/แทรก `task_assignees` ไม่พังจากบริบท RLS ของ subquery |
| 2026-05-09 | Migration `tasks_rls_manager_assign_direct_reports`: แก้ RLS `tasks_insert` ให้ผู้จัดการมอบหมายลูกทีมใน `manager_direct_reports` ได้แม้สาขาไม่ตรงกับ `same_branch_as`; ขยาย `auth_can_access_task_for_rls` + `task_assignees` ให้สอดคล้อง; แอป: `humanizeSupabaseError` สำหรับข้อความ RLS, toast web `z-index` โฮสต์ ~5e7 |
| 2026-05-09 | หน้า `tasks`: โมดัลมอบหมายงานกรอง `task_assign_picklist` ตาม `manager_direct_reports` สำหรับผู้จัดการ (ไม่ใช่แอดมิน), การ์ดผู้รับงานมี avatar เหมือนหน้าทีม; หน้า `team`: โมดัลข้อมูลพนักงานให้ผู้จัดการแก้ฟิลด์ HR (employee) ชุดเดียวกับแอดมิน |
| 2026-05-08 | หน้า `team`: โมดัลมอบหมายงานใช้รายชื่อแบบเดียวหน้า `tasks` (ค้นหา + การ์ด avatar/ชื่อ/ชื่อเล่น/อีเมล); manager เห็นเฉพาะลูกทีม; แก้ `CuteToast` บนเว็บให้ใช้ `createPortal` ที่ z-index สูงกว่าเลเยอร์ Modal ของ react-native-web (9999) เพื่อไม่ให้ข้อความ error ถูกบังเมื่อมีโมดัลทับอยู่ |
| 2026-05-06 | `EmployeeScheduleCalendarCard`: โมดัลรายวันมีโน้ต/เช็กลิสต์เหมือนหน้า attendance; migration ขยาย RLS `attendance_calendar_notes` ให้ผู้จัดการอ่านลูกทีมและแก้ไขเมื่อมีสิทธิ์จัดตาราง |
| 2026-05-06 | หน้า `schedule` ปรับ UX การเลือกพนักงาน: เมื่อกดชื่อจากการ์ด/โมดัลค้นหา จะเปิดป๊อปอัพรายละเอียดมอบหมายของพนักงานคนนั้นทันที |
| 2026-05-06 | หน้า `schedule` ปรับรายชื่อพนักงานในส่วนมอบหมายล่าสุดจากชิปเป็นการ์ดข้อมูล (avatar + ชื่อ + ตำแหน่ง/ชื่อเล่น + จำนวนมอบหมาย) ให้ใกล้เคียงหน้า `team` |
| 2026-05-06 | หน้า `schedule` เพิ่มชื่อเล่น (nickname) ในโมดัลเลือกพนักงาน และแสดงรายชื่อพนักงานทั้งหมดแบบชิปในหน้าหลักเพื่อกดเลือกดูรายละเอียดได้ทันที |
| 2026-05-06 | โมดัลเลือกพนักงานในหน้า `schedule` แสดงแบบการ์ดคล้ายหน้า `team`: เพิ่ม avatar, ชื่อ, บรรทัดตำแหน่ง (fallback เป็น role+รหัส) และจำนวนมอบหมาย |
| 2026-05-06 | หน้า `schedule` ปรับตัวเลือกพนักงานเป็นโมดัลค้นหา (รูปแบบเดียวกับการเลือกคนในหน้า team) และแสดงรายละเอียดมอบหมายเฉพาะเมื่อกดเลือกชื่อพนักงาน |
| 2026-05-06 | หน้า `schedule` ปรับส่วน “มอบหมายล่าสุด” เป็นมุมมองรายชื่อพนักงานก่อน แล้วกดดูรายละเอียดรายคน; สำหรับ manager จะแสดงเฉพาะพนักงานในขอบเขตที่ได้รับมอบหมาย |
| 2026-05-06 | แก้บั๊กการเลือกวันในปฏิทิน attendance: ยกเลิกการรีเซ็ต `scheduleSelectedYmd` ตามวันแรกที่มีตารางงาน เพื่อไม่ให้วันที่ผู้ใช้กด (รวมวันที่ไม่มีตารางงาน) ถูกสลับเป็นวันอื่น |
| 2026-05-06 | harden การโหลดโน้ตรายวันใน attendance: เปลี่ยนจาก `maybeSingle()` เป็นดึงล่าสุด `order(updated_at desc)+limit(1)` และทำ save แบบ `upsert + select().single()` เพื่อตรวจผลเขียนทันที |
| 2026-05-06 | ปรับปฏิทินหน้า attendance ให้แสดงจุดสถานะ “มีโน้ต” แม้วันนั้นไม่มีตารางงาน และโหลดโน้ตรายเดือนมาใช้เป็น marker พร้อม optimistic update ตอนกดบันทึก |
| 2026-05-06 | แก้บั๊กหน้า attendance: หลังบันทึกโน้ต/เช็กลิสต์ในวันที่ไม่มีตารางงาน ระบบรีโหลดข้อมูลรายวันทันที ทำให้เปิดโมดัลซ้ำแล้วยังเห็นข้อมูลที่เพิ่งบันทึก |
| 2026-05-05 | เพิ่ม `appSignals` กลาง (leave/task/mention) สำหรับ optimistic sync ข้ามหน้า: team/chat/attendance/badges อัปเดตทันทีโดยไม่รอ poll |
| 2026-05-06 | เพิ่มระบบเบิกเงินในหน้าโปรไฟล์: `salary_claims` + `expense_claims`/`expense_claim_items`, อัปโหลดหลักฐาน bucket `expense_claim_evidence`, เพิ่มเมนูแอดมินสำหรับรับคำขอ, อัปเดตสถานะ (อนุมัติ/ปฏิเสธ/จ่ายแล้ว) + review_note + ส่งออก CSV + แจ้งเตือนกระดิ่ง `finance_claim_notifications` |
| 2026-05-06 | ปรับ performance รอบแรก: ลด realtime listeners แบบ global ใน `TabUnreadBadgesContext` และ `TaskNotificationsContext`; หน้าแอดมินอัปเดตสถานะคำขอแบบปรับ state รายการเดียว (ไม่ reload ทั้งหน้า) |
| 2026-05-06 | เพิ่ม RPC `app_badge_notif_snapshot` และปรับ `TabUnreadBadgesContext` + `TaskNotificationsContext` ให้ดึง badge/notif snapshot แบบ query เดียว ลดจำนวน round-trip ฝั่ง client |
| 2026-05-06 | หน้าเข้า-ออกงาน: เพิ่มโน้ต/เช็กลิสต์รายวันในโมดัลปฏิทิน “ตารางเข้าออกงานของฉัน” (สไตล์กิจกรรม) พร้อมตาราง `attendance_calendar_notes` และ RLS เฉพาะเจ้าของ |
| 2026-05-06 | เพิ่มคอมโพเนนต์ปฏิทินตารางงานรายเดือนแบบแตะดูรายละเอียด และนำไปใช้ในหน้า `team` (รายละเอียดพนักงาน) และโปรไฟล์จากหน้า `chat` |
| 2026-05-05 | แชทเข้า-ออก: กดชื่อ/รูปเพื่อดูโปรไฟล์ (ชื่อในแอป, โทรศัพท์, ชื่อจริง, ชื่อเล่น, งานค้าง) + ดูรูปโปรไฟล์แบบเต็มจอ; เพิ่ม RPC `chat_user_profile_card` |
| 2026-05-05 | ผู้จัดการ: ทีมแบบการ์ดสาขา + อนุมัติลา/ลิงก์ตารางตาม `manager_scopes`; แอดมินกำหนดสิทธิ์และลูกทีม; RLS ลา/กะ/employee ตามลูกทีม; RPC `manager_list_team_directory_rows` |
| 2026-05-04 | แอดมิน: สไลด์ประกาศแบบคิวรออัปโหลด + `slide_height_px`, รายชื่อรวม employee+profiles, vacation_grants ครบ 3 ประเภท, Edge `admin-create-employee` (Auth+HR) |
| 2026-04-28 | แอดมิน: auto-link profiles↔employee หลายแบบ, fallback บันทึก HR เมื่อไม่มี `branch_id`, ปรับ modal/z-index และลด popup ซ้อน |
| 2026-04-27 | แจ้งเตือน: `notification_preferences`, checkout channel, migration OT timeout fix |
| ก่อนหน้า | attendance UI, schedule calendar, avatar crop, gesture handler |

---

## 10) ลิงก์ที่ควรอ่านคู่กัน

- `mobile/README.md` — รันแอป, env
- `supabase/PUSH_PIPELINE.md` — push/webpush
- `AGENTS.md` (รากโปรเจกต์) — คำสั่งให้ Agent

---

*เมื่อแก้ schema หรือเพิ่มตารางใหม่ ให้เพิ่มแถวใน §6 และอัปเดต §8–§9 ให้สอดคล้องกับโค้ด*
