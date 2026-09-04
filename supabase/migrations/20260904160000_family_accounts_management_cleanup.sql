-- Family Accounts Lot 1E — Family & Guardian management cleanup/polish
-- Adds service-role-only helpers to preview and safely remove an unnecessary
-- guardian member profile without deleting the guardian Auth account.
-- A cleanup is blocked whenever any profile foreign-key dependency exists,
-- except the family_members link which is intentionally removed by profile cascade.

begin;

create or replace function public.family_guardian_member_cleanup_preview(
  p_auth_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_profile public.profiles%rowtype;
  v_profile_user_id_attnum smallint;
  v_dependency_count integer := 0;
  v_dependencies jsonb := '[]'::jsonb;
  v_has_family_member_link boolean := false;
  v_exists boolean;
  v_rec record;
begin
  if p_auth_user_id is null then
    raise exception 'INVALID_AUTH_USER_ID';
  end if;

  if not exists (
    select 1
    from public.family_guardians fg
    where fg.auth_user_id = p_auth_user_id
  ) then
    raise exception 'GUARDIAN_NOT_FOUND';
  end if;

  select p.*
  into v_profile
  from public.profiles p
  where p.user_id = p_auth_user_id;

  if not found then
    return jsonb_build_object(
      'has_profile', false,
      'can_remove', false,
      'reason', 'NO_MEMBER_PROFILE',
      'dependencies', '[]'::jsonb,
      'has_family_member_link', false
    );
  end if;

  if coalesce(v_profile.role::text, 'member') <> 'member' then
    return jsonb_build_object(
      'has_profile', true,
      'can_remove', false,
      'reason', 'PROFILE_ROLE_NOT_MEMBER',
      'role', v_profile.role,
      'member_id', v_profile.member_id,
      'email', v_profile.email,
      'dependencies', '[]'::jsonb,
      'has_family_member_link',
        exists (
          select 1 from public.family_members fm
          where fm.member_id = p_auth_user_id
        )
    );
  end if;

  select exists (
    select 1
    from public.family_members fm
    where fm.member_id = p_auth_user_id
  )
  into v_has_family_member_link;

  select a.attnum
  into v_profile_user_id_attnum
  from pg_catalog.pg_attribute a
  where a.attrelid = 'public.profiles'::regclass
    and a.attname = 'user_id'
    and not a.attisdropped;

  for v_rec in
    select
      ns.nspname as schema_name,
      rel.relname as table_name,
      child_att.attname as column_name
    from pg_catalog.pg_constraint c
    join pg_catalog.pg_class rel
      on rel.oid = c.conrelid
    join pg_catalog.pg_namespace ns
      on ns.oid = rel.relnamespace
    join pg_catalog.pg_attribute child_att
      on child_att.attrelid = c.conrelid
      and child_att.attnum = c.conkey[1]
    where c.contype = 'f'
      and c.confrelid = 'public.profiles'::regclass
      and array_length(c.conkey, 1) = 1
      and array_length(c.confkey, 1) = 1
      and c.confkey[1] = v_profile_user_id_attnum
      and not (
        ns.nspname = 'public'
        and rel.relname = 'family_members'
        and child_att.attname = 'member_id'
      )
    order by ns.nspname, rel.relname, child_att.attname
  loop
    execute format(
      'select exists (select 1 from %I.%I where %I = $1 limit 1)',
      v_rec.schema_name,
      v_rec.table_name,
      v_rec.column_name
    )
    into v_exists
    using p_auth_user_id;

    if v_exists then
      v_dependency_count := v_dependency_count + 1;
      v_dependencies := v_dependencies || jsonb_build_array(
        jsonb_build_object(
          'table', v_rec.table_name,
          'column', v_rec.column_name
        )
      );
    end if;
  end loop;

  return jsonb_build_object(
    'has_profile', true,
    'can_remove', v_dependency_count = 0,
    'reason', case when v_dependency_count = 0 then null else 'PROFILE_HAS_DEPENDENCIES' end,
    'role', v_profile.role,
    'member_id', v_profile.member_id,
    'email', v_profile.email,
    'first_name', v_profile.first_name,
    'last_name', v_profile.last_name,
    'has_family_member_link', v_has_family_member_link,
    'dependency_count', v_dependency_count,
    'dependencies', v_dependencies
  );
end;
$$;

create or replace function public.family_guardian_remove_unused_member_profile(
  p_auth_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_preview jsonb;
  v_deleted_member_id text;
begin
  v_preview := public.family_guardian_member_cleanup_preview(p_auth_user_id);

  if coalesce((v_preview->>'has_profile')::boolean, false) is not true then
    raise exception 'NO_MEMBER_PROFILE';
  end if;

  if coalesce((v_preview->>'can_remove')::boolean, false) is not true then
    raise exception 'MEMBER_PROFILE_HAS_DEPENDENCIES: %',
      coalesce(v_preview->'dependencies', '[]'::jsonb)::text;
  end if;

  select p.member_id
  into v_deleted_member_id
  from public.profiles p
  where p.user_id = p_auth_user_id
  for update;

  delete from public.profiles
  where user_id = p_auth_user_id;

  if not found then
    raise exception 'MEMBER_PROFILE_NOT_FOUND';
  end if;

  return jsonb_build_object(
    'removed', true,
    'auth_user_id', p_auth_user_id,
    'member_id', v_deleted_member_id,
    'auth_account_deleted', false,
    'guardian_links_deleted', false
  );
end;
$$;

revoke all on function public.family_guardian_member_cleanup_preview(uuid) from public;
revoke all on function public.family_guardian_member_cleanup_preview(uuid) from anon;
revoke all on function public.family_guardian_member_cleanup_preview(uuid) from authenticated;
grant execute on function public.family_guardian_member_cleanup_preview(uuid) to service_role;

revoke all on function public.family_guardian_remove_unused_member_profile(uuid) from public;
revoke all on function public.family_guardian_remove_unused_member_profile(uuid) from anon;
revoke all on function public.family_guardian_remove_unused_member_profile(uuid) from authenticated;
grant execute on function public.family_guardian_remove_unused_member_profile(uuid) to service_role;

commit;
