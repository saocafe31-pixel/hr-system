-- อัปเกรดจาก schema เดิม (branches uuid) → branch_information (bigint)
-- Postgres ไม่ให้ ALTER ชนิดคอลัมน์ที่ถูกอ้างใน RLS — ต้อง DROP policy ก่อน แล้วสร้างคืนหลังแปลงชนิด

-- เติมคอลัมน์รัศมีสำหรับเช็คเข้างาน
alter table public.branch_information
  add column if not exists radius_meters integer not null default 150;

-- ---------- ลบ RLS ที่ผูกกับ profiles.branch_id / same_branch_as / my_branch_id ----------
drop policy if exists "tasks_delete" on public.tasks;
drop policy if exists "tasks_update" on public.tasks;
drop policy if exists "tasks_insert" on public.tasks;
drop policy if exists "tasks_select" on public.tasks;

drop policy if exists "schedules_delete_manager_admin" on public.work_schedules;
drop policy if exists "schedules_update_manager_admin" on public.work_schedules;
drop policy if exists "schedules_write_manager_admin" on public.work_schedules;
drop policy if exists "schedules_select" on public.work_schedules;

drop policy if exists "attendance_select" on public.attendance_logs;

drop policy if exists "profiles_update_manager_employees" on public.profiles;
drop policy if exists "profiles_update_admin" on public.profiles;
drop policy if exists "profiles_update_self" on public.profiles;
drop policy if exists "profiles_select" on public.profiles;

-- ---------- แปลงชนิด branch_id (profiles / attendance_logs) ----------
do $$
declare
  profiles_uuid boolean;
begin
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'branch_id'
      and udt_name = 'uuid'
  ) into profiles_uuid;

  if profiles_uuid then
    alter table public.profiles drop constraint if exists profiles_branch_id_fkey;
    alter table public.attendance_logs drop constraint if exists attendance_logs_branch_id_fkey;

    alter table public.profiles alter column branch_id drop default;
    alter table public.profiles
      alter column branch_id type bigint using null::bigint;

    alter table public.attendance_logs
      alter column branch_id type bigint using null::bigint;

    alter table public.profiles
      add constraint profiles_branch_id_fkey
      foreign key (branch_id) references public.branch_information (id) on delete set null;

    alter table public.attendance_logs
      add constraint attendance_logs_branch_id_fkey
      foreign key (branch_id) references public.branch_information (id) on delete set null;
  end if;
end $$;

-- my_branch_id() เคยประกาศ returns uuid — ต้อง drop แล้วสร้างใหม่เพราะเปลี่ยนชนิดคืนค่าไม่ได้ด้วย OR REPLACE อย่างเดียว
drop function if exists public.my_branch_id();

create function public.my_branch_id()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select branch_id from public.profiles where id = auth.uid();
$$;

-- ---------- employee (ถ้ามี) ----------
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'employee'
  ) and exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'employee'
      and column_name = 'branch_id'
      and udt_name = 'uuid'
  ) then
    drop policy if exists "employee_delete_admin" on public.employee;
    drop policy if exists "employee_update_manager" on public.employee;
    drop policy if exists "employee_update_admin" on public.employee;
    drop policy if exists "employee_insert_admin" on public.employee;
    drop policy if exists "employee_select_manager_branch" on public.employee;
    drop policy if exists "employee_select_admin" on public.employee;
    drop policy if exists "employee_select_self" on public.employee;

    alter table public.employee drop constraint if exists employee_branch_id_fkey;
    alter table public.employee
      alter column branch_id type bigint using null::bigint;
    alter table public.employee
      add constraint employee_branch_id_fkey
      foreign key (branch_id) references public.branch_information (id) on delete set null;

    alter table public.employee enable row level security;

    create policy "employee_select_self" on public.employee
      for select to authenticated
      using (
        exists (
          select 1 from public.profiles p
          where p.id = auth.uid() and p.employee_id = employee.id
        )
      );

    create policy "employee_select_admin" on public.employee
      for select to authenticated
      using (public.is_admin());

    create policy "employee_select_manager_branch" on public.employee
      for select to authenticated
      using (
        public.is_manager()
        and (
          (
            employee.branch_id is not distinct from public.my_branch_id()
            and public.my_branch_id() is not null
          )
          or (
            employee.branch_id is null
            and employee.branch is not null
            and exists (
              select 1
              from public.profiles me
              join public.branch_information bi on bi.id = me.branch_id
              where me.id = auth.uid()
                and trim(bi.branch_name) = trim(employee.branch)
            )
          )
        )
      );

    create policy "employee_insert_admin" on public.employee
      for insert to authenticated
      with check (public.is_admin());

    create policy "employee_update_admin" on public.employee
      for update to authenticated
      using (public.is_admin())
      with check (public.is_admin());

    create policy "employee_update_manager" on public.employee
      for update to authenticated
      using (
        public.is_manager()
        and (
          (
            employee.branch_id is not distinct from public.my_branch_id()
            and public.my_branch_id() is not null
          )
          or (
            employee.branch_id is null
            and employee.branch is not null
            and exists (
              select 1
              from public.profiles me
              join public.branch_information bi on bi.id = me.branch_id
              where me.id = auth.uid()
                and trim(bi.branch_name) = trim(employee.branch)
            )
          )
        )
      )
      with check (
        public.is_manager()
        and (
          (
            branch_id is not distinct from public.my_branch_id()
            and public.my_branch_id() is not null
          )
          or (
            branch_id is null
            and branch is not null
            and exists (
              select 1
              from public.profiles me
              join public.branch_information bi on bi.id = me.branch_id
              where me.id = auth.uid()
                and trim(bi.branch_name) = trim(branch)
            )
          )
        )
      );

    create policy "employee_delete_admin" on public.employee
      for delete to authenticated
      using (public.is_admin());
  end if;
end $$;

-- ---------- ลบตาราง branches เดิม ----------
drop table if exists public.branches cascade;

-- ---------- RLS branch_information ----------
alter table public.branch_information enable row level security;

drop policy if exists "branch_information_select_auth" on public.branch_information;
create policy "branch_information_select_auth" on public.branch_information
  for select to authenticated using (true);

drop policy if exists "branch_information_write_admin" on public.branch_information;
create policy "branch_information_write_admin" on public.branch_information
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------- สร้าง RLS คืน (เทียบเท่า schema.sql ปัจจุบัน) ----------
create policy "profiles_select" on public.profiles
  for select to authenticated using (
    id = auth.uid()
    or public.is_admin()
    or (
      public.is_manager()
      and branch_id is not distinct from public.my_branch_id()
      and public.my_branch_id() is not null
    )
  );

create policy "profiles_update_self" on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy "profiles_update_admin" on public.profiles
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "profiles_update_manager_employees" on public.profiles
  for update to authenticated
  using (
    public.is_manager()
    and role = 'employee'
    and public.same_branch_as(id)
  )
  with check (
    public.is_manager()
    and role = 'employee'
    and public.same_branch_as(id)
  );

create policy "attendance_select" on public.attendance_logs
  for select to authenticated using (
    user_id = auth.uid()
    or public.is_admin()
    or (
      public.is_manager()
      and public.same_branch_as(user_id)
    )
  );

create policy "schedules_select" on public.work_schedules
  for select to authenticated using (
    user_id = auth.uid()
    or public.is_admin()
    or (
      public.is_manager()
      and public.same_branch_as(user_id)
    )
  );

create policy "schedules_write_manager_admin" on public.work_schedules
  for insert to authenticated
  with check (
    public.is_admin()
    or (
      public.is_manager()
      and public.same_branch_as(user_id)
    )
  );

create policy "schedules_update_manager_admin" on public.work_schedules
  for update to authenticated
  using (
    public.is_admin()
    or (
      public.is_manager()
      and public.same_branch_as(user_id)
    )
  )
  with check (
    public.is_admin()
    or (
      public.is_manager()
      and public.same_branch_as(user_id)
    )
  );

create policy "schedules_delete_manager_admin" on public.work_schedules
  for delete to authenticated using (
    public.is_admin()
    or (
      public.is_manager()
      and public.same_branch_as(user_id)
    )
  );

create policy "tasks_select" on public.tasks
  for select to authenticated using (
    assigned_to = auth.uid()
    or assigned_by = auth.uid()
    or public.is_admin()
    or (
      public.is_manager()
      and public.same_branch_as(assigned_to)
    )
  );

create policy "tasks_insert" on public.tasks
  for insert to authenticated
  with check (
    public.is_admin()
    or (
      public.is_manager()
      and public.same_branch_as(assigned_to)
    )
  );

create policy "tasks_update" on public.tasks
  for update to authenticated
  using (
    assigned_to = auth.uid()
    or assigned_by = auth.uid()
    or public.is_admin()
    or (
      public.is_manager()
      and public.same_branch_as(assigned_to)
    )
  )
  with check (
    assigned_to = auth.uid()
    or assigned_by = auth.uid()
    or public.is_admin()
    or (
      public.is_manager()
      and public.same_branch_as(assigned_to)
    )
  );

create policy "tasks_delete" on public.tasks
  for delete to authenticated using (
    public.is_admin()
    or (
      public.is_manager()
      and public.same_branch_as(assigned_to)
    )
  );
