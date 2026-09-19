-- Super Admin only; correcting one payment replaces its validated day/method
-- batch atomically. The old batch and item snapshots remain in the audit trail.
begin;

alter table public.payment_validation_batches
  add column if not exists superseded_by_batch_id uuid
    references public.payment_validation_batches(id) on delete restrict;

create table if not exists public.payment_validation_corrections (
  id uuid primary key default gen_random_uuid(),
  old_batch_id uuid not null references public.payment_validation_batches(id) on delete restrict,
  new_batch_id uuid not null unique references public.payment_validation_batches(id) on delete restrict,
  source_kind text not null check (source_kind in ('subscription_payment', 'external_income')),
  source_id uuid not null,
  old_amount numeric(12,2) not null,
  new_amount numeric(12,2) not null,
  reason text not null check (length(btrim(reason)) between 5 and 500),
  corrected_at timestamptz not null default now(),
  corrected_by uuid not null references public.profiles(user_id) on delete restrict
);
create index if not exists payment_validation_corrections_old_idx
  on public.payment_validation_corrections(old_batch_id);
alter table public.payment_validation_corrections enable row level security;
create policy "super admin read payment validation corrections"
  on public.payment_validation_corrections for select
  using (public.is_super_admin(auth.uid()));
revoke all on public.payment_validation_corrections from public, anon, authenticated;
grant select on public.payment_validation_corrections to authenticated;
grant select, insert on public.payment_validation_corrections to service_role;

-- Lock the target batch during matching, so a correction cannot race with a
-- new bank match and leave a match pointing at an inactive batch.
create or replace function public.guard_reconciliation_bank_match_batch_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_deleted timestamptz;
begin
  select b.deleted_at into v_deleted from public.payment_validation_batches b
  where b.id = new.batch_id for share;
  if not found or v_deleted is not null then
    raise exception 'Bank match target is no longer an active validation batch.';
  end if;
  return new;
end;
$$;
create trigger reconciliation_bank_match_active_batch_guard
before insert on public.reconciliation_bank_matches
for each row execute function public.guard_reconciliation_bank_match_batch_v1();

-- A counted-total edit or ordinary deletion must not silently invalidate an
-- active bank match either. The Super Admin explicitly releases it first.
create or replace function public.guard_matched_validation_batch_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.counted_amount is distinct from old.counted_amount
      or (old.deleted_at is null and new.deleted_at is not null))
     and exists (select 1 from public.reconciliation_bank_matches m
                 where m.batch_id = old.id and m.released_at is null) then
    raise exception 'Release the active bank match before changing this batch.';
  end if;
  return new;
end;
$$;
create trigger payment_validation_matched_batch_guard
before update of counted_amount, deleted_at on public.payment_validation_batches
for each row execute function public.guard_matched_validation_batch_v1();

create or replace function public.correct_and_revalidate_payment_v1(
  p_batch_id uuid,
  p_source_kind text,
  p_source_id uuid,
  p_old_amount numeric,
  p_new_amount numeric,
  p_counted_amount numeric,
  p_reason text,
  p_actor uuid default auth.uid()
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch public.payment_validation_batches%rowtype;
  v_item public.payment_validation_batch_items%rowtype;
  v_sub public.subscriptions%rowtype;
  v_old numeric(12,2);
  v_expected numeric(12,2);
  v_count integer;
  v_new_id uuid := gen_random_uuid();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_now timestamptz := now();
begin
  if p_actor is null or not public.is_super_admin(p_actor) then
    raise exception 'Only Super Admin can correct and revalidate.';
  end if;
  if p_batch_id is null or p_source_id is null or p_source_kind not in ('subscription_payment', 'external_income') then
    raise exception 'Select a valid source entry.';
  end if;
  if v_reason is null or length(v_reason) not between 5 and 500 then
    raise exception 'A correction reason of 5 to 500 characters is required.';
  end if;
  if p_new_amount is null or p_new_amount <= 0 or p_new_amount <> round(p_new_amount, 2)
     or p_old_amount is null or p_old_amount <= 0 or p_old_amount <> round(p_old_amount, 2)
     or p_counted_amount is null or p_counted_amount < 0 or p_counted_amount <> round(p_counted_amount, 2) then
    raise exception 'Use valid amounts with at most two decimals.';
  end if;
  if p_new_amount = p_old_amount then raise exception 'New amount must differ from old amount.'; end if;

  select * into v_batch from public.payment_validation_batches b
  where b.id = p_batch_id for update;
  if not found or v_batch.deleted_at is not null or v_batch.superseded_by_batch_id is not null then
    raise exception 'The batch is no longer active. Refresh and try again.';
  end if;
  if v_batch.validation_mode not in ('daily', 'cash_period')
     or (v_batch.validation_mode = 'cash_period' and v_batch.payment_method <> 'cash')
     or (v_batch.validation_mode = 'daily' and v_batch.business_date < date '2026-08-01')
     or exists (select 1 from public.payment_validation_batch_items i
                where i.batch_id = p_batch_id
                  and i.business_date_snapshot < date '2026-08-01') then
    raise exception 'Only scopes entirely on or after 01/08/2026 can be corrected here.';
  end if;
  -- Proof stays attached to the old batch; a live bank match must first be
  -- explicitly released (with its own mandatory audit reason).
  if exists (select 1 from public.reconciliation_bank_matches m
             where m.batch_id = p_batch_id and m.released_at is null) then
    raise exception 'Release the active bank match with a reason before correcting this batch.';
  end if;

  select * into v_item from public.payment_validation_batch_items i
  where i.batch_id = p_batch_id and i.source_kind = p_source_kind
    and i.source_id = p_source_id and i.released_at is null for update;
  if not found or v_item.amount_snapshot <> p_old_amount
     or (v_batch.validation_mode = 'daily' and v_item.business_date_snapshot <> v_batch.business_date) then
    raise exception 'The source snapshot changed. Refresh and try again.';
  end if;

  if p_source_kind = 'subscription_payment' then
    select sp.amount into v_old from public.subscription_payments sp
    where sp.id = p_source_id for update;
    if not found or v_old <> p_old_amount then
      raise exception 'Subscription payment changed. Refresh and try again.';
    end if;
    select s.* into v_sub from public.subscriptions s
    join public.subscription_payments sp on sp.subscription_id = s.id
    where sp.id = p_source_id for update of s;
    if not found or v_sub.amount is null or v_sub.amount_due is null
       or v_sub.amount + (p_new_amount - p_old_amount) < 0
       or v_sub.amount_due - (p_new_amount - p_old_amount) < 0 then
      raise exception 'Correction would make the subscription balance invalid. Review the subscription first.';
    end if;
    if exists (select 1 from public.membership_refunds r
               where r.subscription_id = v_sub.id
                 and r.status in ('pending_review', 'approved', 'paid')) then
      raise exception 'This subscription has a refund workflow. Review it before correcting the payment.';
    end if;
    update public.subscription_payments set amount = p_new_amount where id = p_source_id;
    update public.subscriptions
      set amount = v_sub.amount + (p_new_amount - p_old_amount),
          amount_due = v_sub.amount_due - (p_new_amount - p_old_amount)
    where id = v_sub.id;
  else
    select ei.amount into v_old from public.external_income_entries ei
    where ei.id = p_source_id for update;
    if not found or v_old <> p_old_amount then
      raise exception 'External income changed. Refresh and try again.';
    end if;
    update public.external_income_entries
    set amount = p_new_amount, updated_at = v_now, updated_by = p_actor
    where id = p_source_id;
  end if;

  if not exists (
    select 1 from public.admin_income_events_v1 e
    where e.source_kind = p_source_kind and e.source_id = p_source_id
      and e.payment_method_norm = v_batch.payment_method
      and e.business_date = v_item.business_date_snapshot
      and e.amount = p_new_amount
  ) then
    raise exception 'The corrected payment no longer belongs to its original day and method.';
  end if;

  -- Guard against another source being changed after the original validation.
  select count(*)::integer, coalesce(sum(i.amount_snapshot), 0)::numeric(12,2)
    into v_count, v_expected
  from public.payment_validation_batch_items i
  where i.batch_id = p_batch_id and i.released_at is null;
  if v_count < 1 or v_expected <> v_batch.expected_amount then
    raise exception 'The batch has already been partially released. Review it manually.';
  end if;
  if exists (
    select 1 from public.payment_validation_batch_items i
    left join public.admin_income_events_v1 e
      on e.source_kind = i.source_kind and e.source_id = i.source_id
    where i.batch_id = p_batch_id and i.released_at is null
      and (e.source_id is null or e.amount <> case
        when i.source_kind = p_source_kind and i.source_id = p_source_id then p_new_amount
        else i.amount_snapshot end
        or e.business_date <> i.business_date_snapshot
        or e.payment_method_norm <> v_batch.payment_method)
  ) then
    raise exception 'Another linked payment changed. Review this batch before revalidating.';
  end if;
  v_expected := v_expected + p_new_amount - p_old_amount;

  -- No history is overwritten: old batch and old item snapshots are retained.
  -- Only the new version is an active validation for these source entries.
  update public.payment_validation_batch_items
  set released_at = v_now, released_by = p_actor
  where batch_id = p_batch_id and released_at is null;
  update public.payment_validation_batches
  set deleted_at = v_now, deleted_by = p_actor,
      updated_at = v_now, updated_by = p_actor
  where id = p_batch_id;

  insert into public.payment_validation_batches
    (id, payment_method, validation_mode, business_date, period_from, period_to,
     expected_amount, counted_amount, difference_amount, note, validated_by, created_by)
  values
    (v_new_id, v_batch.payment_method, v_batch.validation_mode, v_batch.business_date,
     v_batch.period_from, v_batch.period_to, v_expected,
     p_counted_amount, p_counted_amount - v_expected,
     'Revalidated after correction: ' || v_reason, p_actor, p_actor);

  insert into public.payment_validation_batch_items
    (batch_id, source_kind, source_id, amount_snapshot, business_date_snapshot,
     event_at_snapshot, created_by)
  select v_new_id, i.source_kind, i.source_id,
         case when i.source_kind = p_source_kind and i.source_id = p_source_id
              then p_new_amount else i.amount_snapshot end,
         i.business_date_snapshot, i.event_at_snapshot, p_actor
  from public.payment_validation_batch_items i
  where i.batch_id = p_batch_id and i.released_at = v_now
  order by i.event_at_snapshot, i.source_kind, i.source_id;
  get diagnostics v_count = row_count;
  if v_count < 1 or
    (select coalesce(sum(i.amount_snapshot), 0) from public.payment_validation_batch_items i
     where i.batch_id = v_new_id) <> v_expected then
    raise exception 'Revalidation items changed; no correction was saved.';
  end if;

  update public.payment_validation_batches
  set superseded_by_batch_id = v_new_id where id = p_batch_id;
  insert into public.payment_validation_corrections
    (old_batch_id, new_batch_id, source_kind, source_id, old_amount,
     new_amount, reason, corrected_at, corrected_by)
  values (p_batch_id, v_new_id, p_source_kind, p_source_id,
          p_old_amount, p_new_amount, v_reason, v_now, p_actor);
  return v_new_id;
end;
$$;
revoke all on function public.correct_and_revalidate_payment_v1(uuid, text, uuid, numeric, numeric, numeric, text, uuid)
  from public, anon, authenticated;
grant execute on function public.correct_and_revalidate_payment_v1(uuid, text, uuid, numeric, numeric, numeric, text, uuid)
  to service_role;

-- Reading the reconciliation ledger, evidence, and bank matching now requires
-- Super Admin in SQL as well as in Next.js routes and file download endpoints.
drop policy if exists "admin read payment_validation_approvers" on public.payment_validation_approvers;
create policy "super admin read payment_validation_approvers" on public.payment_validation_approvers
  for select using (public.is_super_admin(auth.uid()));
drop policy if exists "admin read payment_validation_batches" on public.payment_validation_batches;
create policy "super admin read payment_validation_batches" on public.payment_validation_batches
  for select using (public.is_super_admin(auth.uid()));
drop policy if exists "admin read payment_validation_batch_items" on public.payment_validation_batch_items;
create policy "super admin read payment_validation_batch_items" on public.payment_validation_batch_items
  for select using (public.is_super_admin(auth.uid()));
drop policy if exists "admin read payment validation evidence" on public.payment_validation_batch_evidence;
create policy "super admin read payment validation evidence" on public.payment_validation_batch_evidence
  for select using (public.is_super_admin(auth.uid()));
drop policy if exists "admin read reconciliation bank imports" on public.reconciliation_bank_imports;
create policy "super admin read reconciliation bank imports" on public.reconciliation_bank_imports
  for select using (public.is_super_admin(auth.uid()));
drop policy if exists "admin read reconciliation bank lines" on public.reconciliation_bank_statement_lines;
create policy "super admin read reconciliation bank lines" on public.reconciliation_bank_statement_lines
  for select using (public.is_super_admin(auth.uid()));
drop policy if exists "admin read reconciliation bank matches" on public.reconciliation_bank_matches;
create policy "super admin read reconciliation bank matches" on public.reconciliation_bank_matches
  for select using (public.is_super_admin(auth.uid()));

-- These helper views/functions were previously exposed to every authenticated
-- user. The application itself reads them with the server-only service role.
revoke select on public.payment_validation_active_source_locks_v1 from public, anon, authenticated;
revoke select on public.payment_validation_approver_profiles_v1 from public, anon, authenticated;
revoke execute on function public.is_payment_validation_source_locked_v1(text, uuid)
  from public, anon, authenticated;

commit;
