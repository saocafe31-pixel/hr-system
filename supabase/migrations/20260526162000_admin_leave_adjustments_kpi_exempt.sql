-- Allow admins/HR to record missed leave usage without affecting attendance KPI.

alter table public.leave_requests
  add column if not exists is_kpi_exempt boolean not null default false,
  add column if not exists admin_adjusted_by uuid references public.profiles(id),
  add column if not exists admin_adjusted_at timestamptz;

comment on column public.leave_requests.is_kpi_exempt is
  'True when leave was entered by admin/HR as a missed record adjustment and should not deduct attendance KPI.';

drop policy if exists "leave_insert_admin_adjustment" on public.leave_requests;
create policy "leave_insert_admin_adjustment" on public.leave_requests
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists "leave_delete_admin_adjustment" on public.leave_requests;
create policy "leave_delete_admin_adjustment" on public.leave_requests
  for delete to authenticated
  using (public.is_admin() and is_kpi_exempt);
