begin;

create extension if not exists pg_trgm with schema extensions;

create index if not exists idx_store_preorders_buyer_full_name_trgm
  on public.store_preorders using gin (buyer_full_name gin_trgm_ops);

create index if not exists idx_store_preorders_buyer_email_trgm
  on public.store_preorders using gin (buyer_email gin_trgm_ops);

create index if not exists idx_store_preorders_buyer_phone_trgm
  on public.store_preorders using gin (buyer_phone gin_trgm_ops);

create index if not exists idx_store_preorders_product_name_trgm
  on public.store_preorders using gin (product_name gin_trgm_ops);

commit;
