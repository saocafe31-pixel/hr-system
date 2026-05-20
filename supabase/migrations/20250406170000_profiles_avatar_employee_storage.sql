-- โปรไฟล์: รูปพนักงาน + เชื่อมแถว employee (HR)
alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists employee_id uuid;

-- FK เฉพาะเมื่อตาราง employee มีคอลัมน์ id (uuid) จริง — หลายโปรเจกต์ใช้แค่ "Employee ID" เป็นคีย์ ไม่มี id
do $$
declare
  employee_has_id boolean;
begin
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'employee'
      and column_name = 'id'
  )
  into employee_has_id;

  if
    employee_has_id
    and not exists (
      select 1 from pg_constraint where conname = 'profiles_employee_id_fkey'
    )
  then
    alter table public.profiles
      add constraint profiles_employee_id_fkey
      foreign key (employee_id) references public.employee (id) on delete set null;
  end if;
end $$;

-- พนักงานแก้ตัวเองไม่เปลี่ยน employee_id ได้ (แอดมินตั้งให้)
create or replace function public.profiles_strip_privileged_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  adm boolean;
begin
  select exists(
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  ) into adm;
  if auth.uid() = new.id and not coalesce(adm, false) then
    new.role := old.role;
    new.branch_id := old.branch_id;
    new.email := old.email;
    new.employee_id := old.employee_id;
  end if;
  return new;
end;
$$;

-- ---------- Storage: รูปโปรไฟล์ ----------
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = excluded.public;

-- ไม่ใส่ ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY ที่นี่:
-- บน Supabase Hosted เปิด RLS อยู่แล้ว และ role ของ db push มักไม่ใช่ owner ของ storage.objects (42501)

drop policy if exists "avatars_public_read" on storage.objects;
create policy "avatars_public_read" on storage.objects
  for select using (bucket_id = 'avatars');

drop policy if exists "avatars_insert_own" on storage.objects;
create policy "avatars_insert_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername (name))[1] = auth.uid()::text
  );

drop policy if exists "avatars_update_own" on storage.objects;
create policy "avatars_update_own" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername (name))[1] = auth.uid()::text
  );

drop policy if exists "avatars_delete_own" on storage.objects;
create policy "avatars_delete_own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername (name))[1] = auth.uid()::text
  );
