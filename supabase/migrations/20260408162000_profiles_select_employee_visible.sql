drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles
  for select to authenticated using (
    id = auth.uid()
    or role = 'employee'
    or public.is_admin()
    or (
      public.is_manager()
      and branch_id is not distinct from public.my_branch_id()
      and public.my_branch_id() is not null
    )
  );

