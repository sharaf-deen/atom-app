begin;

create table if not exists public.store_supplier_orders (
  id uuid primary key default gen_random_uuid(),
  reference text null,
  supplier_name text null,
  status text not null default 'draft' check (status in ('draft', 'ordered', 'partially_received', 'received', 'canceled')),
  notes text null,
  ordered_at timestamptz null,
  expected_at date null,
  received_at timestamptz null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  created_by uuid null references public.profiles(user_id) on delete set null,
  updated_by uuid null references public.profiles(user_id) on delete set null
);

create table if not exists public.store_supplier_order_items (
  id uuid primary key default gen_random_uuid(),
  supplier_order_id uuid not null references public.store_supplier_orders(id) on delete cascade,
  product_id uuid null references public.store_products(id) on delete set null,
  product_name text not null,
  product_category text null check (product_category is null or product_category in ('kimono', 'rashguard', 'short', 'belt')),
  product_color text null,
  product_size text null,
  unit_cost_cents integer not null default 0 check (unit_cost_cents >= 0),
  ordered_qty integer not null check (ordered_qty > 0),
  received_qty integer not null default 0 check (received_qty >= 0 and received_qty <= ordered_qty),
  line_total_cents integer generated always as (ordered_qty * unit_cost_cents) stored,
  line_status text not null default 'ordered' check (line_status in ('ordered', 'partially_received', 'received', 'canceled')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.store_preorders (
  id uuid primary key default gen_random_uuid(),
  buyer_user_id uuid not null references public.profiles(user_id) on delete cascade,
  buyer_full_name text null,
  buyer_email text null,
  buyer_phone text null,
  product_id uuid null references public.store_products(id) on delete set null,
  product_name text not null,
  product_category text null check (product_category is null or product_category in ('kimono', 'rashguard', 'short', 'belt')),
  product_color text null,
  product_size text null,
  qty integer not null check (qty > 0),
  unit_price_cents integer not null default 0 check (unit_price_cents >= 0),
  total_cents integer not null default 0 check (total_cents >= 0),
  deposit_cents integer not null default 0 check (deposit_cents >= 0 and deposit_cents <= total_cents),
  balance_due_cents integer generated always as (greatest(total_cents - deposit_cents, 0)) stored,
  deposit_payment_method text null check (deposit_payment_method is null or deposit_payment_method in ('cash', 'instapay', 'bank_transfer', 'card')),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'ordered_from_supplier', 'ready', 'completed', 'canceled')),
  note text null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  created_by uuid null references public.profiles(user_id) on delete set null,
  updated_by uuid null references public.profiles(user_id) on delete set null
);

create table if not exists public.store_sales (
  id uuid primary key default gen_random_uuid(),
  buyer_user_id uuid null references public.profiles(user_id) on delete set null,
  buyer_full_name text null,
  buyer_email text null,
  buyer_phone text null,
  status text not null default 'draft' check (status in ('draft', 'partial_paid', 'paid', 'delivered', 'canceled')),
  payment_method text null check (payment_method is null or payment_method in ('cash', 'instapay', 'bank_transfer', 'card')),
  notes text null,
  total_cents integer not null default 0 check (total_cents >= 0),
  paid_cents integer not null default 0 check (paid_cents >= 0 and paid_cents <= total_cents),
  debt_cents integer generated always as (greatest(total_cents - paid_cents, 0)) stored,
  delivered_at timestamptz null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  created_by uuid null references public.profiles(user_id) on delete set null,
  updated_by uuid null references public.profiles(user_id) on delete set null
);

create table if not exists public.store_sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.store_sales(id) on delete cascade,
  product_id uuid null references public.store_products(id) on delete set null,
  product_name text not null,
  product_category text null check (product_category is null or product_category in ('kimono', 'rashguard', 'short', 'belt')),
  product_color text null,
  product_size text null,
  qty integer not null check (qty > 0),
  unit_price_cents integer not null default 0 check (unit_price_cents >= 0),
  line_total_cents integer generated always as (qty * unit_price_cents) stored,
  stock_deducted boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_store_supplier_orders_status_created_at
  on public.store_supplier_orders(status, created_at desc);

create index if not exists idx_store_supplier_orders_supplier_created_at
  on public.store_supplier_orders(supplier_name, created_at desc);

create index if not exists idx_store_supplier_order_items_order_created_at
  on public.store_supplier_order_items(supplier_order_id, created_at asc);

create index if not exists idx_store_preorders_buyer_created_at
  on public.store_preorders(buyer_user_id, created_at desc);

create index if not exists idx_store_preorders_status_created_at
  on public.store_preorders(status, created_at desc);

create index if not exists idx_store_preorders_product_status
  on public.store_preorders(product_id, status);

create index if not exists idx_store_sales_status_created_at
  on public.store_sales(status, created_at desc);

create index if not exists idx_store_sales_buyer_created_at
  on public.store_sales(buyer_user_id, created_at desc);

create index if not exists idx_store_sale_items_sale_created_at
  on public.store_sale_items(sale_id, created_at asc);

alter table public.store_supplier_orders enable row level security;
alter table public.store_supplier_order_items enable row level security;
alter table public.store_preorders enable row level security;
alter table public.store_sales enable row level security;
alter table public.store_sale_items enable row level security;

drop trigger if exists trg_store_supplier_orders_updated_at on public.store_supplier_orders;
create trigger trg_store_supplier_orders_updated_at
before update on public.store_supplier_orders
for each row execute function public.set_updated_at();

drop trigger if exists trg_store_supplier_order_items_updated_at on public.store_supplier_order_items;
create trigger trg_store_supplier_order_items_updated_at
before update on public.store_supplier_order_items
for each row execute function public.set_updated_at();

drop trigger if exists trg_store_preorders_updated_at on public.store_preorders;
create trigger trg_store_preorders_updated_at
before update on public.store_preorders
for each row execute function public.set_updated_at();

drop trigger if exists trg_store_sales_updated_at on public.store_sales;
create trigger trg_store_sales_updated_at
before update on public.store_sales
for each row execute function public.set_updated_at();

drop trigger if exists trg_store_sale_items_updated_at on public.store_sale_items;
create trigger trg_store_sale_items_updated_at
before update on public.store_sale_items
for each row execute function public.set_updated_at();

drop policy if exists store_supplier_orders_super_admin_all on public.store_supplier_orders;
create policy store_supplier_orders_super_admin_all
on public.store_supplier_orders
for all
to authenticated
using (public.is_super_admin(auth.uid()))
with check (public.is_super_admin(auth.uid()));

drop policy if exists store_supplier_order_items_super_admin_all on public.store_supplier_order_items;
create policy store_supplier_order_items_super_admin_all
on public.store_supplier_order_items
for all
to authenticated
using (public.is_super_admin(auth.uid()))
with check (public.is_super_admin(auth.uid()));

drop policy if exists store_preorders_super_admin_all on public.store_preorders;
create policy store_preorders_super_admin_all
on public.store_preorders
for all
to authenticated
using (public.is_super_admin(auth.uid()))
with check (public.is_super_admin(auth.uid()));

drop policy if exists store_preorders_customer_select_own on public.store_preorders;
create policy store_preorders_customer_select_own
on public.store_preorders
for select
to authenticated
using (buyer_user_id = auth.uid());

drop policy if exists store_preorders_customer_insert_own on public.store_preorders;
create policy store_preorders_customer_insert_own
on public.store_preorders
for insert
to authenticated
with check (
  buyer_user_id = auth.uid()
  and created_by is null
  and updated_by is null
);

drop policy if exists store_sales_super_admin_all on public.store_sales;
create policy store_sales_super_admin_all
on public.store_sales
for all
to authenticated
using (public.is_super_admin(auth.uid()))
with check (public.is_super_admin(auth.uid()));

drop policy if exists store_sale_items_super_admin_all on public.store_sale_items;
create policy store_sale_items_super_admin_all
on public.store_sale_items
for all
to authenticated
using (public.is_super_admin(auth.uid()))
with check (public.is_super_admin(auth.uid()));

revoke all on table public.store_supplier_orders from anon, authenticated;
revoke all on table public.store_supplier_order_items from anon, authenticated;
revoke all on table public.store_preorders from anon, authenticated;
revoke all on table public.store_sales from anon, authenticated;
revoke all on table public.store_sale_items from anon, authenticated;

grant select, insert, update, delete on table public.store_supplier_orders to authenticated;
grant select, insert, update, delete on table public.store_supplier_order_items to authenticated;
grant select, insert, update, delete on table public.store_preorders to authenticated;
grant select, insert, update, delete on table public.store_sales to authenticated;
grant select, insert, update, delete on table public.store_sale_items to authenticated;

grant select, insert, update, delete on table public.store_supplier_orders to service_role;
grant select, insert, update, delete on table public.store_supplier_order_items to service_role;
grant select, insert, update, delete on table public.store_preorders to service_role;
grant select, insert, update, delete on table public.store_sales to service_role;
grant select, insert, update, delete on table public.store_sale_items to service_role;

commit;
