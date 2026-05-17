begin;

create table if not exists public.store_expenses (
  id uuid primary key default gen_random_uuid(),
  expense_date date not null default current_date,
  category text not null check (category in ('supplier_order', 'transport', 'customs_taxes', 'packaging', 'refund', 'other')),
  title text not null,
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null default 'EGP' check (currency = 'EGP'),
  payment_method text not null default 'cash' check (payment_method in ('cash', 'card', 'bank_transfer', 'instapay')),
  vendor_name text null,
  note text null,
  attachment_path text null,
  attachment_mime text null,
  attachment_filename text null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  deleted_at timestamptz null,
  created_by uuid null references public.profiles(user_id) on delete set null,
  updated_by uuid null references public.profiles(user_id) on delete set null,
  deleted_by uuid null references public.profiles(user_id) on delete set null
);

create index if not exists idx_store_expenses_active_date
  on public.store_expenses (expense_date desc, created_at desc)
  where deleted_at is null;

create index if not exists idx_store_expenses_active_category_date
  on public.store_expenses (category, expense_date desc)
  where deleted_at is null;

create index if not exists idx_store_expenses_active_payment_date
  on public.store_expenses (payment_method, expense_date desc)
  where deleted_at is null;

alter table public.store_expenses enable row level security;

drop trigger if exists trg_store_expenses_updated_at on public.store_expenses;
create trigger trg_store_expenses_updated_at
before update on public.store_expenses
for each row execute function public.set_updated_at();

drop policy if exists store_expenses_admin_select on public.store_expenses;
create policy store_expenses_admin_select
on public.store_expenses
for select
to authenticated
using (public.is_admin_or_super_admin(auth.uid()));

drop policy if exists store_expenses_super_admin_insert on public.store_expenses;
create policy store_expenses_super_admin_insert
on public.store_expenses
for insert
to authenticated
with check (public.is_super_admin(auth.uid()));

drop policy if exists store_expenses_super_admin_update on public.store_expenses;
create policy store_expenses_super_admin_update
on public.store_expenses
for update
to authenticated
using (public.is_super_admin(auth.uid()))
with check (public.is_super_admin(auth.uid()));

drop policy if exists store_expenses_super_admin_delete on public.store_expenses;
create policy store_expenses_super_admin_delete
on public.store_expenses
for delete
to authenticated
using (public.is_super_admin(auth.uid()));

revoke all on table public.store_expenses from anon, authenticated;
grant select, insert, update, delete on table public.store_expenses to authenticated;
grant select, insert, update, delete on table public.store_expenses to service_role;

insert into storage.buckets (id, name, public)
values ('store-expense-attachments', 'store-expense-attachments', false)
on conflict (id) do nothing;

commit;
