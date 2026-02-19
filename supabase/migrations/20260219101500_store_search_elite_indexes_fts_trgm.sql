-- 20260219101500_store_search_elite_indexes_fts_trgm.sql
-- Elite search performance for /admin/store and /store
-- - pg_trgm indexes for fast ILIKE %...% searches
-- - Generated tsvector columns + GIN indexes for FTS (websearch)
-- - Composite indexes for common filters/orderings
-- - Upgrade admin_list_store_orders RPC to leverage profiles.search_tsv (FTS)

begin;

-- Extensions (Supabase standard schema: extensions)
create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;

-- PROFILES: generated FTS vector + indexes
alter table public.profiles
  add column if not exists search_tsv tsvector
  generated always as (
    to_tsvector(
      'simple',
      coalesce(member_id,'') || ' ' ||
      coalesce(email,'') || ' ' ||
      coalesce(first_name,'') || ' ' ||
      coalesce(last_name,'') || ' ' ||
      coalesce(phone,'')
    )
  ) stored;

create index if not exists profiles_search_tsv_idx
  on public.profiles using gin (search_tsv);

create index if not exists profiles_email_trgm_idx
  on public.profiles using gin (email gin_trgm_ops);
create index if not exists profiles_first_name_trgm_idx
  on public.profiles using gin (first_name gin_trgm_ops);
create index if not exists profiles_last_name_trgm_idx
  on public.profiles using gin (last_name gin_trgm_ops);
create index if not exists profiles_member_id_trgm_idx
  on public.profiles using gin (member_id gin_trgm_ops);

-- STORE PRODUCTS: generated FTS vector + indexes
alter table public.store_products
  add column if not exists search_tsv tsvector
  generated always as (
    to_tsvector(
      'simple',
      coalesce(category,'') || ' ' ||
      coalesce(name,'') || ' ' ||
      coalesce(color,'') || ' ' ||
      coalesce(size,'')
    )
  ) stored;

create index if not exists store_products_search_tsv_idx
  on public.store_products using gin (search_tsv);

create index if not exists store_products_name_trgm_idx
  on public.store_products using gin (name gin_trgm_ops);
create index if not exists store_products_color_trgm_idx
  on public.store_products using gin (color gin_trgm_ops);
create index if not exists store_products_size_trgm_idx
  on public.store_products using gin (size gin_trgm_ops);
create index if not exists store_products_category_trgm_idx
  on public.store_products using gin (category gin_trgm_ops);

-- Common filter/order indexes
create index if not exists store_orders_status_created_at_desc_idx
  on public.store_orders (status, created_at desc);

create index if not exists store_products_cat_active_created_at_desc_idx
  on public.store_products (category, is_active, created_at desc);

-- Upgrade admin_list_store_orders to leverage profiles.search_tsv (FTS)
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
set search_path = public
as $$
declare
  v_q text := nullif(trim(_q), '');
  v_status text := coalesce(nullif(trim(_status), ''), 'all');
  v_page int := greatest(coalesce(_page, 1), 1);
  v_page_size int := least(greatest(coalesce(_page_size, 20), 1), 200);
  v_offset int := (v_page - 1) * v_page_size;
begin
  return query
  with base as (
    select
      o.id,
      o.status,
      o.total_cents,
      coalesce(o.discount_pct, o.discount_percent, 0) as discount_pct,
      coalesce(o.preferred_payment, o.payment_method, 'cash') as payment,
      nullif(coalesce(o.note, o.notes, ''), '') as note,
      o.created_at,
      coalesce(o.owner_uid, o.created_by, o.user_id, o.member_id) as buyer_id
    from public.store_orders o
    where
      (v_status = 'all' or o.status = v_status)
      and (_from_date is null or o.created_at >= (_from_date::timestamptz))
      and (_to_date is null or o.created_at < ((_to_date + 1)::timestamptz))
      and (
        v_q is null
        or (o.id::text = v_q)
        or (coalesce(o.owner_uid, o.created_by, o.user_id, o.member_id)::text = v_q)
        or exists (
          select 1
          from public.profiles pr
          where pr.user_id = coalesce(o.owner_uid, o.created_by, o.user_id, o.member_id)
            and (
              -- FTS for longer queries (fast with GIN)
              (length(v_q) >= 3 and pr.search_tsv @@ websearch_to_tsquery('simple', v_q))
              -- Fallback substring matches (fast with trgm)
              or (pr.first_name is not null and pr.first_name ilike ('%' || v_q || '%'))
              or (pr.last_name is not null and pr.last_name ilike ('%' || v_q || '%'))
              or (pr.email is not null and pr.email ilike ('%' || v_q || '%'))
              or (pr.member_id is not null and pr.member_id ilike ('%' || v_q || '%'))
            )
        )
      )
  ),
  joined as (
    select
      b.*,
      pr.member_id as buyer_member_id,
      pr.email as buyer_email,
      pr.first_name as buyer_first_name,
      pr.last_name as buyer_last_name
    from base b
    left join public.profiles pr on pr.user_id = b.buyer_id
  ),
  counted as (
    select j.*, count(*) over() as total_count
    from joined j
  )
  select
    c.id,
    c.status,
    c.total_cents,
    c.discount_pct,
    c.payment,
    c.note,
    c.created_at,
    c.buyer_id as buyer_user_id,
    c.buyer_member_id,
    c.buyer_email,
    c.buyer_first_name,
    c.buyer_last_name,
    (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', i.id,
            'product_id', i.product_id,
            'name', coalesce(i.name, 'Item'),
            'qty', i.qty,
            'unit_price_cents', i.unit_price_cents,
            'currency', coalesce(i.currency, 'EGP')
          )
          order by i.id
        ),
        '[]'::jsonb
      )
      from public.store_order_items i
      where i.order_id = c.id
    ) as items,
    c.total_count
  from counted c
  order by c.created_at desc
  offset v_offset
  limit v_page_size;
end;
$$;

revoke all on function public.admin_list_store_orders(text, text, date, date, integer, integer) from anon, authenticated;
grant execute on function public.admin_list_store_orders(text, text, date, date, integer, integer) to service_role;

-- Update planner stats
analyze public.profiles;
analyze public.store_products;
analyze public.store_orders;
analyze public.store_order_items;

commit;
