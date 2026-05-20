create table if not exists public.salary_claims (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  employee_id uuid references public.employee(id) on delete set null,
  claim_month date not null,
  base_salary numeric(12,2) not null check (base_salary > 0),
  eligible_base_amount numeric(12,2) not null,
  max_claim_amount numeric(12,2) not null,
  requested_amount numeric(12,2) not null check (requested_amount > 0),
  full_name text,
  bank_name text,
  account_number text,
  branch_name text,
  branch_id bigint,
  note text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'paid')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, claim_month)
);

create index if not exists salary_claims_status_idx on public.salary_claims (status, created_at desc);
create index if not exists salary_claims_user_idx on public.salary_claims (user_id, created_at desc);

create table if not exists public.expense_claims (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  employee_id uuid references public.employee(id) on delete set null,
  full_name text,
  bank_name text,
  account_number text,
  branch_name text,
  branch_id bigint,
  total_amount numeric(12,2) not null check (total_amount > 0),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'paid')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists expense_claims_status_idx on public.expense_claims (status, created_at desc);
create index if not exists expense_claims_user_idx on public.expense_claims (user_id, created_at desc);

create table if not exists public.expense_claim_items (
  id uuid primary key default gen_random_uuid(),
  expense_claim_id uuid not null references public.expense_claims(id) on delete cascade,
  item_title text not null,
  amount numeric(12,2) not null check (amount > 0),
  note text,
  evidence_url text not null,
  evidence_name text,
  created_at timestamptz not null default now()
);

create index if not exists expense_claim_items_claim_idx on public.expense_claim_items (expense_claim_id, created_at asc);

alter table public.salary_claims enable row level security;
alter table public.expense_claims enable row level security;
alter table public.expense_claim_items enable row level security;

drop policy if exists "salary_claims_select_visible" on public.salary_claims;
create policy "salary_claims_select_visible" on public.salary_claims
  for select using (
    auth.uid() = user_id
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role = 'admin'
    )
  );

drop policy if exists "salary_claims_insert_own" on public.salary_claims;
create policy "salary_claims_insert_own" on public.salary_claims
  for insert with check (
    auth.uid() = user_id
    and extract(day from now() at time zone 'Asia/Bangkok') between 10 and 14
    and requested_amount <= max_claim_amount
  );

drop policy if exists "salary_claims_update_admin" on public.salary_claims;
create policy "salary_claims_update_admin" on public.salary_claims
  for update using (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role = 'admin'
    )
  )
  with check (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role = 'admin'
    )
  );

drop policy if exists "expense_claims_select_visible" on public.expense_claims;
create policy "expense_claims_select_visible" on public.expense_claims
  for select using (
    auth.uid() = user_id
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role = 'admin'
    )
  );

drop policy if exists "expense_claims_insert_own" on public.expense_claims;
create policy "expense_claims_insert_own" on public.expense_claims
  for insert with check (auth.uid() = user_id);

drop policy if exists "expense_claims_update_admin" on public.expense_claims;
create policy "expense_claims_update_admin" on public.expense_claims
  for update using (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role = 'admin'
    )
  )
  with check (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role = 'admin'
    )
  );

drop policy if exists "expense_claim_items_select_visible" on public.expense_claim_items;
create policy "expense_claim_items_select_visible" on public.expense_claim_items
  for select using (
    exists (
      select 1
      from public.expense_claims c
      where c.id = expense_claim_id
        and (
          c.user_id = auth.uid()
          or exists (
            select 1
            from public.profiles p
            where p.id = auth.uid()
              and p.role = 'admin'
          )
        )
    )
  );

drop policy if exists "expense_claim_items_insert_own" on public.expense_claim_items;
create policy "expense_claim_items_insert_own" on public.expense_claim_items
  for insert with check (
    exists (
      select 1
      from public.expense_claims c
      where c.id = expense_claim_id
        and c.user_id = auth.uid()
    )
  );

insert into storage.buckets (id, name, public)
values ('expense_claim_evidence', 'expense_claim_evidence', true)
on conflict (id) do nothing;

drop policy if exists "expense_claim_evidence_public_read" on storage.objects;
create policy "expense_claim_evidence_public_read" on storage.objects
  for select using (bucket_id = 'expense_claim_evidence');

drop policy if exists "expense_claim_evidence_insert_own" on storage.objects;
create policy "expense_claim_evidence_insert_own" on storage.objects
  for insert with check (
    bucket_id = 'expense_claim_evidence'
    and split_part(name, '/', 1) = auth.uid()::text
  );

drop policy if exists "expense_claim_evidence_update_own" on storage.objects;
create policy "expense_claim_evidence_update_own" on storage.objects
  for update using (
    bucket_id = 'expense_claim_evidence'
    and split_part(name, '/', 1) = auth.uid()::text
  )
  with check (
    bucket_id = 'expense_claim_evidence'
    and split_part(name, '/', 1) = auth.uid()::text
  );

drop policy if exists "expense_claim_evidence_delete_own" on storage.objects;
create policy "expense_claim_evidence_delete_own" on storage.objects
  for delete using (
    bucket_id = 'expense_claim_evidence'
    and split_part(name, '/', 1) = auth.uid()::text
  );
