-- Functional 1B.5B: atomic refund subscription impact.
-- One statement per migration for Supabase prepared statement compatibility.
create or replace function public.apply_membership_refund_impact_atomic(
  p_refund_id uuid,
  p_action text,
  p_reason text,
  p_impact_end_date date,
  p_actor uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r public.membership_refunds%rowtype;
  s public.subscriptions%rowtype;
  v_subscription_id uuid;
  v_member_id uuid;
  v_today date := (now() at time zone 'Africa/Cairo')::date;
  v_next_status text;
  v_next_end date;
  v_original_status text;
  v_original_end date;
  v_result_refund jsonb;
  v_result_subscription jsonb;
begin
  if p_actor is null or not exists (
    select 1 from public.profiles
    where user_id = p_actor and role = 'super_admin'
  ) then
    raise exception 'Super Admin required' using errcode = '42501';
  end if;
  if p_action is null or p_action not in ('keep_active','cancel_subscription','shorten_subscription') then
    raise exception 'Invalid subscription impact action' using errcode = '22023';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 or length(p_reason) > 2000 then
    raise exception 'Decision reason must be 3 to 2000 characters' using errcode = '22023';
  end if;

  -- Read link to lock the subscription FIRST, matching the freeze RPC lock order.
  select subscription_id, member_id into v_subscription_id, v_member_id
  from public.membership_refunds where id = p_refund_id;
  if not found then raise exception 'Refund not found' using errcode = 'P0002'; end if;
  if v_subscription_id is null then raise exception 'Refund has no linked subscription' using errcode = '22023'; end if;

  select * into s from public.subscriptions where id = v_subscription_id for update;
  if not found then raise exception 'Subscription not found' using errcode = 'P0002'; end if;

  select * into r from public.membership_refunds where id = p_refund_id for update;
  if not found then raise exception 'Refund not found' using errcode = 'P0002'; end if;
  if r.subscription_id is distinct from s.id or r.member_id is distinct from s.member_id then
    raise exception 'Refund subscription or member changed' using errcode = '23514';
  end if;
  if r.status <> 'paid' then
    raise exception 'Refund must be paid before applying subscription impact' using errcode = '23514';
  end if;
  if r.subscription_impact_status is distinct from 'not_applied' then
    raise exception 'Refund impact already decided' using errcode = '23505';
  end if;

  v_original_status := s.status;
  v_original_end := s.end_date;
  v_next_status := s.status;
  v_next_end := s.end_date;

  if p_action <> 'keep_active' then
    if s.subscription_type is distinct from 'time' or s.status not in ('active','expired') then
      raise exception 'Cancellation/shortening requires an active or expired time subscription'
        using errcode = '22023';
    end if;
    -- Freeze RPC derives the underlying end date from ALL non-cleared history.
    -- Do not invalidate that invariant by shortening/cancelling coverage here.
    if exists (
      select 1 from public.subscription_freezes
      where subscription_id = s.id and cleared_at is null
    ) then
      raise exception 'Subscription has freeze history: resolve freezes before changing coverage'
        using errcode = '23514';
    end if;
    if s.end_date is null then
      raise exception 'Subscription end date required' using errcode = '22023';
    end if;
    if p_action = 'cancel_subscription' then
      v_next_status := 'cancelled';
      v_next_end := least(s.end_date, v_today);
    else
      if p_impact_end_date is null
        or s.start_date is null
        or p_impact_end_date < s.start_date
        or p_impact_end_date >= s.end_date then
        raise exception 'New end date must be within subscription coverage and earlier than current end'
          using errcode = '22023';
      end if;
      v_next_end := p_impact_end_date;
      v_next_status := case when v_next_end < v_today then 'expired' else 'active' end;
    end if;

    update public.subscriptions
      set status = v_next_status, end_date = v_next_end
      where id = s.id;
  end if;

  update public.membership_refunds
    set subscription_impact_action = p_action,
        subscription_impact_status = 'applied',
        subscription_impact_applied_by = p_actor,
        subscription_impact_applied_at = now(),
        subscription_impact_reason = btrim(p_reason),
        subscription_impact_original_status = v_original_status,
        subscription_impact_original_end_date = v_original_end,
        subscription_impact_new_status = v_next_status,
        subscription_impact_new_end_date = v_next_end
    where id = r.id;

  select to_jsonb(x) into v_result_refund from (
    select id, member_id, subscription_id, status, amount,
           subscription_impact_action, subscription_impact_status,
           subscription_impact_applied_at
    from public.membership_refunds where id = r.id
  ) x;

  select to_jsonb(x) into v_result_subscription from (
    select id, member_id, status, start_date, end_date, plan
    from public.subscriptions where id = s.id
  ) x;

  return jsonb_build_object(
    'ok', true,
    'refund', v_result_refund,
    'subscription', v_result_subscription,
    'audit', jsonb_build_object(
      'refund_id', r.id,
      'member_id', r.member_id,
      'subscription_id', s.id,
      'refund_amount', r.amount,
      'impact_action', p_action,
      'original_status', v_original_status,
      'original_end_date', v_original_end,
      'new_status', v_next_status,
      'new_end_date', v_next_end,
      'decision_reason', btrim(p_reason)
    )
  );
end;
$$;
