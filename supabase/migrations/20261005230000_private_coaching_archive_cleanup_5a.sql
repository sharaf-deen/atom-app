begin;

alter table public.private_coaching_requests
  add column if not exists archived_at timestamptz null,
  add column if not exists archived_by uuid null references public.profiles(user_id) on delete set null,
  add column if not exists archive_reason text null;

alter table public.private_coaching_bookings
  add column if not exists archived_at timestamptz null,
  add column if not exists archived_by uuid null references public.profiles(user_id) on delete set null,
  add column if not exists archive_reason text null;

alter table public.private_coaching_requests
  drop constraint if exists private_coaching_requests_archive_state_check;
alter table public.private_coaching_requests
  add constraint private_coaching_requests_archive_state_check
  check ((archived_at is null and archived_by is null) or (archived_at is not null and archived_by is not null));

alter table public.private_coaching_bookings
  drop constraint if exists private_coaching_bookings_archive_state_check;
alter table public.private_coaching_bookings
  add constraint private_coaching_bookings_archive_state_check
  check ((archived_at is null and archived_by is null) or (archived_at is not null and archived_by is not null));

create index if not exists idx_private_coaching_requests_coach_archived_created_at
  on public.private_coaching_requests(coach_id, archived_at, created_at desc);

create index if not exists idx_private_coaching_bookings_coach_archived_slot_date
  on public.private_coaching_bookings(coach_id, archived_at, slot_date desc);

commit;
