-- Membership Refunds Lot 1D — refund proof file upload
-- Adds a private Storage bucket for refund proof uploads.
-- This does not modify payments, subscriptions, member access, freezes, Cash, Store, or Payment Reconciliation.

insert into storage.buckets (id, name, public)
values ('membership-refund-proofs', 'membership-refund-proofs', false)
on conflict (id) do nothing;
