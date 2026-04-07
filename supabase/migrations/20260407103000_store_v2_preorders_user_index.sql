begin;

create index if not exists idx_store_products_allow_preorder_active_created_at
  on public.store_products (allow_preorder, is_active, created_at desc);

analyze public.store_products;

commit;
