-- วันเวลาที่ทำงานเสร็จจริง (ใช้คำนวณทัน/ล่าช้า แยกจาก updated_at ที่อาจเปลี่ยนจากแก้ไขทั่วไป)

alter table public.tasks add column if not exists completed_at timestamptz;

comment on column public.tasks.completed_at is
  'เมื่อสถานะ done — เวลาที่นับว่างานเสร็จ (รวมถึงเลือกวันที่เสร็จจากแอป)';

update public.tasks
set completed_at = updated_at
where status = 'done'
  and completed_at is null;
