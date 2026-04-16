-- Freeze edit/delete support.
-- Allow multiple historical freeze rows per subscription while keeping fast lookups
-- for non-cleared rows used by the freeze manager.

drop index if exists public.uq_subscription_freezes_one_active_per_subscription;

create index if not exists idx_subscription_freezes_active_ranges
  on public.subscription_freezes(subscription_id, freeze_from, freeze_until)
  where cleared_at is null;
