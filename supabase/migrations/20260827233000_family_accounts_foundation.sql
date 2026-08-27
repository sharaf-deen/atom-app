-- Family Accounts Lot 1A — family foundation & existing member linking
-- Adds a lightweight family grouping layer above existing member profiles.
-- This does not change Auth accounts, member IDs, memberships, payments, freezes,
-- QR codes, Store, Cash, Payment Reconciliation, or any member access logic.

create table if not exists public.families (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid null references public.profiles(user_id) on delete set null,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'families_name_required'
  ) then
    alter table public.families
      add constraint families_name_required
      check (length(btrim(name)) between 2 and 120) not valid;
  end if;
end $$;
alter table public.families validate constraint families_name_required;

create table if not exists public.family_members (
  member_id uuid primary key references public.profiles(user_id) on delete cascade,
  family_id uuid not null references public.families(id) on delete cascade,
  added_by uuid null references public.profiles(user_id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists family_members_family_id_idx
  on public.family_members(family_id);

alter table public.families enable row level security;
alter table public.family_members enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'families'
      and policyname = 'admin read families'
  ) then
    create policy "admin read families"
      on public.families
      for select
      using (
        exists (
          select 1 from public.profiles p
          where p.user_id = auth.uid()
            and p.role in ('admin', 'super_admin')
        )
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'families'
      and policyname = 'admin create families'
  ) then
    create policy "admin create families"
      on public.families
      for insert
      with check (
        exists (
          select 1 from public.profiles p
          where p.user_id = auth.uid()
            and p.role in ('admin', 'super_admin')
        )
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'family_members'
      and policyname = 'admin read family_members'
  ) then
    create policy "admin read family_members"
      on public.family_members
      for select
      using (
        exists (
          select 1 from public.profiles p
          where p.user_id = auth.uid()
            and p.role in ('admin', 'super_admin')
        )
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'family_members'
      and policyname = 'admin link family_members'
  ) then
    create policy "admin link family_members"
      on public.family_members
      for insert
      with check (
        exists (
          select 1 from public.profiles p
          where p.user_id = auth.uid()
            and p.role in ('admin', 'super_admin')
        )
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'family_members'
      and policyname = 'admin unlink family_members'
  ) then
    create policy "admin unlink family_members"
      on public.family_members
      for delete
      using (
        exists (
          select 1 from public.profiles p
          where p.user_id = auth.uid()
            and p.role in ('admin', 'super_admin')
        )
      );
  end if;
end $$;

grant select, insert on public.families to authenticated;
grant select, insert, delete on public.family_members to authenticated;
