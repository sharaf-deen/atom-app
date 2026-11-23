-- ATOM Payment — Payment Date Correction & Financial Integrity
-- A date change is a single atomic transaction and never creates financial revenue.
begin;

create table public.subscription_payment_date_corrections (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.subscription_payments(id) on delete restrict,
  subscription_id uuid not null references public.subscriptions(id) on delete restrict,
  member_id uuid not null references public.profiles(user_id) on delete restrict,
  old_paid_at timestamptz not null,
  new_paid_at timestamptz not null,
  reason text not null check (length(btrim(reason)) between 5 and 500),
  corrected_by uuid not null references public.profiles(user_id) on delete restrict,
  corrected_at timestamptz not null default now(),
  check (old_paid_at <> new_paid_at)
);
create index subscription_payment_date_corrections_payment_idx
  on public.subscription_payment_date_corrections(payment_id, corrected_at desc);
alter table public.subscription_payment_date_corrections enable row level security;
revoke all on public.subscription_payment_date_corrections from public, anon, authenticated;
grant select, insert on public.subscription_payment_date_corrections to service_role;
grant select on public.subscription_payment_date_corrections to authenticated;
create policy "super admin read payment date correction audit"
  on public.subscription_payment_date_corrections
  for select to authenticated using (public.is_super_admin((select auth.uid())));

create or replace function public.correct_subscription_payment_date_v1(
  p_payment_id uuid,
  p_expected_paid_at timestamptz,
  p_new_paid_at timestamptz,
  p_reason text,
  p_actor uuid
)
returns table(payment_id uuid, paid_at timestamptz, subscription_paid_at timestamptz)
language plpgsql security definer set search_path = public
as $$
declare
  v_payment public.subscription_payments%rowtype;
  v_subscription public.subscriptions%rowtype;
  v_latest timestamptz;
  v_now timestamptz := now();
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if p_actor is null or not public.is_super_admin(p_actor) then
    raise exception 'SUPER_ADMIN_REQUIRED';
  end if;
  if p_payment_id is null or p_expected_paid_at is null or p_new_paid_at is null
     or length(v_reason) not between 5 and 500 then
    raise exception 'INVALID_CORRECTION_REQUEST';
  end if;
  if (p_new_paid_at at time zone 'Africa/Cairo')::date >
     (v_now at time zone 'Africa/Cairo')::date then
    raise exception 'FUTURE_PAYMENT_DATE';
  end if;

  -- Avoid modifying a payment whose external validation evidence may be in use.
  -- Deliberately fail closed rather than automatically release/rebuild validation.
  select * into v_payment from public.subscription_payments
    where id = p_payment_id for update;
  if not found then raise exception 'PAYMENT_NOT_FOUND'; end if;
  if v_payment.paid_at is distinct from p_expected_paid_at then
    raise exception 'STALE_PAYMENT_DATE';
  end if;
  if v_payment.paid_at = p_new_paid_at then
    raise exception 'PAYMENT_DATE_UNCHANGED';
  end if;
  if v_payment.subscription_id is null then
    raise exception 'PAYMENT_WITHOUT_SUBSCRIPTION';
  end if;

  select * into v_subscription from public.subscriptions
    where id = v_payment.subscription_id for update;
  if not found then raise exception 'SUBSCRIPTION_NOT_FOUND'; end if;
  if v_subscription.member_id is distinct from v_payment.member_id then
    raise exception 'PAYMENT_MEMBER_MISMATCH';
  end if;
  if exists (
    select 1 from public.membership_refunds r
    where r.subscription_id = v_subscription.id
      and r.status in ('pending_review', 'approved', 'paid')
  ) then
    raise exception 'REFUND_WORKFLOW_LOCKED';
  end if;
  -- Any attached active validation is immutable until manually released by the
  -- existing audited reconciliation process. This also covers modern bank matches
  -- because they reference the validation batch.
  if exists (
    select 1 from public.payment_validation_batch_items i
    join public.payment_validation_batches b on b.id = i.batch_id
    where i.source_kind = 'subscription_payment' and i.source_id = p_payment_id
      and i.released_at is null and b.deleted_at is null
  ) then
    raise exception 'PAYMENT_VALIDATION_LOCKED';
  end if;
  -- Fail closed if even released validation evidence is linked to a currently
  -- active bank match in either reconciliation implementation.
  if exists (
    select 1 from public.payment_validation_batch_items i
    join public.reconciliation_bank_matches m
      on m.batch_id = i.batch_id and m.released_at is null
    where i.source_kind = 'subscription_payment' and i.source_id = p_payment_id
  ) or exists (
    select 1 from public.payment_validation_batch_items i
    join public.bank_payment_matches m
      on m.batch_id = i.batch_id and m.released_at is null
    where i.source_kind = 'subscription_payment' and i.source_id = p_payment_id
  ) then
    raise exception 'BANK_MATCH_LOCKED';
  end if;

  update public.subscription_payments set paid_at = p_new_paid_at
    where id = p_payment_id;
  select max(coalesce(p.paid_at, p.created_at)) into v_latest
    from public.subscription_payments p
    where p.subscription_id = v_subscription.id;
  update public.subscriptions set paid_at = v_latest
    where id = v_subscription.id;
  -- Audit is mandatory: if it fails, every update rolls back.
  insert into public.subscription_payment_date_corrections
    (payment_id, subscription_id, member_id, old_paid_at, new_paid_at, reason, corrected_by)
  values
    (p_payment_id, v_subscription.id, v_payment.member_id,
     v_payment.paid_at, p_new_paid_at, v_reason, p_actor);

  return query select p_payment_id, p_new_paid_at, v_latest;
end;
$$;
revoke all on function public.correct_subscription_payment_date_v1(uuid,timestamptz,timestamptz,text,uuid)
  from public, anon, authenticated;
grant execute on function public.correct_subscription_payment_date_v1(uuid,timestamptz,timestamptz,text,uuid)
  to service_role;
commit;
