-- มอบหมายงานจากแอป: บางโปรเจกต์ยังโดน RLS แม้มี tasks_insert_policy_check / task_assignee_mutation_allowed
-- สร้าง RPC SECURITY DEFINER เพื่อ insert tasks + task_assignees + task_checklist_items ในที่เดียว
-- ตรวจสิทธิ์: แอดมิน หรือ ลูกทีมใน manager_direct_reports หรือ ผู้จัดการ(role) + สาขาเดียวกัน/มอบให้ตัวเอง

create or replace function public.create_manager_task_bundle(
  p_title text,
  p_description text,
  p_priority text,
  p_start_at timestamptz,
  p_due_at timestamptz,
  p_assignee_ids uuid[],
  p_primary_ids uuid[],
  p_checklist_labels text[] default array[]::text[]
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_m uuid := auth.uid();
  v_tid uuid;
  v_pri text;
  v_main uuid;
  v_uid uuid;
  v_ord int := 0;
  v_chk int := 0;
begin
  if v_m is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if p_title is null or btrim(p_title) = '' then
    raise exception 'title required' using errcode = '23514';
  end if;

  if p_assignee_ids is null or cardinality(p_assignee_ids) < 1 then
    raise exception 'assignees required' using errcode = '23514';
  end if;

  if p_primary_ids is null or cardinality(p_primary_ids) < 1 then
    raise exception 'primary assignees required' using errcode = '23514';
  end if;

  foreach v_uid in array p_primary_ids loop
    if not (v_uid = any(p_assignee_ids)) then
      raise exception 'primary must be subset of assignees' using errcode = '23514';
    end if;
  end loop;

  foreach v_uid in array p_assignee_ids loop
    if not (
      public.is_admin()
      or exists (
        select 1
        from public.manager_direct_reports r
        where r.manager_id = v_m
          and r.subordinate_id = v_uid
      )
      or (
        public.is_manager()
        and (
          v_uid = v_m
          or public.same_branch_as(v_uid)
        )
      )
    ) then
      raise exception 'permission denied for assignee' using errcode = '42501';
    end if;
  end loop;

  v_pri := coalesce(nullif(btrim(coalesce(p_priority, '')), ''), 'normal');
  if v_pri not in ('urgent', 'high', 'medium', 'normal') then
    v_pri := 'normal';
  end if;

  select a.assignee_id
  into v_main
  from unnest(p_assignee_ids) with ordinality as a(assignee_id, ord)
  where assignee_id = any(p_primary_ids)
  order by ord
  limit 1;

  if v_main is null then
    v_main := p_assignee_ids[1];
  end if;

  insert into public.tasks (
    title,
    description,
    assigned_to,
    assigned_by,
    status,
    priority,
    start_at,
    due_at
  )
  values (
    btrim(p_title),
    nullif(btrim(coalesce(p_description, '')), ''),
    v_main,
    v_m,
    'pending',
    v_pri,
    p_start_at,
    p_due_at
  )
  returning id into v_tid;

  v_ord := 0;
  foreach v_uid in array p_assignee_ids loop
    insert into public.task_assignees (task_id, user_id, is_primary, sort_order)
    values (
      v_tid,
      v_uid,
      v_uid = any(p_primary_ids),
      v_ord
    );
    v_ord := v_ord + 1;
  end loop;

  if p_checklist_labels is not null and cardinality(p_checklist_labels) > 0 then
    for i in 1 .. cardinality(p_checklist_labels) loop
      if btrim(coalesce(p_checklist_labels[i], '')) <> '' then
        insert into public.task_checklist_items (task_id, label, sort_order, done)
        values (v_tid, btrim(p_checklist_labels[i]), v_chk, false);
        v_chk := v_chk + 1;
      end if;
    end loop;
  end if;

  return v_tid;
end;
$$;

comment on function public.create_manager_task_bundle(
  text, text, text, timestamptz, timestamptz, uuid[], uuid[], text[]
) is
  'สร้างงาน + ผู้รับ + เช็คลิสต์ — SECURITY DEFINER หลบ RLS ฝั่ง client';

revoke all on function public.create_manager_task_bundle(
  text, text, text, timestamptz, timestamptz, uuid[], uuid[], text[]
) from public;

grant execute on function public.create_manager_task_bundle(
  text, text, text, timestamptz, timestamptz, uuid[], uuid[], text[]
) to authenticated;
