-- Extend annual leave quota to support sick/personal balances managed by admin.

alter table public.vacation_grants
  add column if not exists sick_days_granted numeric(8, 2) not null default 30 check (sick_days_granted >= 0),
  add column if not exists personal_days_granted numeric(8, 2) not null default 7 check (personal_days_granted >= 0);

comment on column public.vacation_grants.sick_days_granted is
  'Annual sick leave quota used to compute remaining days on employee profile.';

comment on column public.vacation_grants.personal_days_granted is
  'Annual personal leave quota used to compute remaining days on employee profile.';
