-- Per-date employee holidays (specific calendar days, not recurring weekdays).

create table if not exists public.employee_holiday_dates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  holiday_date date not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (user_id, holiday_date)
);

create index if not exists employee_holiday_dates_user_idx
  on public.employee_holiday_dates (user_id);

create index if not exists employee_holiday_dates_date_idx
  on public.employee_holiday_dates (holiday_date);

comment on table public.employee_holiday_dates is
  'วันหยุดตามวันที่จริงต่อพนักงาน (ไม่ซ้ำทุกสัปดาห์)';

alter table public.employee_holiday_dates enable row level security;

drop policy if exists "ehd_select_scoped" on public.employee_holiday_dates;
create policy "ehd_select_scoped" on public.employee_holiday_dates
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_admin()
    or (
      public.is_manager()
      and public.is_direct_report_of_me(user_id)
    )
  );

drop policy if exists "ehd_write_scoped" on public.employee_holiday_dates;
create policy "ehd_write_scoped" on public.employee_holiday_dates
  for all to authenticated
  using (
    public.is_admin()
    or (
      public.is_manager()
      and exists (
        select 1 from public.manager_scopes s
        where s.manager_id = auth.uid() and s.can_manage_schedule
      )
      and public.is_direct_report_of_me(user_id)
    )
  )
  with check (
    public.is_admin()
    or (
      public.is_manager()
      and exists (
        select 1 from public.manager_scopes s
        where s.manager_id = auth.uid() and s.can_manage_schedule
      )
      and public.is_direct_report_of_me(user_id)
    )
  );

-- Replaced by per-date holidays; safe to drop if empty or unused.
drop table if exists public.employee_weekly_holidays;
