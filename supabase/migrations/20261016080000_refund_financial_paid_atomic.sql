-- Functional 1B.5C - linked refund financial capacity, atomic marking paid.
create or replace function public.mark_linked_membership_refund_paid_atomic(
  p_refund_id uuid, p_actor uuid
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_sub_id uuid;
  r public.membership_refunds%rowtype;
  s public.subscriptions%rowtype;
  v_already_paid numeric(12,2);
  v_ledger_paid numeric(12,2);
  v_ledger_count bigint;
  v_received numeric(12,2);
begin
  if p_actor is null or not exists (
    select 1 from public.profiles where user_id=p_actor and role='super_admin'
  ) then
    raise exception 'Super Admin required' using errcode='42501';
  end if;

  select subscription_id into v_sub_id
    from public.membership_refunds where id=p_refund_id;
  if not found then raise exception 'Refund not found' using errcode='P0002'; end if;
  if v_sub_id is null then
    raise exception 'Linked subscription required for controlled refund payment' using errcode='22023';
  end if;

  -- Lock subscription first so different refunds on the same subscription serialize.
  select * into s from public.subscriptions where id=v_sub_id for update;
  if not found then raise exception 'Subscription not found' using errcode='P0002'; end if;

  select * into r from public.membership_refunds where id=p_refund_id for update;
  if not found then raise exception 'Refund not found' using errcode='P0002'; end if;
  if r.subscription_id is distinct from s.id or r.member_id is distinct from s.member_id then
    raise exception 'Refund and subscription mismatch' using errcode='23514';
  end if;
  if r.status <> 'approved' then
    raise exception 'Refund must be approved before marking paid' using errcode='23514';
  end if;
  if r.amount is null or r.amount <= 0 then
    raise exception 'Refund amount must be positive' using errcode='22023';
  end if;

  v_received := s.amount;
  if v_received is null or v_received < 0 then
    raise exception 'Subscription received amount is invalid' using errcode='22023';
  end if;

  -- Compare payment ledger when present; legacy rows may have no ledger entries.
  select count(*), coalesce(sum(amount),0) into v_ledger_count, v_ledger_paid
    from public.subscription_payments where subscription_id=s.id;
  if v_ledger_count > 0 and abs(v_ledger_paid - v_received) > 0.01 then
    raise exception 'Payment ledger mismatch: reconcile before paying refund'
      using errcode='23514';
  end if;

  select coalesce(sum(amount),0) into v_already_paid
    from public.membership_refunds
    where subscription_id=s.id and status='paid' and id<>r.id;

  if v_already_paid + r.amount > v_received + 0.001 then
    raise exception 'Refund exceeds available received balance' using errcode='23514';
  end if;

  update public.membership_refunds
     set status='paid', paid_by=p_actor, paid_at=now()
   where id=r.id;

  return jsonb_build_object(
    'ok',true,'id',r.id,'member_id',r.member_id,'subscription_id',s.id,
    'refunded_amount',r.amount,'received_amount',v_received,
    'already_refunded',v_already_paid,
    'remaining_refundable',v_received-v_already_paid-r.amount
  );
end;
$$;
