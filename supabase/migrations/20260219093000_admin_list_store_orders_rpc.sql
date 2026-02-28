-- 20260219093000_admin_list_store_orders_rpc.sql
-- Admin RPC to list orders fast (single round-trip, includes buyer + items + total_count)

begin;

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
language sql
stable
security definer
set search_path = public
as $$
  with params as (
    select
      nullif(trim(_q), '') as q,
      case when _status is null or trim(_status) = '' then 'all' else trim(_status) end as status,
      greatest(coalesce(_page, 1), 1) as page,
      least(greatest(coalesce(_page_size, 20), 1), 200) as page_size,
      _from_date as from_date,
      _to_date as to_date
  ),
  base as (
    select
      o.id,
      o.status,
      o.total_cents,
      coalesce(o.discount_pct, o.discount_percent, 0) as discount_pct,
      coalesce(o.preferred_payment, o.payment_method, 'cash') as payment,
      nullif(coalesce(o.note, o.notes, ''), '') as note,
      o.created_at,
      coalesce(o.owner_uid, o.created_by, o.user_id, o.member_id) as buyer_id
    from public.store_orders o, params p
    where
      (p.status = 'all' or o.status = p.status)
      and (p.from_date is null or o.created_at >= (p.from_date::timestamptz))
      and (p.to_date is null or o.created_at < ((p.to_date + 1)::timestamptz))
      and (
        p.q is null
        or (o.id::text = p.q)
        or (coalesce(o.owner_uid, o.created_by, o.user_id, o.member_id)::text = p.q)
        or exists (
          select 1
          from public.profiles pr
          where pr.user_id = coalesce(o.owner_uid, o.created_by, o.user_id, o.member_id)
            and (
              (pr.first_name is not null and pr.first_name ilike ('%' || p.q || '%'))
              or (pr.last_name is not null and pr.last_name ilike ('%' || p.q || '%'))
              or (pr.email is not null and pr.email ilike ('%' || p.q || '%'))
              or (pr.member_id is not null and pr.member_id ilike ('%' || p.q || '%'))
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
    select
      j.*,
      count(*) over() as total_count
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
  from counted c, params p
  order by c.created_at desc
  offset ((greatest(coalesce(_page, 1), 1) - 1) * least(greatest(coalesce(_page_size, 20), 1), 200))
  limit least(greatest(coalesce(_page_size, 20), 1), 200);
$$;

revoke all on function public.admin_list_store_orders(text, text, date, date, integer, integer) from anon, authenticated;
grant execute on function public.admin_list_store_orders(text, text, date, date, integer, integer) to service_role;

commit;
