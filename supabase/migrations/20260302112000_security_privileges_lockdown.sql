-- Enforce post-hardening privileges for sensitive tables + RPCs.
-- Why: Postgres grants EXECUTE on new functions to PUBLIC by default; wrapper recreations can re-open anon access.
-- This migration makes the intended security posture explicit and idempotent.

begin;

-- 1) Tables with RLS disabled must not be readable from client roles
do $$
begin
  if to_regclass('public.roles') is not null then
    execute 'revoke all on table public.roles from PUBLIC';
    execute 'revoke all on table public.roles from anon, authenticated';
    execute 'grant select on table public.roles to service_role';
  end if;

  if to_regclass('public.mv_refresh_state') is not null then
    execute 'revoke all on table public.mv_refresh_state from PUBLIC';
    execute 'revoke all on table public.mv_refresh_state from anon, authenticated';
    execute 'grant select, insert, update, delete on table public.mv_refresh_state to service_role';
  end if;
end $$;

-- 2) Staff-gated RPCs: allow authenticated + service_role, never anon
do $$
begin
  if to_regprocedure('public.search_members(text,text,integer,integer)') is not null then
    execute 'revoke execute on function public.search_members(text,text,integer,integer) from PUBLIC';
    execute 'revoke execute on function public.search_members(text,text,integer,integer) from anon';
    execute 'grant  execute on function public.search_members(text,text,integer,integer) to authenticated';
    execute 'grant  execute on function public.search_members(text,text,integer,integer) to service_role';
  end if;

  if to_regprocedure('public.search_invoices(text,date,date,integer,integer)') is not null then
    execute 'revoke execute on function public.search_invoices(text,date,date,integer,integer) from PUBLIC';
    execute 'revoke execute on function public.search_invoices(text,date,date,integer,integer) from anon';
    execute 'grant  execute on function public.search_invoices(text,date,date,integer,integer) to authenticated';
    execute 'grant  execute on function public.search_invoices(text,date,date,integer,integer) to service_role';
  end if;

  if to_regprocedure('public.admin_list_store_orders(text,text,date,date,integer,integer)') is not null then
    execute 'revoke execute on function public.admin_list_store_orders(text,text,date,date,integer,integer) from PUBLIC';
    execute 'revoke execute on function public.admin_list_store_orders(text,text,date,date,integer,integer) from anon';
    execute 'grant  execute on function public.admin_list_store_orders(text,text,date,date,integer,integer) to authenticated';
    execute 'grant  execute on function public.admin_list_store_orders(text,text,date,date,integer,integer) to service_role';
  end if;

  if to_regprocedure('public.admin_list_store_orders_lite(text,text,date,date,integer,integer)') is not null then
    execute 'revoke execute on function public.admin_list_store_orders_lite(text,text,date,date,integer,integer) from PUBLIC';
    execute 'revoke execute on function public.admin_list_store_orders_lite(text,text,date,date,integer,integer) from anon';
    execute 'grant  execute on function public.admin_list_store_orders_lite(text,text,date,date,integer,integer) to authenticated';
    execute 'grant  execute on function public.admin_list_store_orders_lite(text,text,date,date,integer,integer) to service_role';
  end if;

  if to_regprocedure('public.admin_search_store_products(text,text,text,integer,integer)') is not null then
    execute 'revoke execute on function public.admin_search_store_products(text,text,text,integer,integer) from PUBLIC';
    execute 'revoke execute on function public.admin_search_store_products(text,text,text,integer,integer) from anon';
    execute 'grant  execute on function public.admin_search_store_products(text,text,text,integer,integer) to authenticated';
    execute 'grant  execute on function public.admin_search_store_products(text,text,text,integer,integer) to service_role';
  end if;

  if to_regprocedure('public.admin_search_store_products_lite(text,text,text,integer,integer)') is not null then
    execute 'revoke execute on function public.admin_search_store_products_lite(text,text,text,integer,integer) from PUBLIC';
    execute 'revoke execute on function public.admin_search_store_products_lite(text,text,text,integer,integer) from anon';
    execute 'grant  execute on function public.admin_search_store_products_lite(text,text,text,integer,integer) to authenticated';
    execute 'grant  execute on function public.admin_search_store_products_lite(text,text,text,integer,integer) to service_role';
  end if;

  if to_regprocedure('public.require_staff()') is not null then
    execute 'revoke execute on function public.require_staff() from PUBLIC';
    execute 'revoke execute on function public.require_staff() from anon';
    execute 'grant  execute on function public.require_staff() to authenticated';
    execute 'grant  execute on function public.require_staff() to service_role';
  end if;
end $$;

-- 3) Service-role-only RPCs (maintenance/write)
do $$
begin
  if to_regprocedure('public.scan_and_record(uuid)') is not null then
    execute 'revoke execute on function public.scan_and_record(uuid) from PUBLIC';
    execute 'revoke execute on function public.scan_and_record(uuid) from anon, authenticated';
    execute 'grant  execute on function public.scan_and_record(uuid) to service_role';
  end if;

  if to_regprocedure('public.consume_one_session(uuid)') is not null then
    execute 'revoke execute on function public.consume_one_session(uuid) from PUBLIC';
    execute 'revoke execute on function public.consume_one_session(uuid) from anon, authenticated';
    execute 'grant  execute on function public.consume_one_session(uuid) to service_role';
  end if;

  if to_regprocedure('public.expire_subscriptions()') is not null then
    execute 'revoke execute on function public.expire_subscriptions() from PUBLIC';
    execute 'revoke execute on function public.expire_subscriptions() from anon, authenticated';
    execute 'grant  execute on function public.expire_subscriptions() to service_role';
  end if;

  if to_regprocedure('public.auth_user_id_by_email(text)') is not null then
    execute 'revoke execute on function public.auth_user_id_by_email(text) from PUBLIC';
    execute 'revoke execute on function public.auth_user_id_by_email(text) from anon, authenticated';
    execute 'grant  execute on function public.auth_user_id_by_email(text) to service_role';
  end if;
end $$;

-- 4) Prevent bypass: *_impl functions must never be directly executable
do $$
begin
  if to_regprocedure('public.search_members_impl(text,text,integer,integer)') is not null then
    execute 'revoke execute on function public.search_members_impl(text,text,integer,integer) from PUBLIC';
    execute 'revoke execute on function public.search_members_impl(text,text,integer,integer) from anon, authenticated';
  end if;

  if to_regprocedure('public.search_invoices_impl(text,date,date,integer,integer)') is not null then
    execute 'revoke execute on function public.search_invoices_impl(text,date,date,integer,integer) from PUBLIC';
    execute 'revoke execute on function public.search_invoices_impl(text,date,date,integer,integer) from anon, authenticated';
  end if;

  if to_regprocedure('public.admin_list_store_orders_impl(text,text,date,date,integer,integer)') is not null then
    execute 'revoke execute on function public.admin_list_store_orders_impl(text,text,date,date,integer,integer) from PUBLIC';
    execute 'revoke execute on function public.admin_list_store_orders_impl(text,text,date,date,integer,integer) from anon, authenticated';
  end if;

  if to_regprocedure('public.admin_list_store_orders_lite_impl(text,text,date,date,integer,integer)') is not null then
    execute 'revoke execute on function public.admin_list_store_orders_lite_impl(text,text,date,date,integer,integer) from PUBLIC';
    execute 'revoke execute on function public.admin_list_store_orders_lite_impl(text,text,date,date,integer,integer) from anon, authenticated';
  end if;

  if to_regprocedure('public.admin_search_store_products_impl(text,text,text,integer,integer)') is not null then
    execute 'revoke execute on function public.admin_search_store_products_impl(text,text,text,integer,integer) from PUBLIC';
    execute 'revoke execute on function public.admin_search_store_products_impl(text,text,text,integer,integer) from anon, authenticated';
  end if;

  if to_regprocedure('public.admin_search_store_products_lite_impl(text,text,text,integer,integer)') is not null then
    execute 'revoke execute on function public.admin_search_store_products_lite_impl(text,text,text,integer,integer) from PUBLIC';
    execute 'revoke execute on function public.admin_search_store_products_lite_impl(text,text,text,integer,integer) from anon, authenticated';
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
