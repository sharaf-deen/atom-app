begin;

alter table public.store_expenses
  add column if not exists supplier_order_id uuid null references public.store_supplier_orders(id) on delete set null;

create index if not exists idx_store_expenses_active_supplier_order_date
  on public.store_expenses (supplier_order_id, expense_date desc, created_at desc)
  where deleted_at is null and supplier_order_id is not null;

comment on column public.store_expenses.supplier_order_id is 'Optional link to a store supplier order. Used for accounting visibility only; it does not update stock or supplier order status.';

commit;
