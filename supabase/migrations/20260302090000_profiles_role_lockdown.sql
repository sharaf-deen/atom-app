-- 20260302090000_profiles_role_lockdown.sql
-- Security hardening: prevent privilege escalation via profiles.role and user metadata.
-- Goals:
-- 1) Members can update ONLY their own personal fields, but cannot change: role, member_id, email, qr_code.
-- 2) If you use public.handle_new_user() (Auth trigger), ignore any user-provided role in raw_user_meta_data.
--    Optionally promote to super_admin only via allowlist table (if present).

begin;

-- 1) Harden profile self-update policy (no role/member_id/email/qr_code edits)
-- Drop existing policy if present (we recreate with stricter WITH CHECK).
drop policy if exists "profiles_update_self" on public.profiles;

create policy "profiles_update_self"
  on public.profiles
  as permissive
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()

    -- Prevent role escalation
    and role is not distinct from (
      select p2.role from public.profiles p2 where p2.user_id = auth.uid()
    )

    -- Prevent changing member_id / email / qr_code (these are system-managed)
    and member_id is not distinct from (
      select p2.member_id from public.profiles p2 where p2.user_id = auth.uid()
    )
    and email is not distinct from (
      select p2.email from public.profiles p2 where p2.user_id = auth.uid()
    )
    and qr_code is not distinct from (
      select p2.qr_code from public.profiles p2 where p2.user_id = auth.uid()
    )
  );

-- 2) OPTIONAL but recommended: make handle_new_user() ignore raw_user_meta_data.role
-- This function is only useful if you have a trigger on auth.users.
-- Safe to apply even if the trigger isn't installed.
create or replace function public.handle_new_user()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $$
declare
  new_role public.user_role := 'member';
  allowlist regclass;
begin
  -- Only allow role elevation via server-side allowlist (if the table exists)
  allowlist := to_regclass('public.super_admin_allowlist');
  if allowlist is not null then
    if exists (select 1 from public.super_admin_allowlist a where lower(a.email) = lower(new.email)) then
      new_role := 'super_admin';
    end if;
  end if;

  insert into public.profiles (user_id, email, role)
  values (new.id, new.email, new_role)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

commit;
