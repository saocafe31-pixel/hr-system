-- บันทึกอารมณ์/สภาพพร้อมทำงาน ตอนเข้า-ออกงาน (แสดงอิโมจิท้ายชื่อ + กราฟ)

create table if not exists public.wellbeing_checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  mood_key text not null
    check (
      mood_key in (
        'ready_great',
        'relaxed_ready',
        'ok_start',
        'tired_fight',
        'unwell'
      )
    ),
  score smallint not null check (score >= 1 and score <= 5),
  emoji text not null,
  label text not null,
  attendance_kind text not null
    check (attendance_kind in ('check_in', 'check_out')),
  created_at timestamptz not null default now()
);

create index if not exists wellbeing_checkins_user_created_idx
  on public.wellbeing_checkins (user_id, created_at desc);

create index if not exists wellbeing_checkins_created_idx
  on public.wellbeing_checkins (created_at desc);

alter table public.wellbeing_checkins enable row level security;

drop policy if exists "wellbeing_insert_own" on public.wellbeing_checkins;
create policy "wellbeing_insert_own" on public.wellbeing_checkins
  for insert to authenticated
  with check (user_id = auth.uid());

-- แอปในองค์กร: อ่านได้เพื่อแสดงอิโมจิวันนี้ข้างชื่อในแชท/คอมมูนิตี้
drop policy if exists "wellbeing_select_org" on public.wellbeing_checkins;
create policy "wellbeing_select_org" on public.wellbeing_checkins
  for select to authenticated
  using (true);
