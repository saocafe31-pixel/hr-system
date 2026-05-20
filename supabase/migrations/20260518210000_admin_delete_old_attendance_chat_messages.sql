-- แอดมินลบข้อความแชทเข้า-ออกงานที่เก่ากว่า N วัน (ค่าเริ่ม 90) — attendance_chat_mention_notifications ลบตาม FK cascade
create or replace function public.admin_delete_attendance_chat_messages_older_than(p_days integer default 90)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count bigint := 0;
  days integer;
begin
  if not public.is_admin() then
    raise exception 'ต้องเป็นแอดมินเท่านั้น' using errcode = '42501';
  end if;

  days := greatest(coalesce(p_days, 90), 1);

  /*
    นับตามปฏิทิน Asia/Bangkok: ลบข้อความที่วันที่ (ในเขตไทย) ของ created_at
    น้อยกว่า (วันนี้เขตไทย - p_days วัน) — สอดคล้อง retention อื่น (เช่น work_schedule_assignments)
  */
  delete from public.attendance_chat_messages m
  where (timezone('Asia/Bangkok', m.created_at))::date < (
    (timezone('Asia/Bangkok', now()))::date - days
  );

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

comment on function public.admin_delete_attendance_chat_messages_older_than(integer) is
  'แอดมินเท่านั้น: ลบ attendance_chat_messages ที่วันที่ created_at (ปฏิทิน Asia/Bangkok) เก่ากว่า p_days วันนับจากวันนี้ในเขตไทย';

revoke all on function public.admin_delete_attendance_chat_messages_older_than(integer) from public;
grant execute on function public.admin_delete_attendance_chat_messages_older_than(integer) to authenticated;
