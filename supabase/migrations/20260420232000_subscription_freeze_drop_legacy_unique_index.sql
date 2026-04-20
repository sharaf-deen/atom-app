-- Freeze backdated create follow-up.
-- Ensure no environment still enforces the legacy one-row-per-subscription rule.
-- Safe to run even if the legacy index was already removed.

drop index if exists public.uq_subscription_freezes_one_active_per_subscription;

create index if not exists idx_subscription_freezes_active_ranges
  on public.subscription_freezes(subscription_id, freeze_from, freeze_until)
  where cleared_at is null;
