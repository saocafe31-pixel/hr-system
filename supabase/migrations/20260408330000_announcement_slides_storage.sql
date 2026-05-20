-- ภาพสไลด์ประกาศบริษัท (หน้าเข้า-ออกงาน): bucket สาธารณะ อัปโหลดได้เฉพาะแอดมิน
insert into storage.buckets (id, name, public)
values ('announcement_slides', 'announcement_slides', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "announcement_slides_public_read" on storage.objects;
create policy "announcement_slides_public_read" on storage.objects
  for select using (bucket_id = 'announcement_slides');

drop policy if exists "announcement_slides_admin_insert" on storage.objects;
create policy "announcement_slides_admin_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'announcement_slides'
    and public.is_admin()
  );

drop policy if exists "announcement_slides_admin_update" on storage.objects;
create policy "announcement_slides_admin_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'announcement_slides'
    and public.is_admin()
  )
  with check (
    bucket_id = 'announcement_slides'
    and public.is_admin()
  );

drop policy if exists "announcement_slides_admin_delete" on storage.objects;
create policy "announcement_slides_admin_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'announcement_slides'
    and public.is_admin()
  );
