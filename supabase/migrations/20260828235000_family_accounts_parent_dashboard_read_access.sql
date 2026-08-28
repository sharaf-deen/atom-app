-- Family Accounts Lot 1C — Parent Family Dashboard
-- Adds read-only guardian access to the family, linked member profiles, and
-- linked member subscriptions. Existing member/admin write flows are unchanged.

begin;

create or replace function public.is_family_guardian_of_family(p_family_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.family_guardians fg
    where fg.family_id = p_family_id
      and fg.auth_user_id = auth.uid()
  );
$$;

create or replace function public.is_family_guardian_of_member(p_member_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.family_members fm
    join public.family_guardians fg
      on fg.family_id = fm.family_id
    where fm.member_id = p_member_id
      and fg.auth_user_id = auth.uid()
  );
$$;

revoke all on function public.is_family_guardian_of_family(uuid) from public;
revoke all on function public.is_family_guardian_of_member(uuid) from public;
grant execute on function public.is_family_guardian_of_family(uuid) to authenticated, service_role;
grant execute on function public.is_family_guardian_of_member(uuid) to authenticated, service_role;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'families'
      and policyname = 'guardian read own family'
  ) then
    create policy "guardian read own family"
      on public.families
      for select
      to authenticated
      using (public.is_family_guardian_of_family(id));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'family_members'
      and policyname = 'guardian read own family members'
  ) then
    create policy "guardian read own family members"
      on public.family_members
      for select
      to authenticated
      using (public.is_family_guardian_of_family(family_id));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'profiles'
      and policyname = 'guardian read linked member profiles'
  ) then
    create policy "guardian read linked member profiles"
      on public.profiles
      for select
      to authenticated
      using (public.is_family_guardian_of_member(user_id));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'subscriptions'
      and policyname = 'guardian read linked member subscriptions'
  ) then
    create policy "guardian read linked member subscriptions"
      on public.subscriptions
      for select
      to authenticated
      using (public.is_family_guardian_of_member(member_id));
  end if;
end $$;

grant select on public.families to authenticated;
grant select on public.family_members to authenticated;
grant select on public.family_guardians to authenticated;
grant select on public.profiles to authenticated;
grant select on public.subscriptions to authenticated;

commit;
