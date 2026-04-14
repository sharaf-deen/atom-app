begin;

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
  v_payment_method text := public.normalize_payment_method(p_payment_method);
  v_validation_mode text := lower(trim(coalesce(p_validation_mode, '')));
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_line_count integer := 0;
  v_expected_amount numeric(12,2) := 0;
  v_period_from timestamptz;
  v_period_to timestamptz;
  v_first_business_date date;
  v_last_business_date date;
  v_batch_id uuid := gen_random_uuid();
begin
  if p_actor is null then
    raise exception 'Missing actor.';
  end if;

  if not public.is_payment_validation_approver(p_actor) then
    raise exception 'Only active payment approvers or super admin can validate.';
  end if;

  if v_payment_method not in ('cash', 'instapay', 'card', 'bank_transfer') then
    raise exception 'Invalid payment method.';
  end if;

  if v_validation_mode not in ('cash_period', 'daily') then
    raise exception 'Invalid validation mode.';
  end if;

  if v_payment_method = 'cash' and v_validation_mode <> 'cash_period' then
    raise exception 'Cash must use cash_period validation mode.';
  end if;

  if v_payment_method <> 'cash' and v_validation_mode <> 'daily' then
    raise exception 'Digital methods must use daily validation mode.';
  end if;

  if v_validation_mode = 'daily' and p_business_date is null then
    raise exception 'Business date is required for daily validation.';
  end if;

  if v_validation_mode = 'cash_period' and p_business_date is not null then
    raise exception 'Cash period validation does not accept a business date.';
  end if;

  if p_counted_amount is null or p_counted_amount < 0 then
    raise exception 'Counted amount must be 0 or greater.';
  end if;

  if p_expected_amount is null or p_expected_amount < 0 then
    raise exception 'Expected amount snapshot is required.';
  end if;

  if p_line_count is null or p_line_count <= 0 then
    raise exception 'Line count snapshot is required.';
  end if;

  select
    count(*)::integer,
    coalesce(sum(e.amount), 0)::numeric(12,2),
    min(e.event_at),
    max(e.event_at),
    min(e.business_date),
    max(e.business_date)
  into
    v_line_count,
    v_expected_amount,
    v_period_from,
    v_period_to,
    v_first_business_date,
    v_last_business_date
  from public.admin_income_events_open_v1 e
  where e.payment_method_norm = v_payment_method
    and (
      (v_validation_mode = 'cash_period')
      or e.business_date = p_business_date
    );

  if v_line_count <= 0 or v_period_from is null or v_period_to is null then
    raise exception 'Nothing open to validate for this scope.';
  end if;

  if p_line_count <> v_line_count
     or round(p_expected_amount::numeric, 2) <> round(v_expected_amount::numeric, 2) then
    raise exception 'Open scope changed. Refresh and try again.';
  end if;

  if round(p_counted_amount::numeric, 2) <> round(v_expected_amount::numeric, 2)
     and v_note is null then
    raise exception 'A note is required when counted amount differs from expected.';
  end if;

  insert into public.payment_validation_batches (
    id,
    payment_method,
    validation_mode,
    business_date,
    period_from,
    period_to,
    expected_amount,
    counted_amount,
    difference_amount,
    note,
    validated_by,
    validated_at,
    created_by
  )
  values (
    v_batch_id,
    v_payment_method,
    v_validation_mode,
    case when v_validation_mode = 'daily' then p_business_date else null end,
    v_period_from,
    greatest(v_period_to, v_period_from + interval '1 second'),
    v_expected_amount,
    round(p_counted_amount::numeric, 2),
    round(p_counted_amount::numeric, 2) - v_expected_amount,
    v_note,
    p_actor,
    now(),
    p_actor
  );

  begin
    insert into public.payment_validation_batch_items (
      batch_id,
      source_kind,
      source_id,
      amount_snapshot,
      business_date_snapshot,
      event_at_snapshot,
      created_by
    )
    select
      v_batch_id,
      e.source_kind,
      e.source_id,
      e.amount,
      e.business_date,
      e.event_at,
      p_actor
    from public.admin_income_events_open_v1 e
    where e.payment_method_norm = v_payment_method
      and (
        (v_validation_mode = 'cash_period')
        or e.business_date = p_business_date
      )
    order by e.event_at asc, e.source_kind asc, e.source_id asc;
  exception
    when unique_violation then
      raise exception 'Some open lines were already validated by another user. Refresh and try again.';
  end;

  return query
  select
    v_batch_id,
    v_line_count,
    v_expected_amount,
    round(p_counted_amount::numeric, 2)::numeric(12,2),
    (round(p_counted_amount::numeric, 2) - v_expected_amount)::numeric(12,2);
end;
$$;

grant execute on function public.create_payment_validation_batch_v1(text, text, date, numeric, integer, numeric, text, uuid)
  to authenticated, service_role;

commit;
