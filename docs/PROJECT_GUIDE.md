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
- **Manager รายชื่อทีมที่ดูแล:** RPC `manager_list_team_directory_rows` (เฉพาะลูกทีมใน `manager_direct_reports` และโปรไฟล์มี `employee_id`)
- **แอดมินตั้งสิทธิ์ผู้จัดการ:** RPC `admin_set_manager_scope`, `admin_set_manager_direct_reports`
- **มอบหมายงาน (หน้างาน + หน้าทีม):** RPC `create_manager_task_bundle` — สร้าง `tasks` + `task_assignees` + `task_checklist_items` แบบ `SECURITY DEFINER` เพื่อไม่ให้โดน RLS บน client; ตรวจสิทธิ์ลูกทีม / ผู้จัดการ / สาขาใน RPC

---

## 6) ตาราง / view ที่หน้าต่างๆ ใช้ (อ้างอิงหลัก)

> รายการนี้สรุปจาก `.from(...)` / RPC ในโค้ด — ตารางเสริมอื่นอาจมีใน migrations

### Core & org

| ชื่อ | ใช้ทำอะไร |
|------|-----------|
| `profiles` | บัญชี, role, branch_id, employee_code, employee_id, avatar, expo_push_token |
| `manager_scopes` | สิทธิ์เสริมผู้จัดการ: `can_approve_leave`, `can_manage_schedule` (แอดมินเขียน) |
| `manager_direct_reports` | คู่ manager_id ↔ subordinate_id (ลูกทีมโดยตรง — แอดมินเขียน) |
| `employee` | ข้อมูล HR legacy (คอลัมน์ mixed case เช่น `UserID`) — คอลัมน์ `status` ใช้แยกทำงานอยู่ / ลาออก |
| `employee_resignations` | ประวัติการลาออกที่แอดมินบันทึก (`employee_id` อาจ null หลังลบพนักงาน) |
| `employee_directory` | **view** อ่านข้อมูลพนักงานแบบรวม — โดน RLS ตาม policy |
| `branch_information` | สาขา, พิกัด, รัศมี (check-in) |

### เข้า-ออกงาน & แชท

| ชื่อ | ใช้ทำอะไร |
|------|-----------|
| `attendance_logs` | บันทึก check-in/out, break |
| `attendance_chat_messages` | แชทสายเข้า-ออก / แจ้งเตือนในแชท — แอดมินลบย้อนหลังผ่าน RPC `admin_delete_attendance_chat_messages_older_than` (นับวันที่ตาม Asia/Bangkok; แอป: ไอคอนถังขยะในแชท) |
| `attendance_chat_mention_notifications` | mention @ ในแชท — ลบตามเมื่อลบ `attendance_chat_messages` (FK cascade) |
| `attendance_overtime_requests` | OT prompt หลังเลยเวลา + deadline |
| `wellbeing_checkins` | อารมณ์หลังเข้างาน |
| `leave_requests` | คำขอลา |
| `late_requests` | ขอเข้าสาย |
| `work_schedules` | ตารางแบบ legacy (ช่วงเวลา) — RLS select: เจ้าของ, แอดมิน, หรือผู้ใช้ที่ไม่ใช่แอดมินและ `same_branch_as` กับเจ้าของตาราง (อ่านอย่างเดียว) |
| `work_shifts` | เทมเพลตกะ |
| `work_schedule_assignments` | มอบหมายกะรายวัน + `allowed_branch_id` — pg_cron ลบแถวที่ `work_date` เก่ากว่า 30 วัน (Bangkok) รายวัน (`prune_work_schedule_assignments_retention_30d`) — RLS select: เจ้าของ, แอดมิน, ผู้จัดการดูลูกทีม, หรือผู้ใช้ที่ไม่ใช่แอดมินและ `same_branch_as` กับผู้ถูกมอบหมาย (อ่านอย่างเดียว) |
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
| `app_settings` | ค่าระบบ — คีย์ `announcement_slides` เก็บ `{ urls, slides: [{ url, duration_ms }], slide_height_px }` สำหรับสไลด์หน้าเข้า-ออก (รองรับข้อมูลเก่าแบบ `urls` และ default 4 วินาทีต่อภาพ); คีย์ `attendance_kpi_settings` เก็บเกณฑ์ KPI ลา/เข้าสาย |
| `vacation_grants` | โควตาพักร้อน + sick/personal (คอลัมน์เพิ่มตาม migration) |
| `salary_claims` | คำขอเบิกเงินเดือนล่วงหน้า (ช่วงวันที่ 10–14) พร้อมข้อมูลบัญชีและวงเงินคำนวณ |
| `expense_claims` | หัวคำขอเบิกค่าใช้จ่าย (ยอดรวม + ข้อมูลบัญชีผู้ขอ) |
| `expense_claim_items` | รายการเบิกย่อยต่อคำขอ (ชื่อรายการ, ยอด, หมายเหตุ, หลักฐาน) |
| `finance_claim_notifications` | แจ้งเตือนกระดิ่งสำหรับคำขอเบิกเงิน (ส่งคำขอ/อัปเดตสถานะ) |

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
- DB functions / cron: overtime (`process_attendance_overtime`), triggers เกี่ยว OT และ notification — ดู migrations ช่วง `20260427*`
- DB cron: `prune_work_schedule_assignments_retention_30d()` — ลบ `work_schedule_assignments` ที่ `work_date` เก่ากว่า 30 วัน (Asia/Bangkok) ทุกวัน ~00:20 น. ไทย

---

## 8) ความคืบหน้าฟีเจอร์หลัก (สถานะปัจจุบัน — อัปเดตเมื่อมีงานใหม่)

- [x] เข้า-ออกงาน + พักเบรก + สรุปรายงานช่วงวันที่
- [x] ตารางงาน (กะ + มอบหมาย + สาขาที่เข้าได้) + ปฏิทินส่วนตัวในหน้า attendance
- [x] OT backend (prompt / timeout / respond RPC)
- [x] ลา / ขอเข้าสาย + กฎโควตา (รอบ 26–25, ไม่เกิน 2 ครั้งหรือ 30 นาที) + แอดมินแก้วันลาคงเหลือ
- [x] งาน + checklist + แนบไฟล์ + แจ้งเตือนงาน + การ์ดสถานะงานกำลังทำในหน้าเข้า-ออกและข้อมูลพนักงานหน้า team
- [x] แชท + mention notifications
- [x] คอมมูนิตี้ (โน้ต + ฟีด)
- [x] โปรไฟล์ (รูป crop, notification prefs, push token path, KPI ลา/ขอเข้าสายรายไตรมาสและภาพรวมปี) + หน้า team modal ข้อมูลพนักงานแสดงสรุปลา/เข้าสาย ประวัติลา และ KPI แบบเดียวกับหน้าโปรไฟล์
- [x] แอดมิน: พนักงาน legacy, สาขา, เชื่อม HR, โควตา, ประกาศ, ตั้งค่า, สิทธิ์ผู้จัดการ & ลูกทีม (ทีม manager แบบจำกัดขอบเขต), และแก้/ใส่เวลาเข้า-ออกของพนักงานจากหน้า team
- [x] โปรไฟล์: เมนูเบิกเงินเดือน (สูตร 70% ของ 50% ฐานเงินเดือนในช่วงวันที่ 10-14) + เบิกค่าใช้จ่ายหลายรายการพร้อมแนบหลักฐาน
- [x] แอดมิน: เมนูรับคำขอเบิกเงินเดือน/ค่าใช้จ่าย พร้อมแสดงข้อมูลบัญชีและหลักฐานแยกรายการ; รายการที่อนุมัติ/ปฏิเสธ/จ่ายแล้วถูกย้ายไปหน้าประวัติแยกตามหัวข้อ พร้อมกรองตามสถานะและวันที่
- [ ] **iOS native build + EAS** — ต้องใช้ Apple Developer Program สำหรับ signing; Android เป็นทางเลือกทดสอบ push
- [ ] ทบทวน **nested git** ใน `mobile/` ให้เหลือ repo เดียว (ถ้าต้องการ)

---

## 9) การเปลี่ยนแปลงล่าสุด (changelog สั้น — อัปเดตเป็นประจำ)

| วันที่ (โดยประมาณ) | สรุป |
|---------------------|------|
| 2026-05-25 | หน้า `admin` ส่วนรูปประกาศหน้าเข้า-ออกงานเพิ่มปุ่มเลื่อนลำดับภาพขึ้น/ลง และตั้งเวลาแสดงรายภาพ; carousel หน้า `attendance` อ่าน `slides.duration_ms` ต่อภาพ พร้อม fallback 4 วินาทีสำหรับภาพที่ไม่ตั้งเวลา/ข้อมูลเก่า |
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
| 2026-05-08 | Migration `work_schedule_assignments_retention_30d_cron`: ฟังก์ชัน + pg_cron รายวันลบมอบหมายกะรายวันที่ `work_date` เก่ากว่า 30 วัน (Bangkok) |
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
