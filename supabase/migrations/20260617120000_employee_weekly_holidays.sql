-- Weekly recurring holidays per employee (day-of-week 0=Sunday .. 6=Saturday).

create table if not exists public.employee_weekly_holidays (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (user_id, weekday)
);

create index if not exists employee_weekly_holidays_user_idx
  on public.employee_weekly_holidays (user_id);

create index if not exists employee_weekly_holidays_weekday_idx
  on public.employee_weekly_holidays (weekday);

comment on table public.employee_weekly_holidays is
  'วันหยุดประจำสัปดาห์ต่อพนักงาน — weekday ตาม JavaScript (0=อาทิตย์ .. 6=เสาร์)';

alter table public.employee_weekly_holidays enable row level security;

drop policy if exists "ewh_select_scoped" on public.employee_weekly_holidays;
create policy "ewh_select_scoped" on public.employee_weekly_holidays
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_admin()
    or (
      public.is_manager()
      and public.is_direct_report_of_me(user_id)
    )
  );

drop policy if exists "ewh_write_scoped" on public.employee_weekly_holidays;
create policy "ewh_write_scoped" on public.employee_weekly_holidays
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
