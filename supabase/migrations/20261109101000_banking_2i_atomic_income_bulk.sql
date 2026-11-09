-- Banking 2I: atomic, human-confirmed, exact-match batch credits.
-- Broadens Banking 2H to eligible bank_transfer and card daily batches, without changing 2H.
begin;
create or replace function public.bulk_match_bank_income_v2(
  p_pairs jsonb, p_actor uuid, p_note text, p_verified boolean
) returns jsonb
language plpgsql security definer set search_path = ''
as $body$
declare
  v_pair jsonb;
  v_credit_id uuid;
  v_batch_id uuid;
  v_tx public.bank_transactions%rowtype;
  v_batch public.payment_validation_batches%rowtype;
  v_credit_matches numeric;
  v_batch_matches numeric;
  v_credit_candidates integer;
  v_batch_candidates integer;
  v_credit_ids uuid[] := '{}';
  v_batch_ids uuid[] := '{}';
  v_count integer := 0;
  v_total numeric := 0;
begin
  if not public.is_super_admin(p_actor) then raise exception 'SUPER_ADMIN_REQUIRED'; end if;
  if p_verified is distinct from true then raise exception 'EVIDENCE_CONFIRMATION_REQUIRED'; end if;
  if p_pairs is null or jsonb_typeof(p_pairs) <> 'array'
     or jsonb_array_length(p_pairs) not between 1 and 50 then
    raise exception 'INVALID_BULK_SELECTION';
  end if;
  if length(btrim(coalesce(p_note,''))) not between 10 and 480 then
    raise exception 'RECONCILIATION_REASON_REQUIRED';
  end if;

  lock table public.bank_payment_matches in share row exclusive mode;
  lock table public.reconciliation_bank_matches in share mode;

  for v_pair in select value from jsonb_array_elements(p_pairs)
    order by value->>'bank_transaction_id',value->>'batch_id'
  loop
    if jsonb_typeof(v_pair) <> 'object'
       or coalesce(v_pair->>'bank_transaction_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or coalesce(v_pair->>'batch_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then raise exception 'INVALID_PAIR'; end if;
    v_credit_id := (v_pair->>'bank_transaction_id')::uuid;
    v_batch_id := (v_pair->>'batch_id')::uuid;
    if v_credit_id = any(v_credit_ids) or v_batch_id = any(v_batch_ids) then
      raise exception 'DUPLICATE_CREDIT_OR_BATCH';
    end if;
    v_credit_ids := array_append(v_credit_ids,v_credit_id);
    v_batch_ids := array_append(v_batch_ids,v_batch_id);

    select * into v_tx from public.bank_transactions where id=v_credit_id for update;
    if not found then raise exception 'CREDIT_NOT_FOUND'; end if;
    select * into v_batch from public.payment_validation_batches where id=v_batch_id for update;
    if not found then raise exception 'BATCH_NOT_FOUND'; end if;
    if v_tx.direction <> 'credit' or v_tx.currency <> 'EGP'
       or v_tx.category_code <> 'membership_income'
       or v_tx.classification_status not in ('suggested','confirmed')
       or v_tx.transaction_date < date '2026-08-01' then
      raise exception 'CREDIT_NOT_ELIGIBLE';
    end if;
    if v_batch.deleted_at is not null or v_batch.superseded_by_batch_id is not null
       or v_batch.validation_mode <> 'daily'
       or v_batch.payment_method not in ('instapay','bank_transfer','card')
       or v_batch.business_date is null or
       abs(v_tx.transaction_date-v_batch.business_date)>7
       or v_batch.difference_amount <> 0
       or v_batch.counted_amount <= 0
       or v_tx.amount <> v_batch.counted_amount then
      raise exception 'BATCH_NOT_ELIGIBLE';
    end if;

    if exists(select 1 from public.reconciliation_bank_matches
              where batch_id=v_batch_id and released_at is null) then
      raise exception 'LEGACY_BATCH_MATCHED';
    end if;
    select coalesce(sum(matched_amount),0) into v_credit_matches
    from public.bank_payment_matches where bank_transaction_id=v_credit_id and released_at is null;
    select coalesce(sum(matched_amount),0) into v_batch_matches
    from public.bank_payment_matches where batch_id=v_batch_id and released_at is null;
    if v_credit_matches <> 0 or v_batch_matches <> 0 then
      raise exception 'ALREADY_PARTIALLY_MATCHED';
    end if;

    -- Prevent silent approval when a same-amount source or bank transaction competes.
    select count(*) into v_credit_candidates
    from public.payment_validation_batches b
    where b.deleted_at is null and b.superseded_by_batch_id is null
      and b.validation_mode='daily'
      and b.payment_method in ('instapay','bank_transfer','card')
      and b.business_date between v_tx.transaction_date-7 and v_tx.transaction_date+7
      and b.counted_amount=v_tx.amount and b.difference_amount=0
      and not exists(select 1 from public.reconciliation_bank_matches l where l.batch_id=b.id and l.released_at is null)
      and not exists(select 1 from public.bank_payment_matches m where m.batch_id=b.id and m.released_at is null);
    select count(*) into v_batch_candidates
    from public.bank_transactions t
    where t.direction='credit' and t.currency='EGP'
      and t.transaction_date between v_batch.business_date-7 and v_batch.business_date+7
      and t.amount=v_batch.counted_amount
      and not exists(select 1 from public.bank_payment_matches m where m.bank_transaction_id=t.id and m.released_at is null);
    if v_credit_candidates <> 1 or v_batch_candidates <> 1 then
      raise exception 'AMBIGUOUS_CANDIDATES';
    end if;

    insert into public.bank_payment_matches
      (bank_transaction_id,batch_id,matched_amount,note,matched_by)
    values (v_credit_id,v_batch_id,v_tx.amount,'Bulk 2I: '||btrim(p_note),p_actor);
    v_count := v_count+1;
    v_total := v_total+v_tx.amount;
  end loop;
  return jsonb_build_object('matched_count',v_count,'total_amount',v_total);
end
$body$;
revoke all on function public.bulk_match_bank_income_v2(jsonb,uuid,text,boolean)
  from public,anon,authenticated;
grant execute on function public.bulk_match_bank_income_v2(jsonb,uuid,text,boolean)
  to service_role;
commit;
