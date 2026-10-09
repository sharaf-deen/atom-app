create extension if not exists pgcrypto;

create table if not exists public.store_sale_reconciliations (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.store_sales(id) on delete restrict,
  recorded_paid_cents_snapshot integer not null default 0,
  actual_received_cents integer not null default 0,
  variance_cents integer not null default 0,
  payment_method_snapshot text null,
  received_date date not null,
  reference text null,
  note text null,
  validated_by uuid not null,
  validated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.store_sale_reconciliations enable row level security;

create index if not exists idx_store_sale_reconciliations_sale_id
  on public.store_sale_reconciliations(sale_id, validated_at desc);
create index if not exists idx_store_sale_reconciliations_received_date
  on public.store_sale_reconciliations(received_date desc);
create index if not exists idx_store_sale_reconciliations_validated_at
  on public.store_sale_reconciliations(validated_at desc);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'store_sale_reconciliations_recorded_paid_check'
      and conrelid = 'public.store_sale_reconciliations'::regclass
  ) then
    alter table public.store_sale_reconciliations
      add constraint store_sale_reconciliations_recorded_paid_check
      check (recorded_paid_cents_snapshot >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'store_sale_reconciliations_actual_received_check'
      and conrelid = 'public.store_sale_reconciliations'::regclass
  ) then
    alter table public.store_sale_reconciliations
      add constraint store_sale_reconciliations_actual_received_check
      check (actual_received_cents >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'store_sale_reconciliations_payment_method_check'
      and conrelid = 'public.store_sale_reconciliations'::regclass
  ) then
    alter table public.store_sale_reconciliations
      add constraint store_sale_reconciliations_payment_method_check
      check (
        payment_method_snapshot is null
        or payment_method_snapshot in ('cash', 'card', 'bank_transfer', 'instapay')
      );
  end if;
end $$;

comment on table public.store_sale_reconciliations is
  'Append-only Store sale reconciliation validations. Active reconciliation period starts 2026-09-01; earlier sales are treated as historically validated outside this ledger.';
