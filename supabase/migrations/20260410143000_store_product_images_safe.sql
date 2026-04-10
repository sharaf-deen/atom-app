-- Store product images (safe add-product hotfix)
-- Scope kept minimal: add optional image path + bucket for product photos.

begin;

alter table public.store_products
  add column if not exists image_path text;

insert into storage.buckets (id, name, public)
values ('store-product-images', 'store-product-images', true)
on conflict (id) do nothing;

commit;
