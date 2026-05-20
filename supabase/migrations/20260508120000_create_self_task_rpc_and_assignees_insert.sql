-- สร้างงานให้ตัวเองผ่าน RPC (SECURITY DEFINER) — แก้กรณี INSERT tasks ถูก RLS บล็อกแม้ policy ถูกต้อง
-- + ปรับ task_assignees_insert ให้สอดคล้องกับงานที่ assigned_by เป็น null

-- ---------- RPC: สร้างงาน + แถวผู้รับผิดชอบหลัก ----------
create or replace function public.create_self_task(
  p_title text,
  p_description text,
  p_priority text,
  p_start_at timestamptz,
  p_due_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_id uuid;
  v_pri text;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not authenticated';
  end if;

  if p_title is null or btrim(p_title) = '' then
    raise exception using errcode = '23514', message = 'title required';
  end if;

  v_pri := coalesce(nullif(btrim(coalesce(p_priority, '')), ''), 'normal');
  if v_pri not in ('urgent', 'high', 'medium', 'normal') then
    v_pri := 'normal';
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
    v_uid,
    v_uid,
    'pending',
    v_pri,
    p_start_at,
    p_due_at
  )
  returning id into v_id;

  insert into public.task_assignees (task_id, user_id, is_primary, sort_order)
  values (v_id, v_uid, true, 0)
  on conflict (task_id, user_id) do nothing;

  return v_id;
end;
$$;

comment on function public.create_self_task(text, text, text, timestamptz, timestamptz) is
  'พนักงานสร้างงานให้ตัวเอง — บังคับ assigned_to/assigned_by = auth.uid()';

revoke all on function public.create_self_task(text, text, text, timestamptz, timestamptz) from public;
grant execute on function public.create_self_task(text, text, text, timestamptz, timestamptz) to authenticated;

-- ---------- task_assignees insert: ให้สอดคล้องกับ tasks_insert (assigned_by null ได้) ----------
drop policy if exists "task_assignees_insert" on public.task_assignees;

create policy "task_assignees_insert" on public.task_assignees
  for insert to authenticated
  with check (
    exists (
      select 1
      from public.tasks t
      where t.id = task_id
        and (
          t.assigned_by = auth.uid()
          or (
            t.assigned_to = auth.uid()
            and (
              t.assigned_by is null
              or t.assigned_by = auth.uid()
            )
          )
          or public.is_admin()
          or (
            public.is_manager()
            and public.same_branch_as(t.assigned_to)
          )
        )
    )
  );
