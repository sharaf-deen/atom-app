-- 20260305120000_admin_set_user_role_rpc.sql
-- Super-admin only: change a user's role via a DB-guarded SECURITY DEFINER RPC.
-- Used by Admin UI (admin/members).

begin;

-- Helper: require_super_admin() gate
create or replace function public.require_super_admin()
returns void
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
begin
  if auth.uid() is null then
    raise exception 'unauthorized';
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.user_id = auth.uid()
      and p.role = 'super_admin'
  ) then
    raise exception 'forbidden';
  end if;
end;
$$;

revoke execute on function public.require_super_admin() from public;
revoke execute on function public.require_super_admin() from anon;
grant  execute on function public.require_super_admin() to authenticated;
grant  execute on function public.require_super_admin() to service_role;

-- Main RPC
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
  cast_role public.user_role;
begin
  actor := auth.uid();
  perform public.require_super_admin();

  if target_user_id is null then
    raise exception 'missing_target_user_id';
  end if;

  if target_user_id = actor then
    raise exception 'cannot_change_own_role';
  end if;

  -- Validate against reference table (id/label)
  if not exists (select 1 from public.roles r where r.id = new_role) then
    raise exception 'invalid_role';
  end if;

  -- Validate enum cast
  cast_role := new_role::public.user_role;

  update public.profiles
    set role = cast_role
  where user_id = target_user_id;

  if not found then
    raise exception 'target_not_found';
  end if;

  insert into public.audit_logs (actor_user_id, target_user_id, action, action_details)
  values (
    actor,
    target_user_id,
    'set_role',
    jsonb_build_object('role', new_role)
  );

  return jsonb_build_object('ok', true, 'user_id', target_user_id, 'role', new_role);
end;
$$;

revoke execute on function public.admin_set_user_role(uuid, text) from public;
revoke execute on function public.admin_set_user_role(uuid, text) from anon;
grant  execute on function public.admin_set_user_role(uuid, text) to authenticated;
grant  execute on function public.admin_set_user_role(uuid, text) to service_role;

commit;
