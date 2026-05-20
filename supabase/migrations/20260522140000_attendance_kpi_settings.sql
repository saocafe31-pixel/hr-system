-- Attendance KPI settings are edited by admins and read by authenticated users.

insert into public.app_settings (key, value)
values (
  'attendance_kpi_settings',
  '{
    "leaveMaxScore": 10,
    "lateMaxScore": 10,
    "personalNotice": {
      "goodDays": 7,
      "midDays": 4,
      "lowDays": 2,
      "penaltyBelowGood": 1,
      "penaltyBelowMid": 2,
      "penaltyBelowLow": 3
    },
    "sickNotice": {
      "minHours": 1,
      "penaltyBelowMin": 2
    },
    "vacationNotice": {
      "goodDays": 30,
      "midDays": 20,
      "lowDays": 10,
      "penaltyBelowGood": 1,
      "penaltyBelowMid": 2,
      "penaltyBelowLow": 3
    },
    "late": {
      "firstMinCount": 4,
      "firstMaxCount": 6,
      "firstMaxMinutes": 90,
      "firstPenalty": 2,
      "secondMaxCount": 10,
      "secondMaxMinutes": 90,
      "secondPenalty": 4,
      "severeCountOver": 10,
      "severeMinutesOver": 90,
      "severePenalty": 10
    }
  }'::jsonb
)
on conflict (key) do nothing;

drop policy if exists "settings_select_announcement_slides" on public.app_settings;
create policy "settings_select_announcement_slides" on public.app_settings
  for select to authenticated
  using (
    key in (
      'announcement_slides',
      'attendance_break_start_messages',
      'attendance_break_end_messages',
      'attendance_kpi_settings'
    )
  );
