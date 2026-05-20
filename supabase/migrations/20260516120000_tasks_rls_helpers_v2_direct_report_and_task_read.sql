-- v2: แก้มอบหมายงานยังโดน RLS
-- 1) ผู้ที่แอดมินใส่เป็น manager_id ใน manager_direct_reports แต่ profiles.role ยังไม่ใช่ manager
--    → is_manager() เป็น false ทำให้ tasks_insert_policy_check ไม่ผ่าน — อนุญาตด้วย is_direct_report_of_me โดยไม่พึ่ง role
-- 2) task_assignee_mutation_allowed อ่าน public.tasks ภายใน SECURITY DEFINER — บางโปรเจกต์ยังโดน RLS ตอน EXISTS
--    → ใช้ plpgsql + set_config(row_security, off) ชั่วคราว (รันจาก postgres บน Supabase)

create or replace function public.tasks_insert_policy_check(
  p_assigned_to uuid,
  p_assigned_by uuid
) returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  perform set_config('row_security', 'off', true);

  if auth.uid() is null then
    return false;
  end if;

  if public.is_admin() then
    return true;
  end if;

  -- พนักงานสร้างงานให้ตัวเอง
  if p_assigned_to = auth.uid()
     and (p_assigned_by is null or p_assigned_by = auth.uid()) then
    return true;
  end if;

  -- มอบหมายเมื่อ auth เป็น assigned_by และผู้รับอยู่ในลูกทีมโดยตรง (ไม่บังคับ role manager)
  if p_assigned_by = auth.uid()
     and public.is_direct_report_of_me(p_assigned_to) then
    return true;
  end if;

  -- ผู้จัดการตาม role: สาขาเดียวกัน / มอบให้ตัวเอง
  if public.is_manager()
     and p_assigned_by = auth.uid()
     and (
       p_assigned_to = auth.uid()
       or public.same_branch_as(p_assigned_to)
     ) then
    return true;
  end if;

  return false;
end;
$$;

comment on function public.tasks_insert_policy_check(uuid, uuid) is
  'RLS tasks INSERT — ลูกทีม manager_direct_reports โดยไม่พึ่ง profiles.role; ปิด row_security ชั่วคราวตอนประเมิน';

create or replace function public.task_assignee_mutation_allowed(p_task_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_ab uuid;
  v_to uuid;
begin
  perform set_config('row_security', 'off', true);

  select t.assigned_by, t.assigned_to
  into v_ab, v_to
  from public.tasks t
  where t.id = p_task_id;

  if not found then
    return false;
  end if;

  if public.is_admin() then
    return true;
  end if;

  if v_ab is not distinct from auth.uid() then
    return true;
  end if;

  if v_to = auth.uid() and (v_ab is null or v_ab = auth.uid()) then
    return true;
  end if;

  if public.is_manager() and public.same_branch_as(v_to) then
    return true;
  end if;

  if public.is_manager()
     and v_ab = auth.uid()
     and public.is_direct_report_of_me(v_to) then
    return true;
  end if;

  return false;
end;
$$;

comment on function public.task_assignee_mutation_allowed(uuid) is
  'RLS task_assignees — อ่าน tasks แบบ bypass RLS ชั่วคราวเพื่อประเมิน policy';

revoke all on function public.tasks_insert_policy_check(uuid, uuid) from public;
grant execute on function public.tasks_insert_policy_check(uuid, uuid) to authenticated;

revoke all on function public.task_assignee_mutation_allowed(uuid) from public;
grant execute on function public.task_assignee_mutation_allowed(uuid) to authenticated;
