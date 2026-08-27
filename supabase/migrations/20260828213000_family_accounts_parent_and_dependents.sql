-- Family Accounts Lot 1B — parent account + multi-member registration
-- Adds one parent/guardian Auth account per family and allows dependent member
-- profiles to exist without their own Auth account/email.
-- Existing members/Auth accounts remain untouched.

begin;

create table if not exists public.family_guardians (
  family_id uuid not null references public.families(id) on delete cascade,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  first_name text null,
  last_name text null,
  phone text null,
  relationship text not null default 'parent',
  is_primary boolean not null default true,
  invited_at timestamptz null,
  created_by uuid null references public.profiles(user_id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (family_id, auth_user_id)
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'family_guardians_email_required'
  ) then
    alter table public.family_guardians
      add constraint family_guardians_email_required
      check (length(btrim(email)) between 3 and 320) not valid;
  end if;
end $$;
alter table public.family_guardians validate constraint family_guardians_email_required;

create index if not exists family_guardians_auth_user_id_idx
  on public.family_guardians(auth_user_id);

create unique index if not exists family_guardians_one_primary_per_family_idx
  on public.family_guardians(family_id)
  where is_primary = true;

alter table public.family_guardians enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'family_guardians'
      and policyname = 'guardian read own family link'
  ) then
    create policy "guardian read own family link"
      on public.family_guardians
      for select
      using (
        auth_user_id = auth.uid()
        or exists (
          select 1 from public.profiles p
          where p.user_id = auth.uid()
            and p.role in ('admin', 'super_admin')
        )
      );
  end if;
end $$;

grant select on public.family_guardians to authenticated;
grant all on public.family_guardians to service_role;

-- Parent accounts are real Supabase Auth users, but they are not ATOM members.
-- Skip the automatic public.profiles row for family-parent invitations while
-- preserving the existing super-admin allowlist behavior for every other user.
create or replace function public.handle_new_user()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $$
declare
  new_role public.user_role := 'member';
  allowlist regclass;
  account_type text := lower(coalesce(new.raw_user_meta_data->>'account_type', ''));
begin
  if account_type in ('family_parent', 'family_guardian') then
    return new;
  end if;

  allowlist := to_regclass('public.super_admin_allowlist');
  if allowlist is not null then
    if exists (
      select 1
      from public.super_admin_allowlist a
      where lower(a.email) = lower(new.email)
    ) then
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
