alter table public.work_schedule_assignments
  add column if not exists allowed_branch_id bigint
  references public.branch_information(id) on delete set null;

create index if not exists work_schedule_assignments_allowed_branch_idx
  on public.work_schedule_assignments (allowed_branch_id);
