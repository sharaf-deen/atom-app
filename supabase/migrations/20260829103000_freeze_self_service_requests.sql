-- Freeze Self-Service Lot 1A — Member & Parent Freeze Requests
-- Reuses the existing freeze_requests approval record and the validated
-- subscription_freezes engine. Requests never change a subscription directly.

begin;

alter table public.freeze_requests
  add column if not exists subscription_id uuid null references public.subscriptions(id) on delete set null,
  add column if not exists requested_end_date date null,
  add column if not exists requested_by_auth_user_id uuid null references auth.users(id) on delete set null,
  add column if not exists request_source text null;

-- Retroactive freeze requests are intentionally allowed when they stay inside
-- the subscription coverage. The API enforces the validated coverage rules.
alter table public.freeze_requests
  drop constraint if exists freeze_date_not_past;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'freeze_requests_date_range_check') then
    alter table public.freeze_requests
      add constraint freeze_requests_date_range_check
      check (requested_end_date is null or requested_end_date >= requested_start_date) not valid;
  end if;
end $$;
alter table public.freeze_requests validate constraint freeze_requests_date_range_check;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'freeze_requests_source_check') then
    alter table public.freeze_requests
      add constraint freeze_requests_source_check
      check (request_source is null or request_source in ('self', 'guardian')) not valid;
  end if;
end $$;
alter table public.freeze_requests validate constraint freeze_requests_source_check;

create index if not exists freeze_requests_subscription_created_idx
  on public.freeze_requests(subscription_id, created_at desc);

create index if not exists freeze_requests_requested_by_idx
  on public.freeze_requests(requested_by_auth_user_id, created_at desc);

-- All new self-service writes pass through the server route where member,
-- guardian, age, token, coverage, duration and overlap rules are checked.
-- Remove the legacy direct-client insert path so those guards cannot be bypassed.
drop policy if exists "members insert own freeze request" on public.freeze_requests;

commit;
