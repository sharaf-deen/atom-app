create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

create table if not exists public.store_sales (
  id uuid primary key default gen_random_uuid(),
  buyer_user_id uuid null,
  buyer_member_id text null,
  buyer_full_name text not null default '',
  buyer_email text null,
  buyer_phone text null,
  status text not null default 'draft',
  payment_method text null,
  currency text not null default 'EGP',
  total_cents integer not null default 0,
  paid_cents integer not null default 0,
  debt_cents integer not null default 0,
  note text null,
  delivered_at timestamptz null,
  created_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.store_sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.store_sales(id) on delete cascade,
  product_id uuid not null references public.store_products(id) on delete restrict,
  product_name text not null,
  qty integer not null default 1,
  unit_price_cents integer not null default 0,
  line_total_cents integer not null default 0,
  currency text not null default 'EGP',
  delivered_stock_applied boolean not null default false,
  created_at timestamptz not null default now()
);



alter table public.store_sales add column if not exists buyer_user_id uuid null;
alter table public.store_sales add column if not exists buyer_member_id text null;
alter table public.store_sales add column if not exists buyer_full_name text not null default '';
alter table public.store_sales add column if not exists buyer_email text null;
alter table public.store_sales add column if not exists buyer_phone text null;
alter table public.store_sales add column if not exists status text not null default 'draft';
alter table public.store_sales add column if not exists payment_method text null;
alter table public.store_sales add column if not exists currency text not null default 'EGP';
alter table public.store_sales add column if not exists total_cents integer not null default 0;
alter table public.store_sales add column if not exists paid_cents integer not null default 0;
alter table public.store_sales add column if not exists debt_cents integer not null default 0;
alter table public.store_sales add column if not exists note text null;
alter table public.store_sales add column if not exists delivered_at timestamptz null;
alter table public.store_sales add column if not exists created_by uuid null;
alter table public.store_sales add column if not exists created_at timestamptz not null default now();
alter table public.store_sales add column if not exists updated_at timestamptz not null default now();

alter table public.store_sale_items add column if not exists sale_id uuid null references public.store_sales(id) on delete cascade;
alter table public.store_sale_items add column if not exists product_id uuid null references public.store_products(id) on delete restrict;
alter table public.store_sale_items add column if not exists product_name text not null default 'Product';
alter table public.store_sale_items add column if not exists qty integer not null default 1;
alter table public.store_sale_items add column if not exists unit_price_cents integer not null default 0;
alter table public.store_sale_items add column if not exists line_total_cents integer not null default 0;
alter table public.store_sale_items add column if not exists currency text not null default 'EGP';
alter table public.store_sale_items add column if not exists delivered_stock_applied boolean not null default false;
alter table public.store_sale_items add column if not exists created_at timestamptz not null default now();

alter table public.store_sales enable row level security;
alter table public.store_sale_items enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'store_sales_status_check'
      and conrelid = 'public.store_sales'::regclass
  ) then
    alter table public.store_sales
      add constraint store_sales_status_check
      check (status in ('draft', 'partial_paid', 'paid', 'delivered', 'canceled'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'store_sales_payment_method_check'
      and conrelid = 'public.store_sales'::regclass
  ) then
    alter table public.store_sales
      add constraint store_sales_payment_method_check
      check (payment_method is null or payment_method in ('cash', 'card', 'bank_transfer', 'instapay'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'store_sales_total_cents_check'
      and conrelid = 'public.store_sales'::regclass
  ) then
    alter table public.store_sales
      add constraint store_sales_total_cents_check
      check (total_cents >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'store_sales_paid_cents_check'
      and conrelid = 'public.store_sales'::regclass
  ) then
    alter table public.store_sales
      add constraint store_sales_paid_cents_check
      check (paid_cents >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'store_sales_debt_cents_check'
      and conrelid = 'public.store_sales'::regclass
  ) then
    alter table public.store_sales
      add constraint store_sales_debt_cents_check
      check (debt_cents >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'store_sale_items_qty_check'
      and conrelid = 'public.store_sale_items'::regclass
  ) then
    alter table public.store_sale_items
      add constraint store_sale_items_qty_check
      check (qty > 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'store_sale_items_unit_price_cents_check'
      and conrelid = 'public.store_sale_items'::regclass
  ) then
    alter table public.store_sale_items
      add constraint store_sale_items_unit_price_cents_check
      check (unit_price_cents >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'store_sale_items_line_total_cents_check'
      and conrelid = 'public.store_sale_items'::regclass
  ) then
    alter table public.store_sale_items
      add constraint store_sale_items_line_total_cents_check
      check (line_total_cents >= 0);
  end if;
end $$;

create index if not exists idx_store_sales_status on public.store_sales(status);
create index if not exists idx_store_sales_created_at on public.store_sales(created_at desc);
create index if not exists idx_store_sales_buyer_user_id on public.store_sales(buyer_user_id);
create index if not exists idx_store_sale_items_sale_id on public.store_sale_items(sale_id);
create index if not exists idx_store_sale_items_product_id on public.store_sale_items(product_id);
create index if not exists idx_store_sales_buyer_full_name_trgm on public.store_sales using gin (buyer_full_name gin_trgm_ops);
create index if not exists idx_store_sales_buyer_email_trgm on public.store_sales using gin (buyer_email gin_trgm_ops);
create index if not exists idx_store_sales_buyer_phone_trgm on public.store_sales using gin (buyer_phone gin_trgm_ops);
create index if not exists idx_store_sale_items_product_name_trgm on public.store_sale_items using gin (product_name gin_trgm_ops);

create or replace function public.admin_apply_store_sale_update(
  _sale_id uuid,
  _status text default null,
  _paid_cents integer default null,
  _payment_method text default null,
  _note text default null
)
returns table (
  id uuid,
  status text,
  paid_cents integer,
  debt_cents integer,
  delivered_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  sale_row public.store_sales%rowtype;
  item_row record;
  next_paid integer;
  next_status text;
  next_payment text;
  next_note text;
begin
  select *
    into sale_row
  from public.store_sales
  where id = _sale_id
  for update;

  if not found then
    raise exception 'SALE_NOT_FOUND';
  end if;

  next_paid := coalesce(_paid_cents, sale_row.paid_cents);
  next_paid := greatest(0, least(next_paid, sale_row.total_cents));

  next_payment := lower(nullif(btrim(coalesce(_payment_method, sale_row.payment_method, '')), ''));
  if next_payment is not null and next_payment not in ('cash', 'card', 'bank_transfer', 'instapay') then
    raise exception 'INVALID_PAYMENT_METHOD';
  end if;

  next_note := case
    when _note is null then sale_row.note
    else nullif(btrim(_note), '')
  end;

  next_status := lower(coalesce(nullif(btrim(_status), ''), sale_row.status));
  if next_status not in ('draft', 'partial_paid', 'paid', 'delivered', 'canceled') then
    raise exception 'INVALID_STATUS';
  end if;

  if sale_row.status = 'delivered' and next_status <> 'delivered' then
    raise exception 'DELIVERED_STATUS_LOCKED';
  end if;

  if sale_row.status = 'canceled' and next_status <> 'canceled' then
    raise exception 'CANCELED_STATUS_LOCKED';
  end if;

  if next_status not in ('delivered', 'canceled') then
    next_status := case
      when next_paid <= 0 then 'draft'
      when next_paid >= sale_row.total_cents then 'paid'
      else 'partial_paid'
    end;
  end if;

  if next_status = 'delivered' and sale_row.status <> 'delivered' then
    if sale_row.status = 'canceled' then
      raise exception 'CANCELED_CANNOT_DELIVER';
    end if;

    for item_row in
      select id, product_id, qty, delivered_stock_applied
      from public.store_sale_items
      where sale_id = _sale_id
      for update
    loop
      if coalesce(item_row.delivered_stock_applied, false) then
        continue;
      end if;

      update public.store_products
         set inventory_qty = inventory_qty - item_row.qty
       where id = item_row.product_id
         and inventory_qty >= item_row.qty;

      if not found then
        raise exception 'INSUFFICIENT_STOCK_FOR_DELIVERY';
      end if;

      update public.store_sale_items
         set delivered_stock_applied = true
       where id = item_row.id;
    end loop;

    update public.store_sales
       set status = next_status,
           paid_cents = next_paid,
           debt_cents = greatest(total_cents - next_paid, 0),
           payment_method = next_payment,
           note = next_note,
           delivered_at = coalesce(delivered_at, now()),
           updated_at = now()
     where id = _sale_id
     returning store_sales.id, store_sales.status, store_sales.paid_cents, store_sales.debt_cents, store_sales.delivered_at
      into id, status, paid_cents, debt_cents, delivered_at;
  else
    update public.store_sales
       set status = next_status,
           paid_cents = next_paid,
           debt_cents = greatest(total_cents - next_paid, 0),
           payment_method = next_payment,
           note = next_note,
           updated_at = now()
     where id = _sale_id
     returning store_sales.id, store_sales.status, store_sales.paid_cents, store_sales.debt_cents, store_sales.delivered_at
      into id, status, paid_cents, debt_cents, delivered_at;
  end if;

  return next;
end;
$$;

grant execute on function public.admin_apply_store_sale_update(uuid, text, integer, text, text) to authenticated;
grant execute on function public.admin_apply_store_sale_update(uuid, text, integer, text, text) to service_role;
