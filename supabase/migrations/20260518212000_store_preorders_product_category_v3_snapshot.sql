begin;

-- Store V3 supports product categories beyond the original legacy fixed list.
-- Preorders keep product_category as a snapshot for display/export, so it must
-- accept the current Store product category value instead of blocking inserts.
alter table public.store_preorders
  drop constraint if exists store_preorders_product_category_check;

alter table public.store_preorders
  add constraint store_preorders_product_category_snapshot_check
  check (
    product_category is null
    or (
      btrim(product_category) <> ''
      and char_length(product_category) <= 120
    )
  );

commit;
