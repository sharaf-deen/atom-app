alter table public.store_products
  add column if not exists image_path text;

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'storage'
      and table_name = 'buckets'
  ) then
    insert into storage.buckets (id, name, public)
    values ('store-product-images', 'store-product-images', true)
    on conflict (id) do update set public = excluded.public;
  end if;
end $$;
