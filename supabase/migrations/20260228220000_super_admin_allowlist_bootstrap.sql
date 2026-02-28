-- Bootstrap super-admin after DB resets without seeding any passwords.
-- 1) Adds a super_admin allowlist table (email-based)
-- 2) Auto-elevates profiles to super_admin when email matches allowlist
-- 3) (Optional but recommended) Ensures a profile is created when auth.users is created

-- 1) Allowlist table
create table if not exists public.super_admin_allowlist (
  email text primary key,
  created_at timestamptz not null default now()
);

alter table public.super_admin_allowlist enable row level security;

-- Policies: only super_admin can manage/read.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'super_admin_allowlist'
      and policyname = 'super_admin_allowlist_read'
  ) then
    create policy super_admin_allowlist_read
    on public.super_admin_allowlist
    for select
    to authenticated
    using (public.is_super_admin());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'super_admin_allowlist'
      and policyname = 'super_admin_allowlist_write'
  ) then
    create policy super_admin_allowlist_write
    on public.super_admin_allowlist
    for all
    to authenticated
    using (public.is_super_admin())
    with check (public.is_super_admin());
  end if;
end $$;

-- 2) Trigger function: auto-elevate profile role if email is allowlisted
create or replace function public.tg_profiles_apply_super_admin_allowlist()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is not null and exists (
    select 1
    from public.super_admin_allowlist a
    where lower(a.email) = lower(new.email)
  ) then
    new.role := 'super_admin';
  end if;

  return new;
end;
$$;

-- Create trigger if missing
DO $$
begin
  if not exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where t.tgname = 'trg_profiles_apply_super_admin_allowlist'
      and n.nspname = 'public'
      and c.relname = 'profiles'
  ) then
    create trigger trg_profiles_apply_super_admin_allowlist
    before insert or update of email on public.profiles
    for each row
    execute function public.tg_profiles_apply_super_admin_allowlist();
  end if;
end $$;

-- 3) Optional: ensure profiles auto-created on auth.users insert
-- This matches the comment in src/app/api/members/create/route.ts.
DO $$
begin
  if to_regprocedure('public.handle_new_user()') is not null then
    if not exists (
      select 1
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      where t.tgname = 'trg_handle_new_user'
        and n.nspname = 'auth'
        and c.relname = 'users'
    ) then
      create trigger trg_handle_new_user
      after insert on auth.users
      for each row
      execute function public.handle_new_user();
    end if;
  end if;
end $$;
