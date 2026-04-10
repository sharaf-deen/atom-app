-- Store product images
-- Adds an optional photo to store_products and exposes it through the admin product RPC.

alter table public.store_products
  add column if not exists image_path text;

insert into storage.buckets (id, name, public)
values ('store-product-images', 'store-product-images', true)
on conflict (id) do update set public = true;

drop function if exists public.admin_search_store_products_lite(text, text, text, integer, integer);
drop function if exists public.admin_search_store_products_lite_impl(text, text, text, integer, integer);

create function public.admin_search_store_products_lite_impl(
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
  image_path text,
  created_at timestamptz,
  score double precision,
  has_more boolean
)
language plpgsql
stable
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_q text := nullif(trim(_q), '');
  v_category text := coalesce(nullif(trim(_category), ''), 'all');
  v_active text := coalesce(nullif(trim(_active), ''), 'all');
  v_page int := greatest(coalesce(_page, 1), 1);
  v_page_size int := least(greatest(coalesce(_page_size, 24), 1), 200);
  v_offset int := (v_page - 1) * v_page_size;
  v_limit int := v_page_size + 1;
  v_is_uuid boolean := false;
begin
  if v_q is not null then
    v_is_uuid := v_q ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
  end if;

  return query
  with base as (
    select p.*
    from public.store_products p
    where
      (v_category = 'all' or p.category = v_category)
      and (
        v_active = 'all'
        or (v_active = 'active' and p.is_active = true)
        or (v_active = 'inactive' and p.is_active = false)
      )
      and (
        v_q is null
        or (v_is_uuid and p.id::text = v_q)
        or (lower(p.name) = lower(v_q))
        or (length(v_q) >= 3 and p.search_tsv @@ websearch_to_tsquery('simple', v_q))
        or (p.name ilike ('%' || v_q || '%'))
        or (p.color ilike ('%' || v_q || '%'))
        or (p.size ilike ('%' || v_q || '%'))
        or (p.category ilike ('%' || v_q || '%'))
        or (similarity(coalesce(p.name, ''), v_q) > 0.20)
        or (similarity(coalesce(p.color, ''), v_q) > 0.20)
        or (similarity(coalesce(p.size, ''), v_q) > 0.20)
      )
  ),
  scored as (
    select
      b.id,
      b.category,
      b.name,
      b.color,
      b.size,
      b.price_cents,
      b.currency,
      b.inventory_qty,
      b.is_active,
      b.image_path,
      b.created_at,
      (
        (case when v_q is not null and v_is_uuid and b.id::text = v_q then 1000 else 0 end)
        + (case when v_q is not null and lower(b.name) = lower(v_q) then 900 else 0 end)
        + (case when v_q is not null and length(v_q) >= 3 then 100 * ts_rank_cd(b.search_tsv, websearch_to_tsquery('simple', v_q)) else 0 end)
        + greatest(
            similarity(coalesce(b.name, ''), coalesce(v_q, '')),
            similarity(coalesce(b.color, ''), coalesce(v_q, '')),
            similarity(coalesce(b.size, ''), coalesce(v_q, ''))
          )
      )::double precision as score
    from base b
  ),
  data as (
    select *
    from scored
    order by score desc, created_at desc
    offset v_offset
    limit v_limit
  ),
  sliced as (
    select *
    from data
    limit v_page_size
  ),
  more as (
    select exists(select 1 from data offset v_page_size) as has_more
  )
  select
    s.id,
    s.category,
    s.name,
    s.color,
    s.size,
    s.price_cents,
    s.currency,
    s.inventory_qty,
    s.is_active,
    s.image_path,
    s.created_at,
    s.score,
    m.has_more
  from sliced s
  cross join more m
  order by s.score desc, s.created_at desc;
end;
$$;

create function public.admin_search_store_products_lite(
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
  image_path text,
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

revoke execute on function public.admin_search_store_products_lite(text, text, text, integer, integer) from public;
revoke execute on function public.admin_search_store_products_lite(text, text, text, integer, integer) from anon;
grant execute on function public.admin_search_store_products_lite(text, text, text, integer, integer) to authenticated;
grant execute on function public.admin_search_store_products_lite(text, text, text, integer, integer) to service_role;

revoke execute on function public.admin_search_store_products_lite_impl(text, text, text, integer, integer) from public;
revoke execute on function public.admin_search_store_products_lite_impl(text, text, text, integer, integer) from anon;
revoke execute on function public.admin_search_store_products_lite_impl(text, text, text, integer, integer) from authenticated;
grant execute on function public.admin_search_store_products_lite_impl(text, text, text, integer, integer) to service_role;
