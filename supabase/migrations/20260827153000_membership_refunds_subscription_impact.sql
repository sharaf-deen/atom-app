-- Membership Refunds Lot 1C — subscription impact action
-- Adds explicit, auditable subscription impact decisions after a paid exceptional refund.
-- Original payments and refund records are preserved. No bank transfer, Cash, Store, freeze, or Payment Reconciliation data is modified.

alter table public.membership_refunds
  add column if not exists subscription_impact_action text not null default 'none',
  add column if not exists subscription_impact_status text not null default 'not_applied',
  add column if not exists subscription_impact_applied_by uuid null references public.profiles(user_id) on delete set null,
  add column if not exists subscription_impact_applied_at timestamptz null,
  add column if not exists subscription_impact_reason text null,
  add column if not exists subscription_impact_original_status text null,
  add column if not exists subscription_impact_original_end_date date null,
  add column if not exists subscription_impact_new_status text null,
  add column if not exists subscription_impact_new_end_date date null;

alter table public.membership_refunds
  drop constraint if exists membership_refunds_subscription_impact_action_chk;

alter table public.membership_refunds
  add constraint membership_refunds_subscription_impact_action_chk
  check (subscription_impact_action in ('none','keep_active','cancel_subscription','shorten_subscription')) not valid;

alter table public.membership_refunds validate constraint membership_refunds_subscription_impact_action_chk;

alter table public.membership_refunds
  drop constraint if exists membership_refunds_subscription_impact_status_chk;

alter table public.membership_refunds
  add constraint membership_refunds_subscription_impact_status_chk
  check (subscription_impact_status in ('not_applied','applied','skipped')) not valid;

alter table public.membership_refunds validate constraint membership_refunds_subscription_impact_status_chk;

alter table public.membership_refunds
  drop constraint if exists membership_refunds_subscription_impact_reason_required;

alter table public.membership_refunds
  add constraint membership_refunds_subscription_impact_reason_required
  check (
    subscription_impact_status <> 'applied'
    or subscription_impact_action = 'none'
    or length(btrim(coalesce(subscription_impact_reason, ''))) >= 3
  ) not valid;

alter table public.membership_refunds validate constraint membership_refunds_subscription_impact_reason_required;

create index if not exists membership_refunds_subscription_impact_status_idx on public.membership_refunds(subscription_impact_status);
create index if not exists membership_refunds_subscription_impact_action_idx on public.membership_refunds(subscription_impact_action);
create index if not exists membership_refunds_subscription_impact_applied_at_idx on public.membership_refunds(subscription_impact_applied_at desc);
