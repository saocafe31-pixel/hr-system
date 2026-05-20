drop policy if exists "profiles_select" on public.profiles;

create policy "profiles_select" on public.profiles
  for select to authenticated
  using (true);

