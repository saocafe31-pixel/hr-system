-- แก้ RLS มอบหมายงานที่ยังล้มเหลวหลัง migration ก่อนหน้า:
-- WITH CHECK ของ policy บางครั้งประเมิน EXISTS บนตารางที่มี RLS ในบริบทที่เข้ากันไม่ได้
-- ใช้ SECURITY DEFINER อ่าน manager_direct_reports / tasks โดยไม่ให้เงื่อนไขขัดกัน

create or replace function public.tasks_insert_policy_check(
  p_assigned_to uuid,
  p_assigned_by uuid
) returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return false;
  end if;

  if public.is_admin() then
    return true;
  end if;

  -- พนักงานสร้างงานให้ตัวเอง (assigned_by null หรือตัวเอง)
  if p_assigned_to = auth.uid()
     and (p_assigned_by is null or p_assigned_by = auth.uid()) then
    return true;
  end if;

  -- ผู้จัดการมอบหมาย: ต้องเป็นผู้มอบหมายจริง และผู้รับต้องเป็นตนเอง / สาขาเดียวกัน / ลูกทีมใน manager_direct_reports
  if public.is_manager()
     and p_assigned_by = auth.uid() then
    if p_assigned_to = auth.uid() then
      return true;
    end if;
    if public.same_branch_as(p_assigned_to) then
      return true;
    end if;
    if public.is_direct_report_of_me(p_assigned_to) then
      return true;
    end if;
  end if;

  return false;
end;
$$;

comment on function public.tasks_insert_policy_check(uuid, uuid) is
  'ใช้ใน RLS tasks INSERT — รวมเงื่อนไขมอบหมาย (ลูกทีม / สาขา) แบบ SECURITY DEFINER';

revoke all on function public.tasks_insert_policy_check(uuid, uuid) from public;
grant execute on function public.tasks_insert_policy_check(uuid, uuid) to authenticated;

-- อนุญาตแทรก task_assignees เมื่อผู้ใช้มีสิทธิ์จัดการแถวงานนั้น (อ่าน tasks ข้าม RLS ในมุม definer)
create or replace function public.task_assignee_mutation_allowed(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.tasks t
    where t.id = p_task_id
      and (
        t.assigned_by = auth.uid()
        or public.is_admin()
        or (
          public.is_manager()
          and t.assigned_by = auth.uid()
        )
        or (
          public.is_manager()
          and public.same_branch_as(t.assigned_to)
        )
        or (
          public.is_manager()
          and exists (
            select 1
            from public.manager_direct_reports r
            where r.manager_id = auth.uid()
              and r.subordinate_id = t.assigned_to
          )
        )
      )
  );
$$;

comment on function public.task_assignee_mutation_allowed(uuid) is
  'ใช้ใน RLS task_assignees — ผู้มอบหมาย / แอดมิน / ผู้จัดการตามสาขา/ลูกทีม';

revoke all on function public.task_assignee_mutation_allowed(uuid) from public;
grant execute on function public.task_assignee_mutation_allowed(uuid) to authenticated;

drop policy if exists "tasks_insert" on public.tasks;

create policy "tasks_insert" on public.tasks
  for insert to authenticated
  with check ( public.tasks_insert_policy_check(assigned_to, assigned_by) );

drop policy if exists "task_assignees_insert" on public.task_assignees;

create policy "task_assignees_insert" on public.task_assignees
  for insert to authenticated
  with check ( public.task_assignee_mutation_allowed(task_id) );

drop policy if exists "task_assignees_update" on public.task_assignees;

create policy "task_assignees_update" on public.task_assignees
  for update to authenticated
  using ( public.task_assignee_mutation_allowed(task_id) )
  with check ( public.task_assignee_mutation_allowed(task_id) );

drop policy if exists "task_assignees_delete" on public.task_assignees;

create policy "task_assignees_delete" on public.task_assignees
  for delete to authenticated
  using ( public.task_assignee_mutation_allowed(task_id) );
