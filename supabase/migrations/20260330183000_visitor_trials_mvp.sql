-- Visitor Trials MVP
-- Separate free-trial visitor pipeline (no app role change).

begin;

create table if not exists public.visitor_trials (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text null,
  phone text null,
  email text null,
  source_key text not null default 'walk_in',
  status text not null default 'booked',
  trial_date date not null default ((now() at time zone 'Africa/Cairo')::date),
  trial_attended_at timestamptz null,
  free_trial_used boolean not null default false,
  follow_up_due_at timestamptz null,
  follow_up_sent_at timestamptz null,
  notes text null,
  linked_member_id uuid null references public.profiles(user_id) on delete set null,
  created_at timestamptz not null default now(),
  created_by uuid null references public.profiles(user_id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid null references public.profiles(user_id) on delete set null
);

create index if not exists visitor_trials_created_at_idx
  on public.visitor_trials (created_at desc);

create index if not exists visitor_trials_trial_date_idx
  on public.visitor_trials (trial_date desc);

create index if not exists visitor_trials_status_idx
  on public.visitor_trials (status);

create index if not exists visitor_trials_source_idx
  on public.visitor_trials (source_key);

create index if not exists visitor_trials_linked_member_idx
  on public.visitor_trials (linked_member_id);

create unique index if not exists visitor_trials_email_unique_idx
  on public.visitor_trials (lower(btrim(email)))
  where email is not null and btrim(email) <> '';

create unique index if not exists visitor_trials_name_phone_unique_idx
  on public.visitor_trials (lower(btrim(first_name)), lower(btrim(coalesce(last_name, ''))), btrim(phone))
  where phone is not null and btrim(phone) <> '';

do $$
begin
  alter table public.visitor_trials
    add constraint visitor_trials_first_name_not_blank
    check (btrim(first_name) <> '') not valid;
exception when duplicate_object then null;
end $$;
alter table public.visitor_trials validate constraint visitor_trials_first_name_not_blank;

do $$
begin
  alter table public.visitor_trials
    add constraint visitor_trials_contact_required
    check (btrim(coalesce(phone, '')) <> '' or btrim(coalesce(email, '')) <> '') not valid;
exception when duplicate_object then null;
end $$;
alter table public.visitor_trials validate constraint visitor_trials_contact_required;

do $$
begin
  alter table public.visitor_trials
    add constraint visitor_trials_source_chk
    check (source_key in ('walk_in', 'instagram', 'website', 'referral', 'whatsapp', 'other')) not valid;
exception when duplicate_object then null;
end $$;
alter table public.visitor_trials validate constraint visitor_trials_source_chk;

do $$
begin
  alter table public.visitor_trials
    add constraint visitor_trials_status_chk
    check (status in ('new', 'booked', 'attended', 'followed_up', 'closed')) not valid;
exception when duplicate_object then null;
end $$;
alter table public.visitor_trials validate constraint visitor_trials_status_chk;

do $$
begin
  alter table public.visitor_trials
    add constraint visitor_trials_follow_up_after_attendance
    check (follow_up_due_at is null or trial_attended_at is not null or free_trial_used = true) not valid;
exception when duplicate_object then null;
end $$;
alter table public.visitor_trials validate constraint visitor_trials_follow_up_after_attendance;

alter table public.visitor_trials enable row level security;

do $$
begin
  create policy "ops read visitor_trials"
    on public.visitor_trials for select
    using (
      exists (
        select 1
        from public.profiles p
        where p.user_id = auth.uid()
          and p.role in ('reception', 'admin', 'super_admin')
      )
    );
exception when duplicate_object then null;
end $$;

do $$
begin
  create policy "ops insert visitor_trials"
    on public.visitor_trials for insert
    with check (
      exists (
        select 1
        from public.profiles p
        where p.user_id = auth.uid()
          and p.role in ('reception', 'admin', 'super_admin')
      )
    );
exception when duplicate_object then null;
end $$;

do $$
begin
  create policy "ops update visitor_trials"
    on public.visitor_trials for update
    using (
      exists (
        select 1
        from public.profiles p
        where p.user_id = auth.uid()
          and p.role in ('reception', 'admin', 'super_admin')
      )
    )
    with check (
      exists (
        select 1
        from public.profiles p
        where p.user_id = auth.uid()
          and p.role in ('reception', 'admin', 'super_admin')
      )
    );
exception when duplicate_object then null;
end $$;

do $$
begin
  create policy "ops delete visitor_trials"
    on public.visitor_trials for delete
    using (
      exists (
        select 1
        from public.profiles p
        where p.user_id = auth.uid()
          and p.role in ('reception', 'admin', 'super_admin')
      )
    );
exception when duplicate_object then null;
end $$;

grant select, insert, update, delete on table public.visitor_trials to authenticated, service_role;

drop trigger if exists trg_visitor_trials_set_updated_at on public.visitor_trials;
create trigger trg_visitor_trials_set_updated_at
before update on public.visitor_trials
for each row execute function public.set_updated_at();

commit;
