-- Membership Plans Lot 1A — replace new session memberships with 1 Week membership.
-- Legacy session subscriptions remain valid and consumable; this migration only
-- removes them from active pricing and adds the new 7-calendar-day time plan.

begin;

-- Allow the new subscription plan while preserving legacy session rows.
alter table public.subscriptions
  drop constraint if exists subscriptions_plan_check;

alter table public.subscriptions
  add constraint subscriptions_plan_check
  check (plan = any (array['1w'::text, '1m'::text, '3m'::text, '6m'::text, '12m'::text, 'sessions'::text]));

-- A 1 Week membership covers seven calendar dates, inclusive of start/end.
alter table public.subscriptions
  drop constraint if exists subscriptions_1w_duration_check;

alter table public.subscriptions
  add constraint subscriptions_1w_duration_check
  check (
    plan <> '1w'::text
    or (
      subscription_type = 'time'::text
      and end_date = (start_date + 6)
      and sessions_total is null
    )
  );

-- Packages & Promos can represent weekly membership pricing.
alter table public.packages_pricing
  drop constraint if exists packages_pricing_unit_check;

alter table public.packages_pricing
  add constraint packages_pricing_unit_check
  check (unit = any (array['week'::text, 'month'::text, 'session'::text]));

-- Legacy membership session packages stay in the table for admin/history context,
-- but they are no longer active offers. Private coaching session packages are untouched.
update public.packages_pricing
set
  is_active = false,
  updated_at = now()
where type = 'membership'
  and unit = 'session'
  and is_active = true;

-- Prevent membership-by-session offers from being reactivated accidentally.
alter table public.packages_pricing
  drop constraint if exists packages_pricing_no_active_membership_session_check;

alter table public.packages_pricing
  add constraint packages_pricing_no_active_membership_session_check
  check (not (type = 'membership'::text and unit = 'session'::text and is_active));

-- Keep a single canonical 1 Week price row and make it the active offer.
update public.packages_pricing
set
  name = '1 Week',
  price_egp = 1000,
  is_active = true,
  updated_at = now()
where type = 'membership'
  and unit = 'week'
  and qty = 1;

insert into public.packages_pricing (
  name,
  type,
  unit,
  qty,
  price_egp,
  is_active,
  sort_order,
  benefits
)
select
  '1 Week',
  'membership',
  'week',
  1,
  1000,
  true,
  0,
  array['7 consecutive calendar days', 'Freeze not available']::text[]
where not exists (
  select 1
  from public.packages_pricing
  where type = 'membership'
    and unit = 'week'
    and qty = 1
);

commit;
