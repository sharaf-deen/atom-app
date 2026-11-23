-- Preserve the payment-date correction audit trail as append-only.
-- Even privileged application code cannot accidentally update/delete audit entries.
begin;
create or replace function public.reject_subscription_payment_date_audit_mutation_v1()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'PAYMENT_DATE_AUDIT_APPEND_ONLY';
end;
$$;
revoke all on function public.reject_subscription_payment_date_audit_mutation_v1()
from public, anon, authenticated;
create trigger subscription_payment_date_audit_append_only
before update or delete on public.subscription_payment_date_corrections
for each row execute function public.reject_subscription_payment_date_audit_mutation_v1();
commit;
