begin;

create or replace view public.payment_validation_open_groups_v1 as
with open_events as (
  select *
  from public.admin_income_events_open_v1
)
select
  'cash'::text as payment_method,
  'cash_period'::text as validation_mode,
  null::date as business_date,
  min(open_events.event_at) as period_from,
  max(open_events.event_at) as period_to,
  min(open_events.business_date) as first_business_date,
  max(open_events.business_date) as last_business_date,
  count(*)::integer as line_count,
  coalesce(sum(open_events.amount), 0)::numeric(12,2) as expected_amount
from open_events
where open_events.payment_method_norm = 'cash'
having count(*) > 0

union all

select
  open_events.payment_method_norm as payment_method,
  'daily'::text as validation_mode,
  open_events.business_date,
  min(open_events.event_at) as period_from,
  max(open_events.event_at) as period_to,
  open_events.business_date as first_business_date,
  open_events.business_date as last_business_date,
  count(*)::integer as line_count,
  coalesce(sum(open_events.amount), 0)::numeric(12,2) as expected_amount
from open_events
where open_events.payment_method_norm in ('instapay', 'card', 'bank_transfer')
group by open_events.payment_method_norm, open_events.business_date;

grant select on public.payment_validation_open_groups_v1 to service_role;

commit;
