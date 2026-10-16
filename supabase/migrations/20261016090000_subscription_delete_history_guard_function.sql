-- Functional 1B.6: prevent destructive deletion of subscription financial/freeze history.
-- One statement per migration for prepared-statement compatibility.
create or replace function public.prevent_subscription_history_deletion()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(old.amount, 0) > 0 or coalesce(old.amount_due, 0) > 0 then
    raise exception 'Cannot delete subscription with recorded paid or due amount' using errcode = '23514';
  end if;

  if exists (select 1 from public.subscription_payments where subscription_id = old.id) then
    raise exception 'Cannot delete subscription with payment history' using errcode = '23514';
  end if;

  if exists (select 1 from public.membership_refunds where subscription_id = old.id) then
    raise exception 'Cannot delete subscription with linked refund history' using errcode = '23514';
  end if;

  if exists (select 1 from public.subscription_freezes where subscription_id = old.id) then
    raise exception 'Cannot delete subscription with freeze history' using errcode = '23514';
  end if;

  return old;
end;
$$;
