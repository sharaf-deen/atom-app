-- Reconciliation 1A — Reliable Baseline from 01 Aug 2026
-- Business rule:
--   * Keep all historical payment/income source records untouched.
--   * Keep all previously created reconciliation batches untouched.
--   * Only income events with a Cairo business date on/after 2026-08-01
--     may appear in OPEN reconciliation scopes.
-- This replaces the previous 2026-03-14 open-scope cutoff.

begin;

create or replace view public.admin_income_events_open_v1 as
select e.*
from public.admin_income_events_v1 e
where e.business_date >= date '2026-08-01'
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

comment on view public.admin_income_events_open_v1 is
  'Open reconciliation income events. Reliable operational baseline starts on 2026-08-01; older source records remain historical and are excluded only from open reconciliation scopes.';

grant select on public.admin_income_events_open_v1 to service_role;

commit;
