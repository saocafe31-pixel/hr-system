-- ขยายการแนบหลักฐานลา: ลากิจแนบได้ทุกครั้ง (ไม่จำกัด >2 วัน)

create or replace function public.attach_leave_request_evidence(
  p_leave_id uuid,
  p_url text
)
returns public.leave_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.leave_requests;
  v_url text;
begin
  v_url := nullif(trim(coalesce(p_url, '')), '');
  if v_url is null then
    raise exception 'กรุณาเลือกไฟล์หลักฐาน';
  end if;

  select * into v_row
  from public.leave_requests
  where id = p_leave_id;

  if not found then
    raise exception 'ไม่พบคำขอลา';
  end if;

  if v_row.user_id <> auth.uid() and not public.is_admin() then
    raise exception 'ไม่มีสิทธิ์แนบหลักฐานรายการนี้';
  end if;

  if v_row.status = 'rejected' then
    raise exception 'ไม่สามารถแนบหลักฐานคำขอที่ถูกปฏิเสธ';
  end if;

  if v_row.leave_type = 'sick' then
    update public.leave_requests
    set medical_certificate_url = v_url
    where id = p_leave_id
    returning * into v_row;
  elsif v_row.leave_type = 'personal' then
    update public.leave_requests
    set supplementary_document_url = v_url
    where id = p_leave_id
    returning * into v_row;
  else
    raise exception 'ประเภทลานี้ไม่รองรับการแนบหลักฐาน';
  end if;

  return v_row;
end;
$$;

comment on function public.attach_leave_request_evidence(uuid, text) is
  'พนักงาน (หรือแอดมิน) แนบ/เปลี่ยนหลักฐานลา: ลาป่วย → medical_certificate_url, ลากิจ → supplementary_document_url';
