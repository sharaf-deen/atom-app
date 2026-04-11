-- Store product categories (safe management layer)
-- Adds a dedicated categories table, seeds current categories,
-- and replaces the hardcoded store_products category check with a FK.

create table if not exists public.store_product_categories (
  key text primary key,
  label text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid null references public.profiles(user_id) on delete set null,
  updated_by uuid null references public.profiles(user_id) on delete set null,
  constraint store_product_categories_key_format check (key ~ '^[a-z0-9_]+$')
);

alter table public.store_product_categories enable row level security;

create index if not exists idx_store_product_categories_sort on public.store_product_categories (sort_order, label);
create index if not exists idx_store_product_categories_active on public.store_product_categories (is_active, sort_order, label);

grant select, insert, update, delete on table public.store_product_categories to authenticated;
grant select, insert, update, delete on table public.store_product_categories to service_role;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'store_product_categories'
      and policyname = 'store_product_categories_select_auth'
  ) then
    create policy store_product_categories_select_auth
      on public.store_product_categories
      for select
      to authenticated
      using (auth.role() = 'authenticated');
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'store_product_categories'
      and policyname = 'store_product_categories_write_super_admin'
  ) then
    create policy store_product_categories_write_super_admin
      on public.store_product_categories
      for all
      to authenticated
      using (
        exists (
          select 1
          from public.profiles p
          where p.user_id = auth.uid()
            and p.role = 'super_admin'
        )
      )
      with check (
        exists (
          select 1
          from public.profiles p
          where p.user_id = auth.uid()
            and p.role = 'super_admin'
        )
      );
  end if;
end
$$;

insert into public.store_product_categories (key, label, sort_order, is_active)
values
  ('kimono', 'Kimono', 10, true),
  ('rashguard', 'Rashguard', 20, true),
  ('short', 'Short', 30, true),
  ('belt', 'Belt', 40, true)
on conflict (key) do update
set label = excluded.label,
    sort_order = excluded.sort_order,
    is_active = true;

insert into public.store_product_categories (key, label, sort_order, is_active)
select
  q.category_key as key,
  initcap(replace(q.category_key, '_', ' ')) as label,
  100 + row_number() over (order by q.category_key) as sort_order,
  true as is_active
from (
  select distinct lower(trim(sp.category)) as category_key
  from public.store_products sp
  where sp.category is not null
    and trim(sp.category) <> ''
) q
on conflict (key) do nothing;

alter table public.store_products drop constraint if exists store_products_category_check;
alter table public.store_products drop constraint if exists store_products_category_fkey;

alter table public.store_products
  add constraint store_products_category_fkey
  foreign key (category)
  references public.store_product_categories(key)
  on update cascade
  on delete restrict
  not valid;

alter table public.store_products validate constraint store_products_category_fkey;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'trg_store_product_categories_updated_at'
  ) then
    create trigger trg_store_product_categories_updated_at
      before update on public.store_product_categories
      for each row execute function public.set_updated_at();
  end if;
end
$$;
