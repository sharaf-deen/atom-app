-- Fix admin_set_user_role to use public.roles instead of legacy public.user_role enum

create or replace function public.admin_set_user_role(
  target_user_id uuid,
  new_role text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_catalog
as $$
declare
  actor uuid;
begin
  actor := auth.uid();

  perform public.require_super_admin();

  if target_user_id is null then
    raise exception 'missing_target_user_id';
  end if;

  if coalesce(trim(new_role), '') = '' then
    raise exception 'missing_role';
  end if;

  if target_user_id = actor then
    raise exception 'cannot_change_own_role';
  end if;

  if not exists (
    select 1
    from public.roles r
    where r.id = new_role
  ) then
    raise exception 'invalid_role';
  end if;

  update public.profiles
  set role = new_role
  where user_id = target_user_id;

  if not found then
    raise exception 'target_not_found';
  end if;

  insert into public.audit_logs (
    actor_user_id,
    target_user_id,
    action,
    action_details
  )
  values (
    actor,
    target_user_id,
    'set_role',
    jsonb_build_object('role', new_role)
  );

  return jsonb_build_object(
    'ok', true,
    'user_id', target_user_id,
    'role', new_role
  );
end;
$$;

revoke execute on function public.admin_set_user_role(uuid, text) from public;
revoke execute on function public.admin_set_user_role(uuid, text) from anon;
grant execute on function public.admin_set_user_role(uuid, text) to authenticated;
grant execute on function public.admin_set_user_role(uuid, text) to service_role;