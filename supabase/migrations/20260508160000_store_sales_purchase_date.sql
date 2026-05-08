-- Store Sales: separate purchase date from technical creation timestamp.
-- Existing rows are backfilled from created_at using Cairo business time.

alter table public.store_sales
  add column if not exists purchase_date date;

update public.store_sales
set purchase_date = coalesce(
  purchase_date,
  (created_at at time zone 'Africa/Cairo')::date,
  (timezone('Africa/Cairo', now()))::date
)
where purchase_date is null;

alter table public.store_sales
  alter column purchase_date set default (timezone('Africa/Cairo', now()))::date;

alter table public.store_sales
  alter column purchase_date set not null;

create index if not exists store_sales_purchase_date_idx
  on public.store_sales (purchase_date desc);
