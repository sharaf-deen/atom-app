-- Upgrade refund safeguard extended to direct INSERT (including privileged imports).
-- Ordinary refunds without upgrade history remain supported.
create or replace function public.membership_upgrades_guard_refund_payout_v1()
returns trigger language plpgsql set search_path=public,pg_temp as $$
declare
 v_check boolean:=false;
begin
 if new.status='paid' then
   if TG_OP='INSERT' then
     v_check:=true;
   else
     v_check:=old.status is distinct from 'paid';
   end if;
 end if;
 if v_check and (
      (new.subscription_id is not null and exists(
        select 1 from public.membership_upgrades u
        where u.from_subscription_id=new.subscription_id or u.to_subscription_id=new.subscription_id))
      or (new.subscription_id is null and exists(
        select 1 from public.membership_upgrades u where u.member_id=new.member_id))
    ) then
    raise exception 'UPGRADED_MEMBERSHIP_REFUND_REQUIRES_MANUAL_CREDIT_RECONCILIATION' using errcode='23514';
 end if;
 return new;
end $$;
revoke all on function public.membership_upgrades_guard_refund_payout_v1() from public,anon,authenticated;
drop trigger if exists trg_upgrades_guard_refund_payout_v1 on public.membership_refunds;
create trigger trg_upgrades_guard_refund_payout_v1
 before insert or update of status on public.membership_refunds
 for each row execute function public.membership_upgrades_guard_refund_payout_v1();
