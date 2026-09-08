-- Reconciliation 1B — Super Admin write-only governance
-- Business rule:
--   * Admin keeps read access to reconciliation.
--   * Only Super Admin can create, update, or delete reconciliation batches.
--   * Historical validator/approver records are preserved; non-Super-Admin
--     approvers are deactivated rather than deleted.
--   * Future activation of a non-Super-Admin approver is blocked at DB level.

begin;

-- Preserve historical approver rows but remove write authority from every
-- currently active non-Super-Admin approver.
update public.payment_validation_approvers a
set
  is_active = false,
  updated_at = now(),
  note = case
    when coalesce(a.note, '') = '' then
      'Disabled by Reconciliation 1B: Admin is read-only; Super Admin only can validate.'
    when a.note like '%Disabled by Reconciliation 1B:%' then
      a.note
    else
      a.note || ' | Disabled by Reconciliation 1B: Admin is read-only; Super Admin only can validate.'
  end
where a.is_active = true
  and not public.is_super_admin(a.user_id);

-- Keep Super Admin explicit in the governance list.
insert into public.payment_validation_approvers (
  user_id,
  is_active,
  note,
  created_at,
  updated_at
)
select
  p.user_id,
  true,
  'Reconciliation 1B: Super Admin-only reconciliation authority.',
  now(),
  now()
from public.profiles p
where public.is_super_admin(p.user_id)
on conflict (user_id) do update
set
  is_active = true,
  updated_at = now(),
  note = case
    when coalesce(public.payment_validation_approvers.note, '') = '' then
      excluded.note
    when public.payment_validation_approvers.note like '%Reconciliation 1B:%' then
      public.payment_validation_approvers.note
    else
      public.payment_validation_approvers.note || ' | ' || excluded.note
  end;

-- Authoritative write permission used by:
--   * create_payment_validation_batch_v1
--   * update_payment_validation_batch_v1
--   * delete_payment_validation_batch_v1
--   * RLS write policies on validation batches/items
create or replace function public.is_payment_validation_approver(
  p_uid uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_super_admin(p_uid);
$$;

comment on function public.is_payment_validation_approver(uuid) is
  'Reconciliation 1B: reconciliation write authority is restricted to Super Admin. Admin remains read-only.';

-- Defense in depth: even a future direct table edit cannot reactivate an
-- ordinary Admin as a reconciliation writer.
create or replace function public.enforce_payment_validation_super_admin_approver_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_active = true and not public.is_super_admin(new.user_id) then
    raise exception 'Only Super Admin can be an active payment validation approver.';
  end if;

  return new;
end;
$$;

drop trigger if exists payment_validation_super_admin_approver_guard
  on public.payment_validation_approvers;

create trigger payment_validation_super_admin_approver_guard
before insert or update of user_id, is_active
on public.payment_validation_approvers
for each row
execute function public.enforce_payment_validation_super_admin_approver_v1();

comment on trigger payment_validation_super_admin_approver_guard
  on public.payment_validation_approvers is
  'Prevents non-Super-Admin accounts from receiving reconciliation write authority.';

commit;
