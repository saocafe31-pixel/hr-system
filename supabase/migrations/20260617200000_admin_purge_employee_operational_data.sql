-- แอดมินลบข้อมูลการใช้งานของพนักงานตามหมวด (เก็บ employee + Auth/profile ไว้)

create or replace function public.admin_purge_employee_operational_data(
  p_employee_id uuid,
  p_delete_attendance boolean default false,
  p_delete_leave boolean default false,
  p_delete_other boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid;
  v_attendance int := 0;
  v_leave int := 0;
  v_other int := 0;
  v_cnt int;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if not exists (select 1 from public.employee e where e.id = p_employee_id) then
    raise exception 'employee not found' using errcode = 'P0002';
  end if;

  if not coalesce(p_delete_attendance, false)
     and not coalesce(p_delete_leave, false)
     and not coalesce(p_delete_other, false) then
    raise exception 'เลือกอย่างน้อยหนึ่งประเภทข้อมูลที่ต้องการลบ' using errcode = '22023';
  end if;

  v_profile_id := public.admin_profile_id_for_employee(p_employee_id);

  if coalesce(p_delete_attendance, false) and v_profile_id is not null then
    delete from public.attendance_logs where user_id = v_profile_id;
    get diagnostics v_cnt = row_count;
    v_attendance := v_attendance + v_cnt;

    delete from public.attendance_overtime_requests where user_id = v_profile_id;
    get diagnostics v_cnt = row_count;
    v_attendance := v_attendance + v_cnt;

    delete from public.wellbeing_checkins where user_id = v_profile_id;
    get diagnostics v_cnt = row_count;
    v_attendance := v_attendance + v_cnt;

    delete from public.attendance_chat_messages where user_id = v_profile_id;
    get diagnostics v_cnt = row_count;
    v_attendance := v_attendance + v_cnt;
  end if;

  if coalesce(p_delete_leave, false) and v_profile_id is not null then
    delete from public.leave_requests where user_id = v_profile_id;
    get diagnostics v_cnt = row_count;
    v_leave := v_leave + v_cnt;

    delete from public.late_requests where user_id = v_profile_id;
    get diagnostics v_cnt = row_count;
    v_leave := v_leave + v_cnt;

    delete from public.vacation_grants where user_id = v_profile_id;
    get diagnostics v_cnt = row_count;
    v_leave := v_leave + v_cnt;
  end if;

  if coalesce(p_delete_other, false) and v_profile_id is not null then
    delete from public.work_schedule_assignments where user_id = v_profile_id;
    get diagnostics v_cnt = row_count;
    v_other := v_other + v_cnt;

    delete from public.work_schedules where user_id = v_profile_id;
    get diagnostics v_cnt = row_count;
    v_other := v_other + v_cnt;

    delete from public.employee_holiday_dates where user_id = v_profile_id;
    get diagnostics v_cnt = row_count;
    v_other := v_other + v_cnt;

    if to_regclass('public.employee_weekly_holidays') is not null then
      execute 'delete from public.employee_weekly_holidays where user_id = $1'
        using v_profile_id;
      get diagnostics v_cnt = row_count;
      v_other := v_other + v_cnt;
    end if;

    delete from public.attendance_calendar_notes where user_id = v_profile_id;
    get diagnostics v_cnt = row_count;
    v_other := v_other + v_cnt;

    delete from public.task_assignees where user_id = v_profile_id;
    get diagnostics v_cnt = row_count;
    v_other := v_other + v_cnt;

    delete from public.tasks where assigned_to = v_profile_id;
    get diagnostics v_cnt = row_count;
    v_other := v_other + v_cnt;

    delete from public.salary_claims where user_id = v_profile_id;
    get diagnostics v_cnt = row_count;
    v_other := v_other + v_cnt;

    delete from public.expense_claims where user_id = v_profile_id;
    get diagnostics v_cnt = row_count;
    v_other := v_other + v_cnt;

    delete from public.community_notes where user_id = v_profile_id;
    get diagnostics v_cnt = row_count;
    v_other := v_other + v_cnt;

    delete from public.community_feed_posts where user_id = v_profile_id;
    get diagnostics v_cnt = row_count;
    v_other := v_other + v_cnt;

    delete from public.status_notifications where recipient_id = v_profile_id;
    get diagnostics v_cnt = row_count;
    v_other := v_other + v_cnt;

    delete from public.finance_claim_notifications where recipient_id = v_profile_id;
    get diagnostics v_cnt = row_count;
    v_other := v_other + v_cnt;

    if to_regclass('public.push_notification_jobs') is not null then
      delete from public.push_notification_jobs where recipient_id = v_profile_id;
      get diagnostics v_cnt = row_count;
      v_other := v_other + v_cnt;
    end if;

    if to_regclass('public.web_push_notification_jobs') is not null then
      delete from public.web_push_notification_jobs where recipient_id = v_profile_id;
      get diagnostics v_cnt = row_count;
      v_other := v_other + v_cnt;
    end if;

    if to_regclass('public.task_notifications') is not null then
      delete from public.task_notifications where recipient_id = v_profile_id;
      get diagnostics v_cnt = row_count;
      v_other := v_other + v_cnt;
    end if;
  end if;

  if coalesce(p_delete_other, false) then
    delete from public.salary_claims where employee_id = p_employee_id;
    get diagnostics v_cnt = row_count;
    v_other := v_other + v_cnt;

    delete from public.expense_claims where employee_id = p_employee_id;
    get diagnostics v_cnt = row_count;
    v_other := v_other + v_cnt;
  end if;

  return jsonb_build_object(
    'employee_id', p_employee_id,
    'profile_id', v_profile_id,
    'attendance_deleted', v_attendance,
    'leave_deleted', v_leave,
    'other_deleted', v_other
  );
end;
$$;

comment on function public.admin_purge_employee_operational_data(uuid, boolean, boolean, boolean) is
  'แอดมินเท่านั้น: ลบข้อมูลการใช้งานตามหมวด (เข้า-ออกงาน / ลา-สาย / อื่นๆ) โดยเก็บแถว employee, profiles และบัญชี Auth ไว้';

revoke all on function public.admin_purge_employee_operational_data(uuid, boolean, boolean, boolean) from public;
grant execute on function public.admin_purge_employee_operational_data(uuid, boolean, boolean, boolean) to authenticated;
