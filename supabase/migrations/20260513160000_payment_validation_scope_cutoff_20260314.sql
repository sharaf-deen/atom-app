-- Payments Reconciliation cutoff
-- Business rule: ignore every open reconciliation source before 2026-03-14,
-- regardless of payment method. This keeps historical source records untouched
-- but prevents old unreconciled entries from appearing in open scopes or being validated.

begin;

create or replace view public.admin_income_events_open_v1 as
 select e.*
 from public.admin_income_events_v1 e
 where e.business_date >= date '2026-03-14'
 and not exists (
  select 1
  from public.payment_validation_batch_items i
  join public.payment_validation_batches b
  on b.id = i.batch_id
  where i.released_at is null
  and b.deleted_at is null
  and i.source_kind = e.source_kind
  and i.source_id = e.source_id
 );

grant select on public.admin_income_events_open_v1 to service_role;

commit;
