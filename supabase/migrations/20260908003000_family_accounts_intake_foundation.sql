-- Family Accounts 2A — Family Intake Foundation
-- Safe front-desk onboarding for guardian + multiple children without requiring
-- an immediate Family Account for trial-only households.
-- Visitor -> Family Member conversion is intentionally left for Lot 2B.

begin;

create table if not exists public.family_intakes (
  id uuid primary key default gen_random_uuid(),
  guardian_first_name text not null,
  guardian_last_name text null,
  guardian_phone text null,
  guardian_email text null,
  guardian_relationship text not null default 'parent',
  guardian_auth_user_id uuid null references auth.users(id) on delete set null,
  family_id uuid null references public.families(id) on delete set null,
  status text not null default 'open',
  created_by uuid null references public.profiles(user_id) on delete set null,
  updated_by uuid null references public.profiles(user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.family_intake_children (
  id uuid primary key default gen_random_uuid(),
  intake_id uuid not null references public.family_intakes(id) on delete cascade,
  child_kind text not null,
  first_name text null,
  last_name text null,
  date_of_birth date null,
  phone text null,
  visitor_trial_id uuid null references public.visitor_trials(id) on delete set null,
  member_id uuid null references public.profiles(user_id) on delete set null,
  created_by uuid null references public.profiles(user_id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.visitor_trials
  add column if not exists date_of_birth date null;

alter table public.visitor_trials
  add column if not exists family_intake_id uuid null references public.family_intakes(id) on delete set null;

create index if not exists family_intakes_created_at_idx
  on public.family_intakes(created_at desc);

create index if not exists family_intakes_guardian_email_idx
  on public.family_intakes(lower(btrim(guardian_email)))
  where guardian_email is not null and btrim(guardian_email) <> '';

create index if not exists family_intakes_guardian_phone_idx
  on public.family_intakes(guardian_phone)
  where guardian_phone is not null and btrim(guardian_phone) <> '';

create index if not exists family_intakes_family_id_idx
  on public.family_intakes(family_id)
  where family_id is not null;

create index if not exists family_intake_children_intake_idx
  on public.family_intake_children(intake_id);

create unique index if not exists family_intake_children_visitor_unique_idx
  on public.family_intake_children(visitor_trial_id)
  where visitor_trial_id is not null;

create unique index if not exists family_intake_children_member_unique_idx
  on public.family_intake_children(member_id)
  where member_id is not null;

create index if not exists visitor_trials_family_intake_idx
  on public.visitor_trials(family_intake_id)
  where family_intake_id is not null;

do $$
begin
  alter table public.family_intakes
    add constraint family_intakes_guardian_name_required
    check (length(btrim(guardian_first_name)) between 1 and 120) not valid;
exception when duplicate_object then null;
end $$;
alter table public.family_intakes validate constraint family_intakes_guardian_name_required;

do $$
begin
  alter table public.family_intakes
    add constraint family_intakes_guardian_contact_required
    check (
      btrim(coalesce(guardian_phone, '')) <> ''
      or btrim(coalesce(guardian_email, '')) <> ''
    ) not valid;
exception when duplicate_object then null;
end $$;
alter table public.family_intakes validate constraint family_intakes_guardian_contact_required;

do $$
begin
  alter table public.family_intakes
    add constraint family_intakes_relationship_chk
    check (guardian_relationship in ('father', 'mother', 'parent', 'guardian', 'other')) not valid;
exception when duplicate_object then null;
end $$;
alter table public.family_intakes validate constraint family_intakes_relationship_chk;

do $$
begin
  alter table public.family_intakes
    add constraint family_intakes_status_chk
    check (status in ('open', 'family_created', 'completed', 'needs_review', 'closed')) not valid;
exception when duplicate_object then null;
end $$;
alter table public.family_intakes validate constraint family_intakes_status_chk;

do $$
begin
  alter table public.family_intake_children
    add constraint family_intake_children_kind_chk
    check (child_kind in ('visitor', 'member', 'existing_visitor', 'existing_member')) not valid;
exception when duplicate_object then null;
end $$;
alter table public.family_intake_children validate constraint family_intake_children_kind_chk;

do $$
begin
  alter table public.family_intake_children
    add constraint family_intake_children_target_chk
    check (
      (child_kind in ('visitor', 'existing_visitor') and visitor_trial_id is not null and member_id is null)
      or
      (child_kind in ('member', 'existing_member') and member_id is not null and visitor_trial_id is null)
    ) not valid;
exception when duplicate_object then null;
end $$;
alter table public.family_intake_children validate constraint family_intake_children_target_chk;

-- A family-intake visitor may rely on the guardian contact stored in family_intakes,
-- so the visitor row itself no longer needs an email/phone in that case.
alter table public.visitor_trials
  drop constraint if exists visitor_trials_contact_required;

alter table public.visitor_trials
  add constraint visitor_trials_contact_required
  check (
    btrim(coalesce(phone, '')) <> ''
    or btrim(coalesce(email, '')) <> ''
    or family_intake_id is not null
  ) not valid;
alter table public.visitor_trials validate constraint visitor_trials_contact_required;

alter table public.family_intakes enable row level security;
alter table public.family_intake_children enable row level security;

do $$
begin
  create policy "front desk read family_intakes"
    on public.family_intakes for select
    using (
      exists (
        select 1 from public.profiles p
        where p.user_id = auth.uid()
          and p.role in ('reception', 'admin', 'super_admin')
      )
    );
exception when duplicate_object then null;
end $$;

do $$
begin
  create policy "front desk insert family_intakes"
    on public.family_intakes for insert
    with check (
      exists (
        select 1 from public.profiles p
        where p.user_id = auth.uid()
          and p.role in ('reception', 'admin', 'super_admin')
      )
    );
exception when duplicate_object then null;
end $$;

do $$
begin
  create policy "front desk update family_intakes"
    on public.family_intakes for update
    using (
      exists (
        select 1 from public.profiles p
        where p.user_id = auth.uid()
          and p.role in ('reception', 'admin', 'super_admin')
      )
    )
    with check (
      exists (
        select 1 from public.profiles p
        where p.user_id = auth.uid()
          and p.role in ('reception', 'admin', 'super_admin')
      )
    );
exception when duplicate_object then null;
end $$;

do $$
begin
  create policy "front desk read family_intake_children"
    on public.family_intake_children for select
    using (
      exists (
        select 1 from public.profiles p
        where p.user_id = auth.uid()
          and p.role in ('reception', 'admin', 'super_admin')
      )
    );
exception when duplicate_object then null;
end $$;

do $$
begin
  create policy "front desk insert family_intake_children"
    on public.family_intake_children for insert
    with check (
      exists (
        select 1 from public.profiles p
        where p.user_id = auth.uid()
          and p.role in ('reception', 'admin', 'super_admin')
      )
    );
exception when duplicate_object then null;
end $$;

grant select, insert, update on public.family_intakes to authenticated;
grant select, insert on public.family_intake_children to authenticated;
grant all on public.family_intakes to service_role;
grant all on public.family_intake_children to service_role;

drop trigger if exists trg_family_intakes_set_updated_at on public.family_intakes;
create trigger trg_family_intakes_set_updated_at
before update on public.family_intakes
for each row execute function public.set_updated_at();

commit;
