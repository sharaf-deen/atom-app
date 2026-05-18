begin;

create table if not exists public.store_external_funding (
  id uuid primary key default gen_random_uuid(),
  funding_date date not null default current_date,
  type text not null check (type in ('loan_received', 'loan_repayment')),
  title text not null,
  amount_cents integer not null check (amount_cents > 0),
  currency text not null default 'EGP' check (currency = 'EGP'),
  payment_method text not null default 'cash' check (payment_method in ('cash', 'card', 'bank_transfer', 'instapay')),
  source_name text null,
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

create index if not exists idx_store_external_funding_active_date
  on public.store_external_funding (funding_date desc, created_at desc)
  where deleted_at is null;

create index if not exists idx_store_external_funding_active_type_date
  on public.store_external_funding (type, funding_date desc)
  where deleted_at is null;

create index if not exists idx_store_external_funding_active_payment_date
  on public.store_external_funding (payment_method, funding_date desc)
  where deleted_at is null;

alter table public.store_external_funding enable row level security;

drop trigger if exists trg_store_external_funding_updated_at on public.store_external_funding;
create trigger trg_store_external_funding_updated_at
before update on public.store_external_funding
for each row execute function public.set_updated_at();

drop policy if exists store_external_funding_admin_select on public.store_external_funding;
create policy store_external_funding_admin_select
on public.store_external_funding
for select
to authenticated
using (public.is_admin_or_super_admin(auth.uid()));

drop policy if exists store_external_funding_super_admin_insert on public.store_external_funding;
create policy store_external_funding_super_admin_insert
on public.store_external_funding
for insert
to authenticated
with check (public.is_super_admin(auth.uid()));

drop policy if exists store_external_funding_super_admin_update on public.store_external_funding;
create policy store_external_funding_super_admin_update
on public.store_external_funding
for update
to authenticated
using (public.is_super_admin(auth.uid()))
with check (public.is_super_admin(auth.uid()));

drop policy if exists store_external_funding_super_admin_delete on public.store_external_funding;
create policy store_external_funding_super_admin_delete
on public.store_external_funding
for delete
to authenticated
using (public.is_super_admin(auth.uid()));

revoke all on table public.store_external_funding from anon, authenticated;
grant select, insert, update, delete on table public.store_external_funding to authenticated;
grant select, insert, update, delete on table public.store_external_funding to service_role;

insert into storage.buckets (id, name, public)
values ('store-funding-attachments', 'store-funding-attachments', false)
on conflict (id) do nothing;

comment on table public.store_external_funding is 'External Store funding movements such as loans received and repayments. Used for Store cash visibility only; it does not affect stock, sales, or expenses.';
comment on column public.store_external_funding.type is 'loan_received increases available Store cash and outstanding funding debt. loan_repayment reduces available Store cash and funding debt.';

commit;
