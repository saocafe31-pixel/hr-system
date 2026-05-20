-- ตาราง employee: เพิ่ม id uuid เป็น PRIMARY KEY + เชื่อม profiles.employee_id จาก UserID กับอีเมล
-- รันครั้งเดียว; ถ้ามี id อยู่แล้วจะข้ามขั้นตอนเพิ่มคอลัมน์

do $$
begin
  if not exists (
    select 1
    from information_schema.tables
    where table_schema = 'public' and table_name = 'employee'
  ) then
    raise notice 'skip: public.employee does not exist';
    return;
  end if;

  -- 1) เพิ่มคอลัมน์ id (ถ้ายังไม่มี)
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'employee'
      and column_name = 'id'
  ) then
    alter table public.employee add column id uuid;
    update public.employee set id = gen_random_uuid() where id is null;
    alter table public.employee alter column id set default gen_random_uuid();
    alter table public.employee alter column id set not null;
  else
    -- มีคอลัมน์ id แล้ว แต่ยังมีแถวว่าง (กรณีผิดปกติ)
    update public.employee set id = gen_random_uuid() where id is null;
    alter table public.employee alter column id set default gen_random_uuid();
    alter table public.employee alter column id set not null;
  end if;
end $$;

-- 2) ถ้า PK เดิมไม่ใช่ที่คอลัมน์ id ให้ลบแล้วตั้ง PRIMARY KEY (id)
do $$
declare
  pk_name text;
  pk_on_id boolean;
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'employee'
  ) then
    return;
  end if;

  select c.conname into pk_name
  from pg_constraint c
  where c.conrelid = 'public.employee'::regclass
    and c.contype = 'p'
  limit 1;

  select exists (
    select 1
    from pg_constraint c
    join unnest(c.conkey) with ordinality as u(attnum, ord) on true
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = u.attnum
    where c.conrelid = 'public.employee'::regclass
      and c.contype = 'p'
      and a.attname = 'id'
      and array_length(c.conkey, 1) = 1
  ) into pk_on_id;

  if pk_name is not null and not coalesce(pk_on_id, false) then
    execute format('alter table public.employee drop constraint %I', pk_name);
  end if;

  if not exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.employee'::regclass
      and c.contype = 'p'
  ) then
    alter table public.employee add primary key (id);
  end if;
end $$;

-- 3) ถ้า "Employee ID" ไม่ใช่ PK แล้ว ให้มี UNIQUE เพื่อกันซ้ำ (ข้ามถ้าซ้ำในข้อมูลจริง)
do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'employee'
  ) then
    return;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'employee'
      and column_name = 'Employee ID'
  ) and not exists (
    select 1 from pg_constraint
    where conrelid = 'public.employee'::regclass
      and conname = 'employee_employee_id_key'
  ) then
    begin
      alter table public.employee
        add constraint employee_employee_id_key unique ("Employee ID");
    exception
      when unique_violation then
        raise notice 'skip unique on Employee ID: duplicate values in data';
    end;
  end if;
end $$;

-- 4) เติม profiles.employee_id: UserID (employee) เทียบกับอีเมล
--     ลำดับ 1) auth.users.email (หลัก) 2) profiles.email เมื่อยังไม่มี employee_id
do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'employee'
  ) then
    return;
  end if;

  -- map หนึ่งแถวต่อหนึ่ง UserID (กรณีซ้ำเลือก Employee ID เลขน้อยสุดก่อน)
  create temporary table if not exists _employee_uid_map (
    emp_id uuid primary key,
    k text not null unique
  ) on commit drop;

  insert into _employee_uid_map (emp_id, k)
  select distinct on (u.uid_norm)
    u.id,
    u.uid_norm
  from (
    select
      e.id,
      trim(lower(btrim(e."UserID"::text))) as uid_norm,
      e."Employee ID" as emp_no
    from public.employee e
    where e."UserID" is not null
      and btrim(e."UserID"::text) <> ''
  ) u
  order by u.uid_norm, u.emp_no asc nulls last
  on conflict (k) do nothing;

  -- 4a อีเมลจาก Authentication (ห้ามใช้ JOIN ... ON u.id = p.id — PG ไม่ให้อ้าง p ใน ON ของ FROM)
  update public.profiles p
  set employee_id = m.emp_id
  from _employee_uid_map m, auth.users u
  where p.id = u.id
    and trim(lower(btrim(u.email::text))) = m.k;

  -- 4b อีเมลจาก profiles (เฉพาะที่ยังไม่ได้เชื่อม)
  update public.profiles p
  set employee_id = m.emp_id
  from _employee_uid_map m
  where p.employee_id is null
    and p.email is not null
    and trim(lower(btrim(p.email))) = m.k;
end $$;

-- 5) ล้าง employee_id ที่ไม่ชี้แถว employee (ก่อนใส่ FK)
do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'employee'
  ) then
    return;
  end if;

  update public.profiles p
  set employee_id = null
  where p.employee_id is not null
    and not exists (
      select 1 from public.employee e where e.id = p.employee_id
    );
end $$;

-- 6) FK profiles.employee_id → employee.id (ถ้ายังไม่มี)
do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'employee'
  ) then
    return;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'profiles_employee_id_fkey'
  ) then
    alter table public.profiles
      add constraint profiles_employee_id_fkey
      foreign key (employee_id) references public.employee (id) on delete set null;
  end if;
end $$;
