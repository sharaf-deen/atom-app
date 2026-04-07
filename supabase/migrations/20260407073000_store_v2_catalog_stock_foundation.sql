-- Store V2 — Lot B
-- Admin catalog / stock foundation

alter table public.store_products
  add column if not exists allow_preorder boolean not null default true,
  add column if not exists low_stock_threshold integer not null default 0;

update public.store_products
set allow_preorder = true
where allow_preorder is null;

update public.store_products
set low_stock_threshold = 0
where low_stock_threshold is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'store_products_low_stock_threshold_nonnegative'
  ) then
    alter table public.store_products
      add constraint store_products_low_stock_threshold_nonnegative
      check (low_stock_threshold >= 0);
  end if;
end $$;

create index if not exists idx_store_products_allow_preorder
  on public.store_products (allow_preorder);
