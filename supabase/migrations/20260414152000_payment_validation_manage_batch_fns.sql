begin;

create or replace function public.update_payment_validation_batch_v1(
  p_batch_id uuid,
  p_counted_amount numeric,
  p_note text default null,
  p_actor uuid default auth.uid()
)
returns table (
  batch_id uuid,
  counted_amount numeric,
  difference_amount numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch public.payment_validation_batches%rowtype;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_counted_amount numeric(12,2);
begin
  if p_batch_id is null then
    raise exception 'Missing batch id.';
  end if;

  if p_actor is null then
    raise exception 'Missing actor.';
  end if;

  if not public.is_payment_validation_approver(p_actor) then
    raise exception 'Only active payment approvers or super admin can edit validation batches.';
  end if;

  if p_counted_amount is null or p_counted_amount < 0 then
    raise exception 'Counted amount must be 0 or greater.';
  end if;

  v_counted_amount := round(p_counted_amount::numeric, 2);

  select *
  into v_batch
  from public.payment_validation_batches b
  where b.id = p_batch_id
  for update;

  if not found then
    raise exception 'Validation batch not found.';
  end if;

  if v_batch.deleted_at is not null then
    raise exception 'Validation batch was already deleted.';
  end if;

  if v_counted_amount <> v_batch.expected_amount and v_note is null then
    raise exception 'A note is required when counted amount differs from expected.';
  end if;

  update public.payment_validation_batches
  set counted_amount = v_counted_amount,
      difference_amount = v_counted_amount - expected_amount,
      note = v_note,
      updated_at = now(),
      updated_by = p_actor
  where id = p_batch_id;

  return query
  select
    b.id,
    b.counted_amount,
    b.difference_amount
  from public.payment_validation_batches b
  where b.id = p_batch_id;
end;
$$;

grant execute on function public.update_payment_validation_batch_v1(uuid, numeric, text, uuid)
  to authenticated, service_role;

create or replace function public.delete_payment_validation_batch_v1(
  p_batch_id uuid,
  p_actor uuid default auth.uid()
)
returns table (
  batch_id uuid,
  released_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch public.payment_validation_batches%rowtype;
  v_released_count integer := 0;
  v_now timestamptz := now();
begin
  if p_batch_id is null then
    raise exception 'Missing batch id.';
  end if;

  if p_actor is null then
    raise exception 'Missing actor.';
  end if;

  if not public.is_payment_validation_approver(p_actor) then
    raise exception 'Only active payment approvers or super admin can delete validation batches.';
  end if;

  select *
  into v_batch
  from public.payment_validation_batches b
  where b.id = p_batch_id
  for update;

  if not found then
    raise exception 'Validation batch not found.';
  end if;

  if v_batch.deleted_at is not null then
    raise exception 'Validation batch was already deleted.';
  end if;

  update public.payment_validation_batch_items
  set released_at = v_now,
      released_by = p_actor
  where batch_id = p_batch_id
    and released_at is null;

  get diagnostics v_released_count = row_count;

  update public.payment_validation_batches
  set deleted_at = v_now,
      deleted_by = p_actor,
      updated_at = v_now,
      updated_by = p_actor
  where id = p_batch_id
    and deleted_at is null;

  return query
  select p_batch_id, v_released_count;
end;
$$;

grant execute on function public.delete_payment_validation_batch_v1(uuid, uuid)
  to authenticated, service_role;

commit;
