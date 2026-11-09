-- Banking 2J: explicit, independently evidenced InstaPay bulk pairing.
-- Does not change payment ledger, categorization, CIB card settlements or payroll.
begin;
create or replace function public.bulk_match_bank_instapay_verified_v1(
 p_pairs jsonb, p_actor uuid, p_note text, p_verified boolean
) returns jsonb
language plpgsql security definer set search_path = ''
as $body$
declare
 v_pair jsonb; v_credit_id uuid; v_batch_id uuid;
 v_tx public.bank_transactions%rowtype; v_batch public.payment_validation_batches%rowtype;
 v_evidence text; v_credit_ids uuid[] := '{}'; v_batch_ids uuid[] := '{}';
 v_count integer := 0; v_total numeric := 0;
begin
 if not public.is_super_admin(p_actor) then raise exception 'SUPER_ADMIN_REQUIRED'; end if;
 if p_verified is distinct from true then raise exception 'EVIDENCE_CONFIRMATION_REQUIRED'; end if;
 if p_pairs is null or jsonb_typeof(p_pairs) <> 'array' or jsonb_array_length(p_pairs) not between 1 and 50
 then raise exception 'INVALID_BULK_SELECTION'; end if;
 if length(btrim(coalesce(p_note,''))) not between 10 and 480 then raise exception 'RECONCILIATION_REASON_REQUIRED'; end if;
 -- Serialize against concurrent match/release workflows before row-level validation.
 lock table public.bank_payment_matches in share row exclusive mode;
 lock table public.reconciliation_bank_matches in share mode;
 for v_pair in select value from jsonb_array_elements(p_pairs)
 order by value->>'bank_transaction_id', value->>'batch_id'
 loop
  if jsonb_typeof(v_pair) <> 'object'
    or coalesce(v_pair->>'bank_transaction_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or coalesce(v_pair->>'batch_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  then raise exception 'INVALID_PAIR'; end if;
  v_credit_id := (v_pair->>'bank_transaction_id')::uuid;
  v_batch_id := (v_pair->>'batch_id')::uuid;
  v_evidence := btrim(coalesce(v_pair->>'evidence',''));
  if length(v_evidence) not between 15 and 480 then raise exception 'PAIR_EVIDENCE_REQUIRED'; end if;
  if v_credit_id=any(v_credit_ids) or v_batch_id=any(v_batch_ids) then raise exception 'DUPLICATE_CREDIT_OR_BATCH'; end if;
  v_credit_ids := array_append(v_credit_ids,v_credit_id);
  v_batch_ids := array_append(v_batch_ids,v_batch_id);
  select * into v_tx from public.bank_transactions where id=v_credit_id for update;
  if not found then raise exception 'CREDIT_NOT_FOUND'; end if;
  select * into v_batch from public.payment_validation_batches where id=v_batch_id for update;
  if not found then raise exception 'BATCH_NOT_FOUND'; end if;
  if v_tx.direction <> 'credit' or v_tx.currency <> 'EGP'
    or v_tx.transaction_date < date '2026-08-01'
    or coalesce(v_tx.description,'') not ilike 'IPN Inward%'
    or coalesce(v_tx.category_code,'membership_income') <> 'membership_income'
    or v_tx.classification_status not in ('unclassified','suggested','confirmed')
  then raise exception 'CREDIT_NOT_ELIGIBLE'; end if;
  if v_batch.deleted_at is not null or v_batch.superseded_by_batch_id is not null
    or v_batch.validation_mode <> 'daily' or v_batch.payment_method <> 'instapay'
    or v_batch.business_date is null or abs(v_tx.transaction_date-v_batch.business_date)>3
    or v_batch.difference_amount<>0 or v_batch.counted_amount<=0
    or v_tx.amount<>v_batch.counted_amount
  then raise exception 'BATCH_NOT_ELIGIBLE'; end if;
  if exists(select 1 from public.reconciliation_bank_matches l where l.batch_id=v_batch_id and l.released_at is null)
  then raise exception 'LEGACY_BATCH_MATCHED'; end if;
  if exists(select 1 from public.bank_payment_matches m where m.released_at is null
   and (m.bank_transaction_id=v_credit_id or m.batch_id=v_batch_id))
  then raise exception 'ALREADY_MATCHED'; end if;
  -- This route intentionally accepts ambiguity only after explicit mapping and
  -- independently entered pair-specific evidence: never auto-pick the candidate.
  insert into public.bank_payment_matches
   (bank_transaction_id,batch_id,matched_amount,note,matched_by)
  values (v_credit_id,v_batch_id,v_tx.amount,
    'Bulk 2J | '||btrim(p_note)||' | bank ref '||coalesce(v_tx.reference,'n/a')||' | pair evidence: '||v_evidence,
    p_actor);
  v_count:=v_count+1; v_total:=v_total+v_tx.amount;
 end loop;
 return jsonb_build_object('matched_count',v_count,'total_amount',v_total);
end
$body$;
revoke all on function public.bulk_match_bank_instapay_verified_v1(jsonb,uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.bulk_match_bank_instapay_verified_v1(jsonb,uuid,text,boolean) to service_role;
commit;
