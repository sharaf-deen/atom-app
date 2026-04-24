-- Store products: allow up to 3 photos per product.
-- Keeps image_path as primary slot for backward compatibility.

alter table public.store_products
  add column if not exists image_path_2 text null,
  add column if not exists image_path_3 text null;

comment on column public.store_products.image_path is 'Primary product photo path (slot 1).';
comment on column public.store_products.image_path_2 is 'Secondary product photo path (slot 2).';
comment on column public.store_products.image_path_3 is 'Tertiary product photo path (slot 3).';
