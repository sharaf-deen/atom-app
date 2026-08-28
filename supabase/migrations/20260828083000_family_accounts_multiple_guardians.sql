-- Family Accounts Lot 1D — Multiple guardians & primary guardian management
-- Keeps all member/Auth/subscription/payment/freeze flows unchanged.
-- Adds one atomic server-only helper used when changing a family's primary guardian.

begin;

create or replace function public.set_family_primary_guardian(
  p_family_id uuid,
  p_auth_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Serialize primary-guardian changes for this family.
  perform 1
  from public.family_guardians fg
  where fg.family_id = p_family_id
  for update;

  if not exists (
    select 1
    from public.family_guardians fg
    where fg.family_id = p_family_id
      and fg.auth_user_id = p_auth_user_id
  ) then
    raise exception 'GUARDIAN_NOT_FOUND';
  end if;

  update public.family_guardians
  set is_primary = false
  where family_id = p_family_id
    and is_primary = true
    and auth_user_id <> p_auth_user_id;

  update public.family_guardians
  set is_primary = true
  where family_id = p_family_id
    and auth_user_id = p_auth_user_id;
end;
$$;

revoke all on function public.set_family_primary_guardian(uuid, uuid) from public;
revoke all on function public.set_family_primary_guardian(uuid, uuid) from anon;
revoke all on function public.set_family_primary_guardian(uuid, uuid) from authenticated;
grant execute on function public.set_family_primary_guardian(uuid, uuid) to service_role;

commit;
