-- Hotfix: allow Store V3 category snapshots on supplier order items.
--
-- Store V3 product categories are no longer limited to the old legacy values
-- such as kimono/rashguard/short/belt. Supplier order items keep
-- product_category as a snapshot for display/export, so the constraint should
-- only ensure the snapshot is a reasonable non-empty text value.

alter table if exists public.store_supplier_order_items
  drop constraint if exists store_supplier_order_items_product_category_check;

alter table if exists public.store_supplier_order_items
  drop constraint if exists store_supplier_order_items_product_category_v3_snapshot_check;

alter table if exists public.store_supplier_order_items
  add constraint store_supplier_order_items_product_category_v3_snapshot_check
  check (
    product_category is null
    or (
      btrim(product_category) <> ''
      and char_length(product_category) <= 120
    )
  );
