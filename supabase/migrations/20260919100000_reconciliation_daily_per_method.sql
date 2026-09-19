-- Reconciliation: one open scope per Cairo business date and payment method.
-- Older payments remain historical, treated as already closed before 01 Aug 2026.
begin;

create or replace view public.payment_validation_open_groups_v1 as
select
  e.payment_method_norm as payment_method,
  'daily'::text as validation_mode,
  e.business_date,
  min(e.event_at) as period_from,
  max(e.event_at) as period_to,
  e.business_date as first_business_date,
  e.business_date as last_business_date,
  count(*)::integer as line_count,
  coalesce(sum(e.amount), 0)::numeric(12,2) as expected_amount
from public.admin_income_events_open_v1 e
where e.business_date >= date '2026-08-01'
  and e.payment_method_norm in ('cash', 'instapay', 'card', 'bank_transfer')
group by e.payment_method_norm, e.business_date;

create or replace function public.create_payment_validation_batch_v1(
  p_payment_method text,
  p_validation_mode text,
  p_business_date date default null,
  p_expected_amount numeric default null,
  p_line_count integer default null,
  p_counted_amount numeric default null,
  p_note text default null,
  p_actor uuid default auth.uid()
)
returns table (
  batch_id uuid,
  line_count integer,
  expected_amount numeric,
  counted_amount numeric,
  difference_amount numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_method text := public.normalize_payment_method(p_payment_method);
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_count integer;
  v_inserted integer;
  v_expected numeric(12,2);
  v_from timestamptz;
  v_to timestamptz;
  v_id uuid := gen_random_uuid();
begin
  if p_actor is null or not public.is_super_admin(p_actor) then
    raise exception 'Only Super Admin can validate payments.';
  end if;
  if v_method not in ('cash', 'instapay', 'card', 'bank_transfer')
     or p_validation_mode is distinct from 'daily'
     or p_business_date is null or p_business_date < date '2026-08-01' then
    raise exception 'Select one payment method and one Cairo business day from 01/08/2026.';
  end if;
  if p_counted_amount is null or p_counted_amount < 0 or round(p_counted_amount, 2) <> p_counted_amount
     or p_expected_amount is null or p_expected_amount < 0
     or p_line_count is null or p_line_count < 1 then
    raise exception 'Invalid amount or line count.';
  end if;

  -- Serialize validations for the same day/method; the unique active item
  -- index remains the final defense against concurrent double validation.
  perform pg_advisory_xact_lock(hashtextextended(v_method || ':' || p_business_date::text, 0));
  select count(*)::integer, coalesce(sum(e.amount), 0)::numeric(12,2),
         min(e.event_at), max(e.event_at)
    into v_count, v_expected, v_from, v_to
  from public.admin_income_events_open_v1 e
  where e.payment_method_norm = v_method and e.business_date = p_business_date;

  if v_count = 0 then raise exception 'Nothing open to validate for this day and method.'; end if;
  if v_count <> p_line_count or v_expected <> round(p_expected_amount, 2) then
    raise exception 'Open scope changed. Refresh and try again.';
  end if;
  if round(p_counted_amount, 2) <> v_expected and v_note is null then
    raise exception 'A note is required when counted amount differs from expected.';
  end if;

  insert into public.payment_validation_batches
    (id, payment_method, validation_mode, business_date, period_from, period_to,
     expected_amount, counted_amount, difference_amount, note, validated_by, created_by)
  values
    (v_id, v_method, 'daily', p_business_date, v_from,
     greatest(v_to, v_from + interval '1 second'), v_expected,
     p_counted_amount, p_counted_amount - v_expected, v_note, p_actor, p_actor);

  begin
    insert into public.payment_validation_batch_items
      (batch_id, source_kind, source_id, amount_snapshot, business_date_snapshot,
       event_at_snapshot, created_by)
    select v_id, e.source_kind, e.source_id, e.amount, e.business_date,
           e.event_at, p_actor
    from public.admin_income_events_open_v1 e
    where e.payment_method_norm = v_method and e.business_date = p_business_date
    order by e.event_at, e.source_kind, e.source_id;
  exception when unique_violation then
    raise exception 'An entry was already validated. Refresh and try again.';
  end;
  get diagnostics v_inserted = row_count;
  if v_inserted <> v_count or
     (select coalesce(sum(i.amount_snapshot), 0) from public.payment_validation_batch_items i
      where i.batch_id = v_id) <> v_expected then
    raise exception 'Open scope changed. Refresh and try again.';
  end if;

  return query select v_id, v_count, v_expected, p_counted_amount, p_counted_amount - v_expected;
end;
$$;

-- All reconciliation RPC calls use a session-checked server action and service role.
revoke execute on function public.create_payment_validation_batch_v1(text, text, date, numeric, integer, numeric, text, uuid)
  from public, anon, authenticated;
revoke execute on function public.update_payment_validation_batch_v1(uuid, numeric, text, uuid)
  from public, anon, authenticated;
revoke execute on function public.delete_payment_validation_batch_v1(uuid, uuid)
  from public, anon, authenticated;

commit;
