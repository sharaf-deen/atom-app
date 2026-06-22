-- Members Inactive Lot 2 — follow-up tracking
-- Safe CRM table only. It does not modify profiles, subscriptions, access or roles.

create table if not exists public.member_inactive_followups (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles(user_id) on delete cascade,
  status text not null default 'to_contact',
  note text null,
  next_follow_up_at date null,
  reviewed_at timestamptz null,
  reviewed_by uuid null,
  updated_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint member_inactive_followups_member_unique unique (member_id),
  constraint member_inactive_followups_status_check check (
    status in (
      'to_contact',
      'contacted',
      'will_renew',
      'not_interested',
      'moved_academy',
      'created_by_mistake',
      'resolved'
    )
  )
);

create index if not exists member_inactive_followups_status_idx
  on public.member_inactive_followups(status);

create index if not exists member_inactive_followups_next_follow_up_at_idx
  on public.member_inactive_followups(next_follow_up_at);

alter table public.member_inactive_followups enable row level security;

drop policy if exists "member_inactive_followups_select_staff" on public.member_inactive_followups;
create policy "member_inactive_followups_select_staff"
  on public.member_inactive_followups
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles actor
      where actor.user_id = auth.uid()
        and actor.role in ('reception', 'admin', 'super_admin')
    )
  );

drop policy if exists "member_inactive_followups_insert_staff" on public.member_inactive_followups;
create policy "member_inactive_followups_insert_staff"
  on public.member_inactive_followups
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.profiles actor
      where actor.user_id = auth.uid()
        and actor.role in ('reception', 'admin', 'super_admin')
    )
  );

drop policy if exists "member_inactive_followups_update_staff" on public.member_inactive_followups;
create policy "member_inactive_followups_update_staff"
  on public.member_inactive_followups
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.profiles actor
      where actor.user_id = auth.uid()
        and actor.role in ('reception', 'admin', 'super_admin')
    )
  )
  with check (
    exists (
      select 1
      from public.profiles actor
      where actor.user_id = auth.uid()
        and actor.role in ('reception', 'admin', 'super_admin')
    )
  );
