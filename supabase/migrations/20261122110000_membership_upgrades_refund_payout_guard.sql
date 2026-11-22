-- ATOM Upgrades V1: fail-closed refund payout on transferred subscription value.
-- The standard refund workflow only sees the current subscription's new cash and cannot
-- safely apportion previously transferred credit or historic refunds. Manual reconciliation
-- and a purpose-built refund workflow are required; NEVER pay against incomplete totals.
create or replace function public.membership_upgrades_guard_refund_payout_v1()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if new.status='paid' and old.status is distinct from 'paid'
    and (
      (new.subscription_id is not null and exists(
        select 1 from public.membership_upgrades u
         where u.from_subscription_id=new.subscription_id
           or u.to_subscription_id=new.subscription_id))
      or (new.subscription_id is null and exists(
        select 1 from public.membership_upgrades u where u.member_id=new.member_id))
    )
 then
   raise exception 'UPGRADED_MEMBERSHIP_REFUND_REQUIRES_MANUAL_CREDIT_RECONCILIATION'
     using errcode='23514';
 end if;
 return new;
end $$;
revoke all on function public.membership_upgrades_guard_refund_payout_v1() from public,anon,authenticated;
drop trigger if exists trg_upgrades_guard_refund_payout_v1 on public.membership_refunds;
create trigger trg_upgrades_guard_refund_payout_v1
 before update of status on public.membership_refunds
 for each row execute function public.membership_upgrades_guard_refund_payout_v1();
