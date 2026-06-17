-- Company-wide annual holidays (admin-managed, visible to all authenticated users).

create table if not exists public.company_holiday_dates (
  id uuid primary key default gen_random_uuid(),
  holiday_date date not null,
  title text not null,
  description text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (holiday_date)
);

create index if not exists company_holiday_dates_date_idx
  on public.company_holiday_dates (holiday_date);

comment on table public.company_holiday_dates is
  'วันหยุดประจำปีของบริษัท — แอดมินตั้งชื่อ/รายละเอียด ทุกคนอ่านได้';

alter table public.company_holiday_dates enable row level security;

drop policy if exists "chd_select_authenticated" on public.company_holiday_dates;
create policy "chd_select_authenticated" on public.company_holiday_dates
  for select to authenticated
  using (true);

drop policy if exists "chd_admin_write" on public.company_holiday_dates;
create policy "chd_admin_write" on public.company_holiday_dates
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());
