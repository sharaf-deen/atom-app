begin;

create table if not exists public.store_product_models (
  id uuid primary key default gen_random_uuid(),
  category_key text not null references public.store_product_categories(key) on update cascade on delete restrict,
  name text not null,
  slug text not null,
  description text null,
  cover_image_path text null,
  is_active boolean not null default true,
  is_featured boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  created_by uuid null references public.profiles(user_id) on delete set null,
  updated_by uuid null references public.profiles(user_id) on delete set null,
  constraint store_product_models_name_not_blank check (btrim(name) <> ''),
  constraint store_product_models_slug_not_blank check (btrim(slug) <> ''),
  constraint store_product_models_slug_format check (slug ~ '^[a-z0-9]+(?:[_-][a-z0-9]+)*$'),
  constraint store_product_models_sort_order_nonnegative check (sort_order >= 0)
);

alter table public.store_product_models enable row level security;

create unique index if not exists idx_store_product_models_category_slug_unique
  on public.store_product_models (category_key, slug);

create index if not exists idx_store_product_models_category_active_sort
  on public.store_product_models (category_key, is_active, sort_order, name);

create index if not exists idx_store_product_models_active_featured_sort
  on public.store_product_models (is_active, is_featured, sort_order, name);

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'trg_store_product_models_updated_at'
  ) then
    create trigger trg_store_product_models_updated_at
      before update on public.store_product_models
      for each row execute function public.set_updated_at();
  end if;
end
$$;

grant select, insert, update, delete on table public.store_product_models to authenticated;
grant select, insert, update, delete on table public.store_product_models to service_role;

drop policy if exists store_product_models_select_auth on public.store_product_models;
create policy store_product_models_select_auth
  on public.store_product_models
  for select
  to authenticated
  using (auth.role() = 'authenticated');

drop policy if exists store_product_models_write_super_admin on public.store_product_models;
create policy store_product_models_write_super_admin
  on public.store_product_models
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

alter table public.store_products
  add column if not exists model_id uuid null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'store_products_model_id_fkey'
  ) then
    alter table public.store_products
      add constraint store_products_model_id_fkey
      foreign key (model_id)
      references public.store_product_models(id)
      on update cascade
      on delete set null
      not valid;
  end if;
end
$$;

alter table public.store_products
  validate constraint store_products_model_id_fkey;

create index if not exists idx_store_products_model_id
  on public.store_products (model_id);

create index if not exists idx_store_products_category_model_active
  on public.store_products (category, model_id, is_active, created_at desc);

commit;
