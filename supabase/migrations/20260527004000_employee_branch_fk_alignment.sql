-- Normalize public.employee branch data to public.branch_information.
-- Keep employee.branch / employee.branch_code as compatibility display columns,
-- but make employee.branch_id the source of truth.

alter table public.employee
  add column if not exists branch_id bigint;

-- Prefer the branch already assigned on linked profiles.
with profile_branch as (
  select
    p.employee_id,
    min(p.branch_id) as branch_id,
    count(distinct p.branch_id) as branch_count
  from public.profiles p
  where p.employee_id is not null
    and p.branch_id is not null
  group by p.employee_id
)
update public.employee e
set branch_id = pb.branch_id
from profile_branch pb
where e.id = pb.employee_id
  and e.branch_id is null
  and pb.branch_count = 1;

-- Then infer from legacy employee.branch_code / employee.branch text.
with matched_branch as (
  select distinct on (e.id)
    e.id as employee_id,
    bi.id as branch_id
  from public.employee e
  join public.branch_information bi
    on (
      nullif(trim(e.branch_code), '') is not null
      and lower(trim(bi.branch_code)) = lower(trim(e.branch_code))
    )
    or (
      nullif(trim(e.branch), '') is not null
      and lower(trim(bi.branch_name)) = lower(trim(e.branch))
    )
    or (
      nullif(trim(e.branch), '') is not null
      and lower(trim(bi.branch_code)) = lower(trim(e.branch))
    )
  where e.branch_id is null
  order by
    e.id,
    case
      when nullif(trim(e.branch_code), '') is not null
        and lower(trim(bi.branch_code)) = lower(trim(e.branch_code)) then 1
      when nullif(trim(e.branch), '') is not null
        and lower(trim(bi.branch_name)) = lower(trim(e.branch)) then 2
      else 3
    end,
    bi.id
)
update public.employee e
set branch_id = mb.branch_id
from matched_branch mb
where e.id = mb.employee_id
  and e.branch_id is null;

-- Drop invalid branch_id values before adding the FK on databases that already
-- had a loose branch_id column.
update public.employee e
set branch_id = null
where e.branch_id is not null
  and not exists (
    select 1
    from public.branch_information bi
    where bi.id = e.branch_id
  );

-- Keep legacy text columns aligned with the referenced branch.
update public.employee e
set
  branch = coalesce(nullif(trim(bi.branch_name), ''), e.branch),
  branch_code = coalesce(nullif(trim(bi.branch_code), ''), e.branch_code)
from public.branch_information bi
where bi.id = e.branch_id;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'employee_branch_id_fkey'
      and conrelid = 'public.employee'::regclass
  ) then
    alter table public.employee
      add constraint employee_branch_id_fkey
      foreign key (branch_id)
      references public.branch_information (id)
      on delete set null;
  end if;
end $$;

create index if not exists employee_branch_id_idx
  on public.employee (branch_id);

create or replace function public.employee_sync_branch_information()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch public.branch_information%rowtype;
begin
  if new.branch_id is null then
    select *
      into v_branch
    from public.branch_information bi
    where (
        nullif(trim(new.branch_code), '') is not null
        and lower(trim(bi.branch_code)) = lower(trim(new.branch_code))
      )
      or (
        nullif(trim(new.branch), '') is not null
        and lower(trim(bi.branch_name)) = lower(trim(new.branch))
      )
      or (
        nullif(trim(new.branch), '') is not null
        and lower(trim(bi.branch_code)) = lower(trim(new.branch))
      )
    order by
      case
        when nullif(trim(new.branch_code), '') is not null
          and lower(trim(bi.branch_code)) = lower(trim(new.branch_code)) then 1
        when nullif(trim(new.branch), '') is not null
          and lower(trim(bi.branch_name)) = lower(trim(new.branch)) then 2
        else 3
      end,
      bi.id
    limit 1;

    if found then
      new.branch_id := v_branch.id;
    end if;
  end if;

  if new.branch_id is not null then
    select *
      into v_branch
    from public.branch_information bi
    where bi.id = new.branch_id;

    if found then
      new.branch = coalesce(nullif(trim(v_branch.branch_name), ''), new.branch);
      new.branch_code = coalesce(nullif(trim(v_branch.branch_code), ''), new.branch_code);
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists employee_sync_branch_information_trg on public.employee;
create trigger employee_sync_branch_information_trg
  before insert or update of branch_id, branch, branch_code
  on public.employee
  for each row
  execute function public.employee_sync_branch_information();

comment on column public.employee.branch_id is
  'Canonical branch reference for HR employee rows. References public.branch_information(id).';
comment on column public.employee.branch is
  'Legacy display copy of branch_information.branch_name, kept for compatibility.';
comment on column public.employee.branch_code is
  'Legacy display copy of branch_information.branch_code, kept for compatibility.';

-- ---------- employee_directory view ----------
create or replace view public.employee_directory
with (security_invoker = true) as
select
  e.id,
  e."UserID" as legacy_user_id,
  e."Employee ID" as employee_no,
  e."Prefix" as prefix,
  e."Name" as name,
  e."Surname" as surname,
  e.nickname,
  e.position,
  coalesce(nullif(trim(bi.branch_name), ''), nullif(trim(e.branch), '')) as branch,
  e.branch_id,
  e."phone number" as phone,
  e."Start date" as start_date,
  e."National ID number" as national_id,
  e."Address as per ID card" as address_id_card,
  e."Current address" as current_address,
  e.bank,
  e."Account number" as account_number,
  e.status,
  coalesce(nullif(trim(bi.branch_code), ''), nullif(trim(e.branch_code), '')) as branch_code
from public.employee e
left join public.branch_information bi on bi.id = e.branch_id;

grant select on public.employee_directory to authenticated;

-- ---------- admin_get_employee_directory_row ----------
create or replace function public.admin_get_employee_directory_row(p_id uuid)
returns table (
  id uuid,
  legacy_user_id text,
  employee_no integer,
  prefix text,
  name text,
  surname text,
  nickname text,
  "position" text,
  branch text,
  branch_id bigint,
  phone text,
  start_date text,
  national_id text,
  address_id_card text,
  current_address text,
  bank text,
  account_number text,
  status text
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
  select
    e.id,
    nullif(trim(e."UserID"::text), '') as legacy_user_id,
    case
      when e."Employee ID" is null then null::integer
      else (e."Employee ID")::integer
    end as employee_no,
    nullif(trim(e."Prefix"::text), '') as prefix,
    nullif(trim(e."Name"::text), '') as name,
    nullif(trim(e."Surname"::text), '') as surname,
    nullif(trim(e.nickname::text), '') as nickname,
    nullif(trim(e."position"::text), '') as "position",
    coalesce(nullif(trim(bi.branch_name), ''), nullif(trim(e.branch::text), '')) as branch,
    e.branch_id,
    nullif(trim(e."phone number"::text), '') as phone,
    case
      when e."Start date" is null then null::text
      else trim(e."Start date"::text)
    end as start_date,
    nullif(trim(e."National ID number"::text), '') as national_id,
    nullif(trim(e."Address as per ID card"::text), '') as address_id_card,
    nullif(trim(e."Current address"::text), '') as current_address,
    nullif(trim(e.bank::text), '') as bank,
    nullif(trim(e."Account number"::text), '') as account_number,
    nullif(trim(e.status::text), '') as status
  from public.employee e
  left join public.branch_information bi on bi.id = e.branch_id
  where e.id = p_id
  limit 1;
end;
$$;

grant execute on function public.admin_get_employee_directory_row(uuid) to authenticated;

-- ---------- admin_list_employee_directory_rows ----------
create or replace function public.admin_list_employee_directory_rows()
returns table (
  id uuid,
  legacy_user_id text,
  employee_no bigint,
  prefix text,
  name text,
  surname text,
  nickname text,
  "position" text,
  branch text,
  branch_code text,
  branch_id bigint,
  phone text,
  start_date text,
  national_id text,
  address_id_card text,
  current_address text,
  bank text,
  account_number text,
  status text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  ) then
    return;
  end if;

  return query
  select
    e.id,
    e."UserID"::text as legacy_user_id,
    e."Employee ID"::bigint as employee_no,
    e."Prefix"::text as prefix,
    e."Name"::text as name,
    e."Surname"::text as surname,
    e.nickname::text as nickname,
    e.position::text as position,
    coalesce(nullif(trim(bi.branch_name), ''), nullif(trim(e.branch::text), '')) as branch,
    coalesce(nullif(trim(bi.branch_code), ''), nullif(trim(e.branch_code::text), '')) as branch_code,
    e.branch_id,
    e."phone number"::text as phone,
    e."Start date"::text as start_date,
    e."National ID number"::text as national_id,
    e."Address as per ID card"::text as address_id_card,
    e."Current address"::text as current_address,
    e.bank::text as bank,
    e."Account number"::text as account_number,
    e.status::text as status
  from public.employee e
  left join public.branch_information bi on bi.id = e.branch_id
  order by
    coalesce(e."Employee ID"::bigint, 9223372036854775807),
    coalesce(e."Name", ''),
    coalesce(e."Surname", '');
end;
$$;

grant execute on function public.admin_list_employee_directory_rows() to authenticated;

-- ---------- manager_list_team_directory_rows ----------
create or replace function public.manager_list_team_directory_rows()
returns table (
  id uuid,
  legacy_user_id text,
  employee_no bigint,
  prefix text,
  name text,
  surname text,
  nickname text,
  "position" text,
  branch text,
  branch_code text,
  branch_id bigint,
  phone text,
  start_date text,
  national_id text,
  address_id_card text,
  current_address text,
  bank text,
  account_number text,
  status text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'manager'
  ) then
    return;
  end if;

  return query
  select
    e.id,
    e."UserID"::text as legacy_user_id,
    e."Employee ID"::bigint as employee_no,
    e."Prefix"::text as prefix,
    e."Name"::text as name,
    e."Surname"::text as surname,
    e.nickname::text as nickname,
    e.position::text as position,
    coalesce(nullif(trim(bi.branch_name), ''), nullif(trim(e.branch::text), '')) as branch,
    coalesce(nullif(trim(bi.branch_code), ''), nullif(trim(e.branch_code::text), '')) as branch_code,
    e.branch_id,
    e."phone number"::text as phone,
    e."Start date"::text as start_date,
    e."National ID number"::text as national_id,
    e."Address as per ID card"::text as address_id_card,
    e."Current address"::text as current_address,
    e.bank::text as bank,
    e."Account number"::text as account_number,
    e.status::text as status
  from public.employee e
  left join public.branch_information bi on bi.id = e.branch_id
  where e.id in (
    select p.employee_id
    from public.profiles p
    join public.manager_direct_reports r on r.subordinate_id = p.id
    where r.manager_id = auth.uid()
      and p.employee_id is not null
  )
  order by
    coalesce(e."Employee ID"::bigint, 9223372036854775807),
    coalesce(e."Name", ''),
    coalesce(e."Surname", '');
end;
$$;

grant execute on function public.manager_list_team_directory_rows() to authenticated;

-- ---------- admin_list_employee_passwords ----------
do $$
declare
  password_expr text;
  pw_att name;
begin
  select a.attname
  into pw_att
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'employee'
    and a.attnum > 0
    and not a.attisdropped
    and lower(a.attname) = 'password'
  order by a.attname
  limit 1;

  if pw_att is not null then
    password_expr := format('(e.%I)::text', pw_att);
  else
    password_expr := 'null::text';
  end if;

  execute format(
    $create$
create or replace function public.admin_list_employee_passwords()
returns table (
  id uuid,
  legacy_user_id text,
  legacy_password text,
  employee_no integer,
  display_name text,
  branch text,
  employment_status text
)
language plpgsql
security definer
set search_path = public
stable
as $fn$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
  select
    e.id,
    nullif(trim(e."UserID"::text), '') as legacy_user_id,
    %s as legacy_password,
    case
      when e."Employee ID" is null then null::integer
      else (e."Employee ID")::integer
    end as employee_no,
    nullif(trim(concat_ws(' ', e."Prefix", e."Name", e."Surname")), '') as display_name,
    coalesce(nullif(trim(bi.branch_name), ''), nullif(trim(e.branch::text), '')) as branch,
    nullif(trim(e.status::text), '') as employment_status
  from public.employee e
  left join public.branch_information bi on bi.id = e.branch_id
  order by e."Employee ID" nulls last, e.id;
end;
$fn$;
$create$,
    password_expr
  );

  grant execute on function public.admin_list_employee_passwords() to authenticated;
end $$;
