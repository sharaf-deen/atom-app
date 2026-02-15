-- Create packages_pricing table for Packages & Promos page

create table if not exists public.packages_pricing (
  id uuid not null default gen_random_uuid(),
  name text not null,
  type text not null,
  unit text not null,
  qty integer not null,
  price_egp integer not null default 0,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  updated_by uuid null,
  constraint packages_pricing_pkey primary key (id),
  constraint packages_pricing_type_check check (type = any (array['membership'::text, 'private'::text])),
  constraint packages_pricing_unit_check check (unit = any (array['month'::text, 'session'::text])),
  constraint packages_pricing_qty_check check (qty >= 1),
  constraint packages_pricing_price_check check (price_egp >= 0),
  constraint packages_pricing_updated_by_fkey foreign key (updated_by) references profiles (user_id) on delete set null
);

create index if not exists idx_packages_pricing_active on public.packages_pricing using btree (is_active);
create index if not exists idx_packages_pricing_sort on public.packages_pricing using btree (sort_order);
create index if not exists idx_packages_pricing_type_unit_qty on public.packages_pricing using btree (type, unit, qty);

-- Optional but recommended
alter table public.packages_pricing enable row level security;

-- Everyone logged-in can read
create policy if not exists packages_pricing_read_authenticated
on public.packages_pricing
for select
to authenticated
using (true);

-- Only super_admin can write (if you later decide to use the normal Supabase client with RLS)
create policy if not exists packages_pricing_write_super_admin
on public.packages_pricing
for all
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid() and p.role = 'super_admin'
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid() and p.role = 'super_admin'
  )
);
