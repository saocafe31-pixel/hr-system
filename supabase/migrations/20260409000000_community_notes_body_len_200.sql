-- ขยายความยาวโน้ตสตอรี่ (เดิม 50 ตัว — ภาษาไทยสั้นเกินไป)
alter table public.community_notes
  drop constraint if exists community_notes_body_check;

alter table public.community_notes
  add constraint community_notes_body_len check (char_length(body) <= 200);
