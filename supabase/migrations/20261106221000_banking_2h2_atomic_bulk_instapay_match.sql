-- Banking 2H.2: atomic, conservative, audited Super Admin bulk income matching.
-- Matched pairs are re-checked from live database state at commit, not trusted from UI.
begin;

create or replace function public.bulk_match_instapay_income_v1(
  p_pairs jsonb,
  p_actor uuid,
  p_note text,
  p_verified boolean
) returns jsonb
language plpgsql security definer set search_path = ''
as $body$
declare
  v_pair jsonb;
  v_credit uuid;
  v_batch uuid;
  v_tx public.bank_transactions%rowtype;
  v_pay public.payment_validation_batches%rowtype;
  v_amount numeric;
  v_count int := 0;
  v_total numeric := 0;
  v_credit_candidates int;
  v_batch_candidates int;
  v_matched numeric;
  v_legacy int;
  v_ids uuid[] := '{}';
  v_batch_ids uuid[] := '{}';
begin
  if not public.is_super_admin(p_actor) then
    raise exception 'SUPER_ADMIN_REQUIRED';
  end if;
  if p_verified is distinct from true then
    raise exception 'EVIDENCE_CONFIRMATION_REQUIRED';
  end if;
  if p_pairs is null or jsonb_typeof(p_pairs) <> 'array'
     or jsonb_array_length(p_pairs) not between 1 and 50 then
    raise exception 'INVALID_BULK_SELECTION';
  end if;
  if length(btrim(coalesce(p_note, ''))) not between 10 and 500 then
    raise exception 'RECONCILIATION_REASON_REQUIRED';
  end if;

  -- This lock conflicts with INSERT and UPDATE on bank_payment_matches, including
  -- the existing single-match route. It protects residual balances during the
  -- recheck and insert, and serializes simultaneous bulk requests.
  lock table public.bank_payment_matches in share row exclusive mode;
  lock table public.reconciliation_bank_matches in share mode;

  for v_pair in select value from jsonb_array_elements(p_pairs) order by value->>'bank_transaction_id',value->>'batch_id'
  loop
    if jsonb_typeof(v_pair) <> 'object'
      or coalesce(v_pair->>'bank_transaction_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or coalesce(v_pair->>'batch_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then raise exception 'INVALID_PAIR'; end if;
    v_credit := (v_pair->>'bank_transaction_id')::uuid;
    v_batch := (v_pair->>'batch_id')::uuid;
    if v_credit = any(v_ids) or v_batch = any(v_batch_ids) then
      raise exception 'DUPLICATE_CREDIT_OR_BATCH';
    end if;
    v_ids := array_append(v_ids,v_credit);
    v_batch_ids := array_append(v_batch_ids,v_batch);

    select * into v_tx from public.bank_transactions where id=v_credit for update;
    select * into v_pay from public.payment_validation_batches where id=v_batch for update;
    if not found or v_tx.id is null or v_pay.id is null then
      raise exception 'MATCH_SOURCE_MISSING';
    end if;
    if v_tx.direction <> 'credit' or v_tx.currency <> 'EGP'
       or v_tx.transaction_date < date '2026-08-01'
       or v_tx.category_code <> 'membership_income'
       or v_tx.classification_status not in ('suggested','confirmed') then
      raise exception 'CREDIT_NOT_ELIGIBLE';
    end if;
    if v_pay.deleted_at is not null or v_pay.superseded_by_batch_id is not null
       or v_pay.payment_method <> 'instapay' or v_pay.validation_mode <> 'daily'
       or v_pay.business_date is null
       or abs(v_tx.transaction_date-v_pay.business_date)>1
       or v_pay.counted_amount<=0
       or v_pay.difference_amount <> 0 then
      raise exception 'BATCH_NOT_ELIGIBLE';
    end if;

    select count(*) into v_legacy from public.reconciliation_bank_matches
      where batch_id=v_batch and released_at is null;
    if v_legacy <> 0 then raise exception 'LEGACY_BATCH_MATCHED'; end if;
    select coalesce(sum(matched_amount),0) into v_matched
      from public.bank_payment_matches where bank_transaction_id=v_credit and released_at is null;
    if v_matched <> 0 then raise exception 'CREDIT_ALREADY_PARTIALLY_MATCHED'; end if;
    select coalesce(sum(matched_amount),0) into v_matched
      from public.bank_payment_matches where batch_id=v_batch and released_at is null;
    if v_matched <> 0 then raise exception 'BATCH_ALREADY_PARTIALLY_MATCHED'; end if;
    v_amount := v_tx.amount;
    if v_amount <= 0 or v_amount <> v_pay.counted_amount then
      raise exception 'AMOUNT_MISMATCH';
    end if;

    -- A unique candidate must also be unique in reverse, across *all* credits
    -- (even unclassified/internal). This prevents falsely accepting repeated
    -- amounts or ambiguous dates.
    select count(*) into v_credit_candidates
    from public.payment_validation_batches b
    where b.deleted_at is null and b.superseded_by_batch_id is null
      and b.payment_method='instapay' and b.validation_mode='daily'
      and b.business_date between v_tx.transaction_date-1 and v_tx.transaction_date+1
      and b.counted_amount=v_amount and b.difference_amount=0
      and not exists(select 1 from public.reconciliation_bank_matches l
                     where l.batch_id=b.id and l.released_at is null)
      and not exists(select 1 from public.bank_payment_matches m
                     where m.batch_id=b.id and m.released_at is null);
    select count(*) into v_batch_candidates
    from public.bank_transactions t
    where t.direction='credit' and t.currency='EGP'
      and t.transaction_date between v_pay.business_date-1 and v_pay.business_date+1
      and t.amount=v_amount
      and not exists(select 1 from public.bank_payment_matches m
                     where m.bank_transaction_id=t.id and m.released_at is null);
    if v_credit_candidates <> 1 or v_batch_candidates <> 1 then
      raise exception 'AMBIGUOUS_CANDIDATES';
    end if;

    insert into public.bank_payment_matches
      (bank_transaction_id,batch_id,matched_amount,note,matched_by)
    values (v_credit,v_batch,v_amount,'Bulk 2H.2: '||btrim(p_note),p_actor);
    v_count := v_count+1;
    v_total := v_total+v_amount;
  end loop;
  return jsonb_build_object('matched_count',v_count,'total_amount',v_total);
end
$body$;

revoke all on function public.bulk_match_instapay_income_v1(jsonb,uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.bulk_match_instapay_income_v1(jsonb,uuid,text,boolean) to service_role;
commit;
