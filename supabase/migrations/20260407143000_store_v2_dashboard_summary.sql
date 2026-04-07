create or replace function public.admin_store_dashboard_summary(_days integer default 30)
returns table (
  total_products integer,
  active_products integer,
  preorder_enabled_products integer,
  stock_units bigint,
  stock_value_cents bigint,
  low_stock_count integer,
  out_of_stock_count integer,
  open_supplier_orders integer,
  pending_supplier_units bigint,
  open_preorders integer,
  ready_preorders integer,
  preorder_deposit_cents bigint,
  preorder_balance_cents bigint,
  outstanding_sales_debt_cents bigint,
  sales_count integer,
  delivered_sales_count integer,
  sales_total_cents bigint,
  sales_paid_cents bigint,
  sales_debt_cents bigint
)
language sql
security definer
set search_path = public
as $$
with product_stats as (
  select
    count(*)::integer as total_products,
    count(*) filter (where coalesce(is_active, false))::integer as active_products,
    count(*) filter (where coalesce(is_active, false) and coalesce(allow_preorder, false))::integer as preorder_enabled_products,
    coalesce(sum(greatest(coalesce(inventory_qty, 0), 0)), 0)::bigint as stock_units,
    coalesce(sum(greatest(coalesce(inventory_qty, 0), 0) * greatest(coalesce(price_cents, 0), 0)), 0)::bigint as stock_value_cents,
    count(*) filter (
      where coalesce(is_active, false)
        and greatest(coalesce(inventory_qty, 0), 0) <= greatest(coalesce(low_stock_threshold, 0), 0)
    )::integer as low_stock_count,
    count(*) filter (
      where coalesce(is_active, false)
        and greatest(coalesce(inventory_qty, 0), 0) <= 0
    )::integer as out_of_stock_count
  from public.store_products
),
supplier_stats as (
  select
    count(distinct so.id) filter (
      where so.status in ('draft', 'ordered', 'partially_received')
    )::integer as open_supplier_orders,
    coalesce(sum(
      case
        when so.status in ('draft', 'ordered', 'partially_received') and soi.line_status <> 'canceled'
          then greatest(coalesce(soi.ordered_qty, 0) - coalesce(soi.received_qty, 0), 0)
        else 0
      end
    ), 0)::bigint as pending_supplier_units
  from public.store_supplier_orders so
  left join public.store_supplier_order_items soi
    on soi.supplier_order_id = so.id
),
preorder_stats as (
  select
    count(*) filter (
      where status in ('pending', 'confirmed', 'ordered_from_supplier', 'ready')
    )::integer as open_preorders,
    count(*) filter (where status = 'ready')::integer as ready_preorders,
    coalesce(sum(
      case when status in ('pending', 'confirmed', 'ordered_from_supplier', 'ready')
        then greatest(coalesce(deposit_cents, 0), 0)
        else 0
      end
    ), 0)::bigint as preorder_deposit_cents,
    coalesce(sum(
      case when status in ('pending', 'confirmed', 'ordered_from_supplier', 'ready')
        then greatest(coalesce(balance_due_cents, 0), 0)
        else 0
      end
    ), 0)::bigint as preorder_balance_cents
  from public.store_preorders
),
sales_backlog as (
  select
    coalesce(sum(
      case when status <> 'canceled' then greatest(coalesce(debt_cents, 0), 0) else 0 end
    ), 0)::bigint as outstanding_sales_debt_cents
  from public.store_sales
),
sales_window as (
  select
    count(*) filter (
      where status <> 'canceled'
        and (
          coalesce(_days, 0) <= 0
          or created_at >= timezone('utc', now()) - make_interval(days => _days)
        )
    )::integer as sales_count,
    count(*) filter (
      where status = 'delivered'
        and (
          coalesce(_days, 0) <= 0
          or created_at >= timezone('utc', now()) - make_interval(days => _days)
        )
    )::integer as delivered_sales_count,
    coalesce(sum(
      case when status <> 'canceled'
        and (
          coalesce(_days, 0) <= 0
          or created_at >= timezone('utc', now()) - make_interval(days => _days)
        )
        then greatest(coalesce(total_cents, 0), 0)
        else 0
      end
    ), 0)::bigint as sales_total_cents,
    coalesce(sum(
      case when status <> 'canceled'
        and (
          coalesce(_days, 0) <= 0
          or created_at >= timezone('utc', now()) - make_interval(days => _days)
        )
        then greatest(coalesce(paid_cents, 0), 0)
        else 0
      end
    ), 0)::bigint as sales_paid_cents,
    coalesce(sum(
      case when status <> 'canceled'
        and (
          coalesce(_days, 0) <= 0
          or created_at >= timezone('utc', now()) - make_interval(days => _days)
        )
        then greatest(coalesce(debt_cents, 0), 0)
        else 0
      end
    ), 0)::bigint as sales_debt_cents
  from public.store_sales
)
select
  p.total_products,
  p.active_products,
  p.preorder_enabled_products,
  p.stock_units,
  p.stock_value_cents,
  p.low_stock_count,
  p.out_of_stock_count,
  s.open_supplier_orders,
  s.pending_supplier_units,
  pr.open_preorders,
  pr.ready_preorders,
  pr.preorder_deposit_cents,
  pr.preorder_balance_cents,
  sb.outstanding_sales_debt_cents,
  sw.sales_count,
  sw.delivered_sales_count,
  sw.sales_total_cents,
  sw.sales_paid_cents,
  sw.sales_debt_cents
from product_stats p
cross join supplier_stats s
cross join preorder_stats pr
cross join sales_backlog sb
cross join sales_window sw
$$;

revoke all on function public.admin_store_dashboard_summary(integer) from public;
grant execute on function public.admin_store_dashboard_summary(integer) to authenticated;
grant execute on function public.admin_store_dashboard_summary(integer) to service_role;

create index if not exists idx_store_products_active_inventory_qty
  on public.store_products (is_active, inventory_qty);

create index if not exists idx_store_products_active_preorder
  on public.store_products (is_active, allow_preorder);
