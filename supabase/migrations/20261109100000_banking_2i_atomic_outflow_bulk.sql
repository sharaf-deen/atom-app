-- Banking 2I: Super Admin reviewed atomic bulk matching of bank debits.
-- Does not create expenses, payment records, refund records or salary records.
begin;

create or replace function public.bulk_match_bank_outflows_v1(
  p_pairs jsonb,
  p_actor uuid,
  p_note text,
  p_verified boolean
) returns jsonb
language plpgsql security definer set search_path = ''
as $body$
declare
  v_pair jsonb;
  v_tx_id uuid;
  v_source_id uuid;
  v_kind text;
  v_tx public.bank_transactions%rowtype;
  v_source_amount numeric;
  v_source_date date;
  v_source_method text;
  v_source_valid boolean;
  v_tx_matched numeric;
  v_source_matched numeric;
  v_count int := 0;
  v_total numeric := 0;
  v_tx_ids uuid[] := '{}';
  v_sources text[] := '{}';
  v_source_key text;
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
  if length(btrim(coalesce(p_note,''))) not between 10 and 480 then
    raise exception 'RECONCILIATION_REASON_REQUIRED';
  end if;

  -- Serialize against existing single-match INSERT/UPDATE and concurrent bulk writes.
  lock table public.bank_outflow_matches in share row exclusive mode;

  for v_pair in select value from jsonb_array_elements(p_pairs)
    order by value->>'bank_transaction_id',value->>'source_kind',value->>'source_id'
  loop
    if jsonb_typeof(v_pair) <> 'object'
       or coalesce(v_pair->>'bank_transaction_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or coalesce(v_pair->>'source_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or coalesce(v_pair->>'source_kind','') not in ('expense','staff_payroll_payment','membership_refund')
    then raise exception 'INVALID_PAIR'; end if;

    v_tx_id := (v_pair->>'bank_transaction_id')::uuid;
    v_source_id := (v_pair->>'source_id')::uuid;
    v_kind := v_pair->>'source_kind';
    v_source_key := v_kind || ':' || v_source_id::text;
    if v_tx_id = any(v_tx_ids) or v_source_key = any(v_sources) then
      raise exception 'DUPLICATE_CREDIT_OR_SOURCE';
    end if;
    v_tx_ids := array_append(v_tx_ids,v_tx_id);
    v_sources := array_append(v_sources,v_source_key);

    select * into v_tx from public.bank_transactions where id=v_tx_id for update;
    if not found then raise exception 'BANK_TRANSACTION_NOT_FOUND'; end if;
    if v_tx.direction <> 'debit' or v_tx.currency <> 'EGP'
       or v_tx.amount <= 0
       or v_tx.category_code = 'internal_transfer' then
      raise exception 'BANK_DEBIT_NOT_ELIGIBLE';
    end if;

    v_source_valid := false;
    v_source_date := null;
    v_source_amount := null;
    v_source_method := null;
    if v_kind = 'expense' then
      select amount, date, payment_method, true into
        v_source_amount, v_source_date, v_source_method, v_source_valid
      from public.expenses where id=v_source_id for update;
    elsif v_kind = 'staff_payroll_payment' then
      select amount, payment_date, payment_method, (status='active') into
        v_source_amount, v_source_date, v_source_method, v_source_valid
      from public.staff_payroll_salary_payments where id=v_source_id for update;
    elsif v_kind = 'membership_refund' then
      select amount, paid_at::date, refund_method, (status='paid') into
        v_source_amount, v_source_date, v_source_method, v_source_valid
      from public.membership_refunds where id=v_source_id for update;
    end if;

    if v_source_valid is distinct from true
       or v_source_amount is null or v_source_amount <= 0
       or v_source_date is null or abs(v_tx.transaction_date-v_source_date)>7
       or lower(coalesce(v_source_method,'')) = 'cash' then
      raise exception 'SOURCE_NOT_ELIGIBLE';
    end if;

    select coalesce(sum(matched_amount),0) into v_tx_matched
    from public.bank_outflow_matches
    where bank_transaction_id=v_tx_id and released_at is null;
    select coalesce(sum(matched_amount),0) into v_source_matched
    from public.bank_outflow_matches
    where source_kind=v_kind and source_id=v_source_id and released_at is null;

    -- Only fully unmatched exact one-to-one pairs may be processed in bulk.
    -- Partial allocations continue through the existing individual review.
    if v_tx_matched <> 0 or v_source_matched <> 0 then
      raise exception 'ALREADY_PARTIALLY_MATCHED';
    end if;
    if v_tx.amount <> v_source_amount then
      raise exception 'AMOUNT_MISMATCH';
    end if;

    insert into public.bank_outflow_matches
      (bank_transaction_id,source_kind,source_id,matched_amount,note,matched_by)
    values (v_tx_id,v_kind,v_source_id,v_tx.amount,'Bulk 2I: '||btrim(p_note),p_actor);
    v_count := v_count + 1;
    v_total := v_total + v_tx.amount;
  end loop;
  return jsonb_build_object('matched_count',v_count,'total_amount',v_total);
end
$body$;

revoke all on function public.bulk_match_bank_outflows_v1(jsonb,uuid,text,boolean)
  from public,anon,authenticated;
grant execute on function public.bulk_match_bank_outflows_v1(jsonb,uuid,text,boolean)
  to service_role;
commit;
