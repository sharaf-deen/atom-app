-- Freeze Self-Service Lot 1B — Request lifecycle & notifications
-- Adds explicit requester-cancellation audit fields. Existing freeze rules and
-- the validated subscription_freezes engine remain unchanged.

begin;

alter table public.freeze_requests
  add column if not exists canceled_by_auth_user_id uuid null references auth.users(id) on delete set null,
  add column if not exists canceled_at timestamptz null;

create index if not exists freeze_requests_canceled_by_idx
  on public.freeze_requests(canceled_by_auth_user_id, canceled_at desc);

commit;
