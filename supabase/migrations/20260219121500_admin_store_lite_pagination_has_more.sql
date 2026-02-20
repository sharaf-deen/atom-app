-- 20260219121500_admin_store_lite_pagination_has_more.sql
-- Pro+Security optimization:
-- - Reduce payload: orders/items "lite" and products minimal columns
-- - Avoid expensive count(*) over() using has_more pagination (page_size + 1 strategy)
-- Notes:
-- - Keeps existing RPCs for backward compatibility.
-- - These functions are service_role only.

begin;

-- -----------------------------
-- Orders: lite list with has_more
-- -----------------------------
drop function if exists public.admin_list_store_orders_lite(text, text, date, date, integer, integer);

create function public.admin_list_store_orders_lite(
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
set search_path = public
as $$
declare
  v_q text := nullif(trim(_q), '');
  v_status text := coalesce(nullif(trim(_status), ''), 'all');
  v_page int := greatest(coalesce(_page, 1), 1);
  v_page_size int := least(greatest(coalesce(_page_size, 20), 1), 200);
  v_offset int := (v_page - 1) * v_page_size;
  v_limit int := v_page_size + 1;
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

        -- Buyer profile search
        or exists (
          select 1
          from public.profiles pr
          where pr.user_id = coalesce(o.owner_uid, o.created_by, o.user_id, o.member_id)
            and (
              (length(v_q) >= 3 and pr.search_tsv @@ websearch_to_tsquery('simple', v_q))
              or (pr.first_name is not null and pr.first_name ilike ('%' || v_q || '%'))
              or (pr.last_name is not null and pr.last_name ilike ('%' || v_q || '%'))
              or (pr.email is not null and pr.email ilike ('%' || v_q || '%'))
              or (pr.member_id is not null and pr.member_id ilike ('%' || v_q || '%'))
            )
        )

        -- Product / item search (by name)
        or exists (
          select 1
          from public.store_order_items i
          left join public.store_products p on p.id = i.product_id
          where i.order_id = o.id
            and (
              (i.name is not null and i.name ilike ('%' || v_q || '%'))
              or (p.name is not null and p.name ilike ('%' || v_q || '%'))
              or (length(v_q) >= 3 and p.search_tsv @@ websearch_to_tsquery('simple', v_q))
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
  data as (
    select *
    from joined
    order by created_at desc
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
    s.status,
    s.total_cents,
    s.discount_pct,
    s.payment,
    s.note,
    s.created_at,
    s.buyer_id as buyer_user_id,
    s.buyer_member_id,
    s.buyer_email,
    s.buyer_first_name,
    s.buyer_last_name,
    (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', i.id,
            'product_id', i.product_id,
            'name', coalesce(i.name, 'Item'),
            'qty', i.qty
          )
          order by i.id
        ),
        '[]'::jsonb
      )
      from public.store_order_items i
      where i.order_id = s.id
    ) as items,
    m.has_more
  from sliced s
  cross join more m
  order by s.created_at desc;
end;
$$;

revoke all on function public.admin_list_store_orders_lite(text, text, date, date, integer, integer) from anon, authenticated;
grant execute on function public.admin_list_store_orders_lite(text, text, date, date, integer, integer) to service_role;

-- ----------------------------------------
-- Products: lite search with ranking + has_more
-- ----------------------------------------
drop function if exists public.admin_search_store_products_lite(text, text, text, integer, integer);

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
  created_at timestamptz,
  score double precision,
  has_more boolean
)
language plpgsql
stable
security definer
set search_path = public
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
    v_is_uuid := v_q ~* '^[0-9a-f]8-[0-9a-f]4-[1-5][0-9a-f]3-[89ab][0-9a-f]3-[0-9a-f]12$';
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
        or (similarity(coalesce(p.name,''), v_q) > 0.20)
        or (similarity(coalesce(p.color,''), v_q) > 0.20)
        or (similarity(coalesce(p.size,''), v_q) > 0.20)
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
      b.created_at,
      (
        (case when v_q is not null and v_is_uuid and b.id::text = v_q then 1000 else 0 end)
        + (case when v_q is not null and lower(b.name) = lower(v_q) then 900 else 0 end)
        + (case when v_q is not null and length(v_q) >= 3 then 100 * ts_rank_cd(b.search_tsv, websearch_to_tsquery('simple', v_q)) else 0 end)
        + greatest(
            similarity(coalesce(b.name,''), coalesce(v_q,'')),
            similarity(coalesce(b.color,''), coalesce(v_q,'')),
            similarity(coalesce(b.size,''), coalesce(v_q,''))
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
    s.created_at,
    s.score,
    m.has_more
  from sliced s
  cross join more m
  order by s.score desc, s.created_at desc;
end;
$$;

revoke all on function public.admin_search_store_products_lite(text, text, text, integer, integer) from anon, authenticated;
grant execute on function public.admin_search_store_products_lite(text, text, text, integer, integer) to service_role;

analyze public.store_products;
analyze public.store_orders;
analyze public.store_order_items;

commit;
