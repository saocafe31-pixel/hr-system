-- แอดมินตั้งรหัส legacy ใน employee ผ่าน SECURITY DEFINER (รองรับคอลัมน์ Password ที่ชื่อต่างกัน หรือไม่มีคอลัมน์)

create or replace function public.admin_update_employee_legacy_password(
  p_employee_id uuid,
  p_password text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  pw_att name;
  v_pw text;
  n int;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  v_pw := nullif(btrim(coalesce(p_password, '')), '');
  if v_pw is null then
    return jsonb_build_object('ok', false, 'error', 'empty_password');
  end if;

  select a.attname
  into pw_att
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'employee'
    and a.attnum > 0
    and not a.attisdropped
    and lower(a.attname) = 'password'
  order by a.attname
  limit 1;

  if pw_att is null then
    return jsonb_build_object('ok', false, 'error', 'no_password_column');
  end if;

  execute format(
    'update public.employee set %I = $1 where id = $2',
    pw_att
  )
  using v_pw, p_employee_id;

  get diagnostics n = row_count;
  if n < 1 then
    return jsonb_build_object('ok', false, 'error', 'employee_not_found');
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.admin_update_employee_legacy_password(uuid, text) from public;
grant execute on function public.admin_update_employee_legacy_password(uuid, text) to authenticated;

comment on function public.admin_update_employee_legacy_password(uuid, text) is
  'แอดมินตั้งรหัส legacy ในตาราง employee (ถ้ามีคอลัมน์ password) — ไม่ใช่รหัสล็อกอิน Supabase Auth';
