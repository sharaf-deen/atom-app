-- DRAFT ONLY — NOT A MIGRATION. Convert with Supabase CLI and review in isolated DB.
-- Payment method corrections do not create revenue and do not silently
-- revalidate physical collection evidence under a different method.
-- The corrected source becomes OPEN in the new method/day for manual validation.
begin;

create table if not exists public.subscription_payment_method_corrections (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.subscription_payments(id) on delete restrict,
  subscription_id uuid not null references public.subscriptions(id) on delete restrict,
  previous_batch_id uuid null references public.payment_validation_batches(id) on delete restrict,
  old_method text not null,
  new_method text not null,
  reason text not null check (length(btrim(reason)) between 5 and 500),
  corrected_at timestamptz not null default now(),
  corrected_by uuid not null references public.profiles(user_id) on delete restrict
);
create index if not exists subscription_payment_method_corrections_payment_idx
  on public.subscription_payment_method_corrections(payment_id, corrected_at desc);
alter table public.subscription_payment_method_corrections enable row level security;
revoke all on public.subscription_payment_method_corrections from public, anon, authenticated;
grant select, insert on public.subscription_payment_method_corrections to service_role;
create policy "super admin read subscription payment method corrections"
  on public.subscription_payment_method_corrections for select
  to authenticated using (public.is_super_admin((select auth.uid())));

create or replace function public.correct_subscription_payment_method_v1(
  p_payment_id uuid,
  p_old_method text,
  p_new_method text,
  p_reason text,
  p_actor uuid default auth.uid()
)
returns table(payment_id uuid, previous_batch_id uuid, new_method text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry public.subscription_payments%rowtype;
  v_subscription public.subscriptions%rowtype;
  v_batch public.payment_validation_batches%rowtype;
  v_batch_id uuid;
  v_old_method text := public.normalize_payment_method(p_old_method);
  v_new_method text := public.normalize_payment_method(p_new_method);
  v_reason text := nullif(btrim(coalesce(p_reason,'')), '');
  v_now timestamptz := now();
  v_count integer;
  v_item_count integer;
begin
  if p_actor is null or not public.is_super_admin(p_actor) then
    raise exception 'Only Super Admin can correct payment methods.';
  end if;
  if p_payment_id is null or v_old_method is null or v_new_method is null
     or v_old_method not in ('cash','instapay','card','bank_transfer')
     or v_new_method not in ('cash','instapay','card','bank_transfer')
     or v_old_method = v_new_method then
    raise exception 'Specify a valid payment and two different methods.';
  end if;
  if v_reason is null or length(v_reason) not between 5 and 500 then
    raise exception 'A correction reason of 5 to 500 characters is required.';
  end if;

  select * into v_entry from public.subscription_payments
    where id = p_payment_id for update;
  if not found or public.normalize_payment_method(v_entry.payment_method) is distinct from v_old_method then
    raise exception 'Payment changed or not found; refresh and retry.';
  end if;

  select * into v_subscription from public.subscriptions
    where id = v_entry.subscription_id for update;
  if not found then raise exception 'Subscription not found.'; end if;

  if exists (
    select 1 from public.membership_refunds r
    where r.subscription_id = v_subscription.id
      and r.status in ('pending_review','approved','paid')
  ) then
    raise exception 'Refund workflow exists; review it before modifying payment history.';
  end if;

  -- Lock an active validation batch first. Corrections of multi-entry batches
  -- need a separate batch-rebuild workflow, not partial mutation of evidence.
  select i.batch_id into v_batch_id from public.payment_validation_batch_items i
    join public.payment_validation_batches b on b.id = i.batch_id
    where i.source_kind = 'subscription_payment' and i.source_id = p_payment_id
      and i.released_at is null and b.deleted_at is null
    limit 1;
  if v_batch_id is not null then
    select * into v_batch from public.payment_validation_batches
      where id = v_batch_id for update;
    if v_batch.deleted_at is not null or v_batch.superseded_by_batch_id is not null
       or v_batch.validation_mode <> 'daily'
       or v_batch.business_date < date '2026-08-01'
       or v_batch.payment_method <> v_old_method then
      raise exception 'Historical or changed validation batch; manual financial review required.';
    end if;
    if exists (
      select 1 from public.reconciliation_bank_matches m
      where m.batch_id = v_batch_id and m.released_at is null
    ) then
      raise exception 'Release active bank match with an audited reason before correction.';
    end if;
    select count(*) into v_item_count
      from public.payment_validation_batch_items i
      where i.batch_id = v_batch_id and i.released_at is null;
    if v_item_count <> 1 then
      raise exception 'Batch has multiple payments; rebuild this scope under a separate review workflow.';
    end if;
    if not exists (
      select 1 from public.payment_validation_batch_items i
      where i.batch_id = v_batch_id
        and i.source_kind = 'subscription_payment'
        and i.source_id = p_payment_id
        and i.amount_snapshot = v_entry.amount
        and i.business_date_snapshot = v_batch.business_date
        and i.released_at is null
    ) then
      raise exception 'Validation snapshot does not match payment; refresh and review.';
    end if;
  end if;

  -- Check header cardinality: the header method can safely follow the entry
  -- only when a single payment exists. Multiple installments remain distinct.
  select count(*) into v_count from public.subscription_payments
    where subscription_id = v_subscription.id;

  if v_batch_id is not null then
    update public.payment_validation_batch_items
      set released_at = v_now, released_by = p_actor
      where batch_id = v_batch_id and released_at is null;
    update public.payment_validation_batches
      set deleted_at = v_now, deleted_by = p_actor,
          updated_at = v_now, updated_by = p_actor
      where id = v_batch_id;
  end if;

  update public.subscription_payments set payment_method = v_new_method
    where id = p_payment_id;

  if v_count = 1 then
    update public.subscriptions set payment_method = v_new_method
    where id = v_subscription.id;
  end if;

  insert into public.subscription_payment_method_corrections
    (payment_id, subscription_id, previous_batch_id, old_method, new_method, reason, corrected_at, corrected_by)
  values (p_payment_id, v_subscription.id, v_batch_id, v_old_method, v_new_method,
          v_reason, v_now, p_actor);

  return query select p_payment_id, v_batch_id, v_new_method;
end;
$$;
revoke all on function public.correct_subscription_payment_method_v1(uuid,text,text,text,uuid)
  from public, anon, authenticated;
grant execute on function public.correct_subscription_payment_method_v1(uuid,text,text,text,uuid)
  to service_role;

commit;
