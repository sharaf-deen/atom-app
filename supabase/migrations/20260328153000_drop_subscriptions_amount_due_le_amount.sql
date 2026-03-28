-- Allow remaining due to be higher than paid now on subscriptions.
-- In this app:
--   amount = paid now
--   amount_due = remaining due
--   total = amount + amount_due
-- So amount_due must stay >= 0, but it must NOT be constrained to be <= amount.

alter table public.subscriptions
drop constraint if exists subscriptions_amount_due_le_amount;
