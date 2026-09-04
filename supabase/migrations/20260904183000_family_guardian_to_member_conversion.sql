-- Family Accounts — Guardian -> Member conversion
-- Promotes an existing guardian-only Auth account into a real ATOM member
-- without creating a second Auth user or duplicate email.
-- The guardian link and existing login remain intact.

begin;

create or replace function public.family_guardian_promote_to_member(
  p_family_id uuid,
  p_auth_user_id uuid,
  p_added_by uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_guardian public.family_guardians%rowtype;
  v_profile public.profiles%rowtype;
begin
  if p_family_id is null or p_auth_user_id is null then
    raise exception 'INVALID_ID';
  end if;

  select fg.*
  into v_guardian
  from public.family_guardians fg
  where fg.family_id = p_family_id
    and fg.auth_user_id = p_auth_user_id
  for update;

  if not found then
    raise exception 'GUARDIAN_NOT_FOUND';
  end if;

  if exists (
    select 1
    from public.profiles p
    where p.user_id = p_auth_user_id
  ) then
    raise exception 'GUARDIAN_ALREADY_HAS_PROFILE';
  end if;

  if exists (
    select 1
    from public.profiles p
    where p.email is not null
      and btrim(p.email) <> ''
      and lower(btrim(p.email)) = lower(btrim(v_guardian.email))
      and p.user_id <> p_auth_user_id
  ) then
    raise exception 'GUARDIAN_EMAIL_ALREADY_USED_BY_MEMBER_PROFILE';
  end if;

  insert into public.profiles (
    user_id,
    email,
    first_name,
    last_name,
    phone,
    role,
    qr_code
  )
  values (
    p_auth_user_id,
    lower(btrim(v_guardian.email)),
    nullif(btrim(coalesce(v_guardian.first_name, '')), ''),
    nullif(btrim(coalesce(v_guardian.last_name, '')), ''),
    nullif(btrim(coalesce(v_guardian.phone, '')), ''),
    'member',
    'atom:' || p_auth_user_id::text
  )
  returning *
  into v_profile;

  insert into public.family_members (
    member_id,
    family_id,
    added_by
  )
  values (
    p_auth_user_id,
    p_family_id,
    p_added_by
  );

  return jsonb_build_object(
    'user_id', v_profile.user_id,
    'member_id', v_profile.member_id,
    'email', v_profile.email,
    'first_name', v_profile.first_name,
    'last_name', v_profile.last_name,
    'phone', v_profile.phone,
    'role', v_profile.role,
    'qr_code', v_profile.qr_code,
    'family_id', p_family_id,
    'auth_account_created', false,
    'guardian_link_preserved', true
  );
end;
$$;

revoke all on function public.family_guardian_promote_to_member(uuid, uuid, uuid) from public;
revoke all on function public.family_guardian_promote_to_member(uuid, uuid, uuid) from anon;
revoke all on function public.family_guardian_promote_to_member(uuid, uuid, uuid) from authenticated;
grant execute on function public.family_guardian_promote_to_member(uuid, uuid, uuid) to service_role;

commit;
