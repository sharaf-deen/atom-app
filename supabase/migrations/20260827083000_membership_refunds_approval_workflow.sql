-- Membership Refunds Lot 1B — refund approval workflow
-- Adds an internal approval lifecycle to exceptional membership refund records.
-- This does not modify original payments, subscriptions, member access, freezes, Cash, Store, or Payment Reconciliation.

alter table public.membership_refunds
  add column if not exists approved_by uuid null references public.profiles(user_id) on delete set null,
  add column if not exists approved_at timestamptz null,
  add column if not exists rejected_by uuid null references public.profiles(user_id) on delete set null,
  add column if not exists rejected_at timestamptz null,
  add column if not exists rejection_reason text null,
  add column if not exists paid_by uuid null references public.profiles(user_id) on delete set null,
  add column if not exists paid_at timestamptz null,
  add column if not exists cancelled_by uuid null references public.profiles(user_id) on delete set null,
  add column if not exists cancelled_at timestamptz null,
  add column if not exists cancellation_reason text null;

alter table public.membership_refunds
  drop constraint if exists membership_refunds_status_chk;

alter table public.membership_refunds
  alter column status set default 'pending_review';

alter table public.membership_refunds
  add constraint membership_refunds_status_chk
  check (status in ('pending_review','approved','paid','rejected','cancelled')) not valid;

alter table public.membership_refunds validate constraint membership_refunds_status_chk;

-- Preserve Lot 1A records while enriching the workflow timeline where possible.
update public.membership_refunds
set
  paid_at = coalesce(paid_at, refunded_at),
  paid_by = coalesce(paid_by, created_by)
where status = 'paid';

update public.membership_refunds
set
  cancelled_at = coalesce(cancelled_at, created_at),
  cancelled_by = coalesce(cancelled_by, created_by)
where status = 'cancelled';

create index if not exists membership_refunds_approved_at_idx on public.membership_refunds(approved_at desc);
create index if not exists membership_refunds_paid_at_idx on public.membership_refunds(paid_at desc);
create index if not exists membership_refunds_rejected_at_idx on public.membership_refunds(rejected_at desc);
create index if not exists membership_refunds_cancelled_at_idx on public.membership_refunds(cancelled_at desc);
