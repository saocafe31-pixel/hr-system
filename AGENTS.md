# Instructions for AI Agents — HR System

## ก่อนแก้โค้ด

1. อ่าน **`docs/PROJECT_GUIDE.md`** ทั้งไฟล์ — มีโครงสร้างโปรเจกต์ บทบาท (employee / manager / admin) แท็บและไฟล์หน้า การเชื่อม Supabase ตาราง/view หลัก และสถานะความคืบหน้า
2. แอป Expo อยู่ที่ **`mobile/`** — รันและ env ตาม `mobile/README.md`
3. ฐานข้อมูล: **`supabase/migrations/`** เป็นหลัก — อย่าอ้างแค่ `schema.sql` โดยไม่เทียบ migration

## หลังทำงานสำคัญ

- อัปเดต **`docs/PROJECT_GUIDE.md`**:
  - **§8 ความคืบหน้า** — เช็ก/ยกเลิกรายการ หรือเพิ่มข้อใหม่
  - **§9 การเปลี่ยนแปลงล่าสุด** — แถวสั้นๆ วันที่ + สรุป
- ถ้าเพิ่มตาราง/RPC/หน้าใหม่ที่สำคัญ — อัปเดต **§4–§6** ใน `PROJECT_GUIDE.md` ให้สอดคล้อง

## สิ่งที่ควรระวัง

- `mobile/` อาจมี **`.git` ซ้อน** — commit จากรากโปรเจกต์ให้ตรวจว่าไฟล์ถูก track ตามต้องการ
- อย่า commit ค่าลับ — ใช้ env / Supabase dashboard
