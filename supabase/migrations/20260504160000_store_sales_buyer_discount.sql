-- Store sales: keep the existing stable sales flow, but support an order-level discount.
-- The buyer link already exists on store_sales through buyer_user_id / buyer_member_id.

alter table public.store_sales
  add column if not exists discount_cents integer not null default 0;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'store_sales_discount_cents_check'
      and conrelid = 'public.store_sales'::regclass
  ) then
    alter table public.store_sales
      add constraint store_sales_discount_cents_check
      check (discount_cents >= 0);
  end if;
end $$;
