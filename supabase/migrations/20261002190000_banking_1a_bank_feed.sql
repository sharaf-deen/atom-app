-- Banking 1A — Bank Feed Foundation
-- Read-only bank feed inside ATOM. No bank transfer/write capability.

create table if not exists public.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  display_name text not null,
  bank_name text null,
  account_reference text null,
  currency text not null default 'EGP',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.bank_accounts enable row level security;

insert into public.bank_accounts (code, display_name, currency)
values ('atom-main', 'ATOM Main Bank Account', 'EGP')
on conflict (code) do nothing;

create table if not exists public.bank_statement_imports (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.bank_accounts(id) on delete restrict,
  filename text not null,
  file_size_bytes bigint null,
  status text not null default 'processing'
    check (status in ('processing','completed','failed')),
  row_count integer not null default 0,
  inserted_count integer not null default 0,
  duplicate_count integer not null default 0,
  skipped_count integer not null default 0,
  date_from date null,
  date_to date null,
  error_message text null,
  imported_by uuid null,
  created_at timestamptz not null default now(),
  completed_at timestamptz null
);

create index if not exists bank_statement_imports_account_created_idx
  on public.bank_statement_imports(account_id, created_at desc);

alter table public.bank_statement_imports enable row level security;

create table if not exists public.bank_transactions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.bank_accounts(id) on delete restrict,
  import_id uuid null references public.bank_statement_imports(id) on delete set null,
  transaction_date date not null,
  value_date date null,
  description text not null,
  reference text null,
  counterparty text null,
  amount numeric(14,2) not null,
  direction text not null check (direction in ('credit','debit')),
  running_balance numeric(14,2) null,
  currency text not null default 'EGP',
  fingerprint text not null,
  source_row integer null,
  raw_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(account_id, fingerprint)
);

create index if not exists bank_transactions_account_date_idx
  on public.bank_transactions(account_id, transaction_date desc);
create index if not exists bank_transactions_direction_date_idx
  on public.bank_transactions(direction, transaction_date desc);
create index if not exists bank_transactions_import_idx
  on public.bank_transactions(import_id);

alter table public.bank_transactions enable row level security;
