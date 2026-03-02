-- 20260302094500_rpc_security_hardening.sql
-- Hardening: lock down sensitive SECURITY DEFINER RPCs and add staff gate wrappers.
-- Goals:
-- 1) No anon access to admin/search RPCs.
-- 2) Prevent non-staff authenticated users from calling admin/search RPCs (even if they guess RPC names).
-- 3) Restrict "write/maintenance" RPCs to service_role only (kiosk/cron/server routes).
--
-- Notes:
-- - We avoid blanket REVOKE on all functions to not break any anon policies unexpectedly.
-- - We wrap existing functions by renaming them to *_impl and recreating the original name as a guarded wrapper.
-- - We revoke EXECUTE on *_impl to prevent bypassing the guard.

begin;

-- ---------------------------------------------------------------------
-- 0) Tables with RLS disabled must not be accessible from client roles
-- ---------------------------------------------------------------------
do $$
begin
  if to_regclass('public.roles') is not null then
    execute 'revoke all on table public.roles from anon, authenticated';
  end if;

  if to_regclass('public.mv_refresh_state') is not null then
    execute 'revoke all on table public.mv_refresh_state from anon, authenticated';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1) Helper: require_staff() gate (used by guarded wrappers)
-- ---------------------------------------------------------------------
create or replace function public.require_staff()
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
      and p.role = any (array['reception','admin','super_admin'])
  ) then
    raise exception 'forbidden';
  end if;
end;
$$;

-- Do not allow anon to probe this directly
revoke execute on function public.require_staff() from public;
grant execute on function public.require_staff() to authenticated;

-- ---------------------------------------------------------------------
-- 2) Guarded wrappers: search_members, search_invoices, admin store RPCs
-- ---------------------------------------------------------------------

-- search_members(text,text,int,int) -> search_members_impl(...)
do $$
begin
  if to_regprocedure('public.search_members(text,text,integer,integer)') is not null
     and to_regprocedure('public.search_members_impl(text,text,integer,integer)') is null then
    execute 'alter function public.search_members(text,text,integer,integer) rename to search_members_impl';
  end if;
end $$;

create or replace function public.search_members(
  q text,
  status text default 'all',
  page integer default 1,
  page_size integer default 20
)
returns table (
  user_id uuid,
  member_id text,
  email text,
  first_name text,
  last_name text,
  phone text,
  role text,
  is_active boolean,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public, extensions, pg_catalog
as $$
begin
  perform public.require_staff();
  return query
    select * from public.search_members_impl(q, status, page, page_size);
end;
$$;

revoke execute on function public.search_members(text,text,integer,integer) from public;
grant  execute on function public.search_members(text,text,integer,integer) to authenticated;

do $$
begin
  if to_regprocedure('public.search_members_impl(text,text,integer,integer)') is not null then
    execute 'revoke execute on function public.search_members_impl(text,text,integer,integer) from public';
  end if;
end $$;

-- search_invoices(text,date,date,int,int) -> search_invoices_impl(...)
do $$
begin
  if to_regprocedure('public.search_invoices(text,date,date,integer,integer)') is not null
     and to_regprocedure('public.search_invoices_impl(text,date,date,integer,integer)') is null then
    execute 'alter function public.search_invoices(text,date,date,integer,integer) rename to search_invoices_impl';
  end if;
end $$;

create or replace function public.search_invoices(
  q text,
  from_date date default null,
  to_date date default null,
  page integer default 1,
  page_size integer default 50
)
returns table (
  id uuid,
  invoice_number text,
  member_user_id uuid,
  amount numeric,
  currency text,
  paid_at timestamptz,
  first_name text,
  last_name text,
  email text,
  member_code text,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public, extensions, pg_catalog
as $$
begin
  perform public.require_staff();
  return query
    select * from public.search_invoices_impl(q, from_date, to_date, page, page_size);
end;
$$;

revoke execute on function public.search_invoices(text,date,date,integer,integer) from public;
grant  execute on function public.search_invoices(text,date,date,integer,integer) to authenticated;

do $$
begin
  if to_regprocedure('public.search_invoices_impl(text,date,date,integer,integer)') is not null then
    execute 'revoke execute on function public.search_invoices_impl(text,date,date,integer,integer) from public';
  end if;
end $$;

-- admin_list_store_orders(text,text,date,date,int,int) -> admin_list_store_orders_impl(...)
do $$
begin
  if to_regprocedure('public.admin_list_store_orders(text,text,date,date,integer,integer)') is not null
     and to_regprocedure('public.admin_list_store_orders_impl(text,text,date,date,integer,integer)') is null then
    execute 'alter function public.admin_list_store_orders(text,text,date,date,integer,integer) rename to admin_list_store_orders_impl';
  end if;
end $$;

create or replace function public.admin_list_store_orders(
  _q text default '',
  _status text default 'all',
  _from_date date default null,
  _to_date date default null,
  _page integer default 1,
  _page_size integer default 20
)
returns table (
  id uuid,
  status text,
  total_cents integer,
  discount_pct integer,
  payment text,
  note text,
  created_at timestamptz,
  buyer_user_id uuid,
  buyer_member_id text,
  buyer_email text,
  buyer_first_name text,
  buyer_last_name text,
  items jsonb,
  total_count integer
)
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
begin
  perform public.require_staff();
  return query
    select * from public.admin_list_store_orders_impl(_q, _status, _from_date, _to_date, _page, _page_size);
end;
$$;

revoke execute on function public.admin_list_store_orders(text,text,date,date,integer,integer) from public;
grant  execute on function public.admin_list_store_orders(text,text,date,date,integer,integer) to authenticated;

do $$
begin
  if to_regprocedure('public.admin_list_store_orders_impl(text,text,date,date,integer,integer)') is not null then
    execute 'revoke execute on function public.admin_list_store_orders_impl(text,text,date,date,integer,integer) from public';
  end if;
end $$;

-- admin_search_store_products(text,text,text,int,int) -> admin_search_store_products_impl(...)
do $$
begin
  if to_regprocedure('public.admin_search_store_products(text,text,text,integer,integer)') is not null
     and to_regprocedure('public.admin_search_store_products_impl(text,text,text,integer,integer)') is null then
    execute 'alter function public.admin_search_store_products(text,text,text,integer,integer) rename to admin_search_store_products_impl';
  end if;
end $$;

create or replace function public.admin_search_store_products(
  _q text default '',
  _category text default 'all',
  _active text default 'all',
  _page integer default 1,
  _page_size integer default 24
)
returns table (
  id uuid,
  category text,
  name text,
  color text,
  size text,
  price_cents integer,
  currency text,
  inventory_qty integer,
  is_active boolean,
  created_at timestamptz,
  score double precision,
  total_count integer
)
language plpgsql
stable
security definer
set search_path = public, extensions, pg_catalog
as $$
begin
  perform public.require_staff();
  return query
    select * from public.admin_search_store_products_impl(_q, _category, _active, _page, _page_size);
end;
$$;

revoke execute on function public.admin_search_store_products(text,text,text,integer,integer) from public;
grant  execute on function public.admin_search_store_products(text,text,text,integer,integer) to authenticated;

do $$
begin
  if to_regprocedure('public.admin_search_store_products_impl(text,text,text,integer,integer)') is not null then
    execute 'revoke execute on function public.admin_search_store_products_impl(text,text,text,integer,integer) from public';
  end if;
end $$;

-- Lite variants (has_more pagination)

-- admin_list_store_orders_lite(text,text,date,date,int,int) -> admin_list_store_orders_lite_impl(...)
do $$
begin
  if to_regprocedure('public.admin_list_store_orders_lite(text,text,date,date,integer,integer)') is not null
     and to_regprocedure('public.admin_list_store_orders_lite_impl(text,text,date,date,integer,integer)') is null then
    execute 'alter function public.admin_list_store_orders_lite(text,text,date,date,integer,integer) rename to admin_list_store_orders_lite_impl';
  end if;
end $$;

create or replace function public.admin_list_store_orders_lite(
  _q text default '',
  _status text default 'all',
  _from_date date default null,
  _to_date date default null,
  _page integer default 1,
  _page_size integer default 20
)
returns table (
  id uuid,
  status text,
  total_cents integer,
  discount_pct integer,
  payment text,
  note text,
  created_at timestamptz,
  buyer_user_id uuid,
  buyer_member_id text,
  buyer_email text,
  buyer_first_name text,
  buyer_last_name text,
  items jsonb,
  has_more boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
begin
  perform public.require_staff();
  return query
    select * from public.admin_list_store_orders_lite_impl(_q, _status, _from_date, _to_date, _page, _page_size);
end;
$$;

revoke execute on function public.admin_list_store_orders_lite(text,text,date,date,integer,integer) from public;
grant  execute on function public.admin_list_store_orders_lite(text,text,date,date,integer,integer) to authenticated;

do $$
begin
  if to_regprocedure('public.admin_list_store_orders_lite_impl(text,text,date,date,integer,integer)') is not null then
    execute 'revoke execute on function public.admin_list_store_orders_lite_impl(text,text,date,date,integer,integer) from public';
  end if;
end $$;

-- admin_search_store_products_lite(text,text,text,int,int) -> admin_search_store_products_lite_impl(...)
do $$
begin
  if to_regprocedure('public.admin_search_store_products_lite(text,text,text,integer,integer)') is not null
     and to_regprocedure('public.admin_search_store_products_lite_impl(text,text,text,integer,integer)') is null then
    execute 'alter function public.admin_search_store_products_lite(text,text,text,integer,integer) rename to admin_search_store_products_lite_impl';
  end if;
end $$;

create or replace function public.admin_search_store_products_lite(
  _q text default '',
  _category text default 'all',
  _active text default 'all',
  _page integer default 1,
  _page_size integer default 24
)
returns table (
  id uuid,
  category text,
  name text,
  color text,
  size text,
  price_cents integer,
  currency text,
  inventory_qty integer,
  is_active boolean,
  created_at timestamptz,
  score double precision,
  has_more boolean
)
language plpgsql
stable
security definer
set search_path = public, extensions, pg_catalog
as $$
begin
  perform public.require_staff();
  return query
    select * from public.admin_search_store_products_lite_impl(_q, _category, _active, _page, _page_size);
end;
$$;

revoke execute on function public.admin_search_store_products_lite(text,text,text,integer,integer) from public;
grant  execute on function public.admin_search_store_products_lite(text,text,text,integer,integer) to authenticated;

do $$
begin
  if to_regprocedure('public.admin_search_store_products_lite_impl(text,text,text,integer,integer)') is not null then
    execute 'revoke execute on function public.admin_search_store_products_lite_impl(text,text,text,integer,integer) from public';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 3) Maintenance / write RPCs: service_role only
-- ---------------------------------------------------------------------

-- Kiosk scan / decrement sessions / expiry job: never callable from client
do $$
begin
  if to_regprocedure('public.scan_and_record(uuid)') is not null then
    execute 'revoke execute on function public.scan_and_record(uuid) from public';
    execute 'grant execute on function public.scan_and_record(uuid) to service_role';
  end if;

  if to_regprocedure('public.consume_one_session(uuid)') is not null then
    execute 'revoke execute on function public.consume_one_session(uuid) from public';
    execute 'grant execute on function public.consume_one_session(uuid) to service_role';
  end if;

  if to_regprocedure('public.expire_subscriptions()') is not null then
    execute 'revoke execute on function public.expire_subscriptions() from public';
    execute 'grant execute on function public.expire_subscriptions() to service_role';
  end if;

  if to_regprocedure('public.auth_user_id_by_email(text)') is not null then
    execute 'revoke execute on function public.auth_user_id_by_email(text) from public';
    execute 'grant execute on function public.auth_user_id_by_email(text) to service_role';
  end if;

  if to_regprocedure('public.generate_member_id()') is not null then
    execute 'revoke execute on function public.generate_member_id() from public';
    execute 'grant execute on function public.generate_member_id() to service_role';
  end if;

  if to_regprocedure('public.next_member_number()') is not null then
    execute 'revoke execute on function public.next_member_number() from public';
    execute 'grant execute on function public.next_member_number() to service_role';
  end if;

  if to_regprocedure('public.handle_new_user()') is not null then
    execute 'revoke execute on function public.handle_new_user() from public';
    execute 'grant execute on function public.handle_new_user() to service_role';
  end if;

  if to_regprocedure('public.reserve_email_audit(text,text,uuid,uuid,inet,text,integer,integer)') is not null then
    execute 'revoke execute on function public.reserve_email_audit(text,text,uuid,uuid,inet,text,integer,integer) from public';
    execute 'grant execute on function public.reserve_email_audit(text,text,uuid,uuid,inet,text,integer,integer) to service_role';
  end if;

  if to_regprocedure('public.finalize_email_audit(bigint,boolean,text,uuid)') is not null then
    execute 'revoke execute on function public.finalize_email_audit(bigint,boolean,text,uuid) from public';
    execute 'grant execute on function public.finalize_email_audit(bigint,boolean,text,uuid) to service_role';
  end if;
end $$;

commit;
