begin;

-- Hotfix: qualify columns inside the supplier receiving RPC so PL/pgSQL
-- OUT parameters (notably inventory_qty and supplier_order_id) cannot shadow
-- table columns.
create or replace function public.store_apply_supplier_received_qty(
  _item_id uuid,
  _received_qty integer
)
returns table (
  item_id uuid,
  supplier_order_id uuid,
  product_id uuid,
  previous_received_qty integer,
  new_received_qty integer,
  delta_received_qty integer,
  inventory_qty integer,
  item_status text,
  order_status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_item record;
  v_new_received integer;
  v_delta integer;
  v_inventory integer := null;
  v_total_items integer := 0;
  v_received_items integer := 0;
  v_touched_items integer := 0;
  v_order_status text := 'ordered';
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  if not public.is_super_admin(v_uid) then
    raise exception 'FORBIDDEN';
  end if;

  if _item_id is null then
    raise exception 'MISSING_ITEM_ID';
  end if;

  if _received_qty is null or _received_qty < 0 then
    raise exception 'INVALID_RECEIVED_QTY';
  end if;

  select soi.*, so.status as supplier_order_status
  into v_item
  from public.store_supplier_order_items as soi
  join public.store_supplier_orders as so on so.id = soi.supplier_order_id
  where soi.id = _item_id
  for update of soi, so;

  if not found then
    raise exception 'ITEM_NOT_FOUND';
  end if;

  if v_item.supplier_order_status = 'canceled' or v_item.line_status = 'canceled' then
    raise exception 'CANCELED_ITEM';
  end if;

  if _received_qty < v_item.received_qty or _received_qty > v_item.ordered_qty then
    raise exception 'INVALID_RECEIVED_QTY';
  end if;

  v_new_received := _received_qty;
  v_delta := v_new_received - v_item.received_qty;

  update public.store_supplier_order_items as soi
  set
    received_qty = v_new_received,
    line_status = case
      when v_new_received >= v_item.ordered_qty then 'received'
      when v_new_received > 0 then 'partially_received'
      else 'ordered'
    end,
    updated_at = timezone('utc', now())
  where soi.id = _item_id;

  if v_delta > 0 and v_item.product_id is not null then
    update public.store_products as sp
    set inventory_qty = sp.inventory_qty + v_delta
    where sp.id = v_item.product_id
    returning sp.inventory_qty into v_inventory;
  elsif v_item.product_id is not null then
    select sp.inventory_qty into v_inventory
    from public.store_products as sp
    where sp.id = v_item.product_id;
  end if;

  select
    count(*)::integer,
    count(*) filter (where soi.line_status = 'received')::integer,
    count(*) filter (where soi.received_qty > 0)::integer
  into v_total_items, v_received_items, v_touched_items
  from public.store_supplier_order_items as soi
  where soi.supplier_order_id = v_item.supplier_order_id
    and soi.line_status <> 'canceled';

  if v_total_items > 0 and v_received_items = v_total_items then
    v_order_status := 'received';
  elsif v_touched_items > 0 then
    v_order_status := 'partially_received';
  else
    v_order_status := 'ordered';
  end if;

  update public.store_supplier_orders as so
  set
    status = v_order_status,
    ordered_at = coalesce(so.ordered_at, timezone('utc', now())),
    received_at = case when v_order_status = 'received' then timezone('utc', now()) else null end,
    updated_by = v_uid,
    updated_at = timezone('utc', now())
  where so.id = v_item.supplier_order_id;

  return query
  select
    v_item.id,
    v_item.supplier_order_id,
    v_item.product_id,
    v_item.received_qty,
    v_new_received,
    v_delta,
    v_inventory,
    case
      when v_new_received >= v_item.ordered_qty then 'received'
      when v_new_received > 0 then 'partially_received'
      else 'ordered'
    end,
    v_order_status;
end;
$$;

revoke all on function public.store_apply_supplier_received_qty(uuid, integer) from public;
grant execute on function public.store_apply_supplier_received_qty(uuid, integer) to authenticated;
grant execute on function public.store_apply_supplier_received_qty(uuid, integer) to service_role;

commit;
