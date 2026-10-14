-- Functional 1B.5A: refund mutations must use authorized server routes.
-- Keep SELECT available under the existing RLS read policy.
revoke insert, update on public.membership_refunds from authenticated;
