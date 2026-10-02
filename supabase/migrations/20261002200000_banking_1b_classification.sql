-- Banking 1B — Transaction Classification
-- Adds transparent, confirmable categorisation to Banking 1A.

alter table public.bank_transactions
  add column if not exists category_code text null,
  add column if not exists classification_status text not null default 'unclassified'
    check (classification_status in ('unclassified','suggested','confirmed')),
  add column if not exists classification_note text null,
  add column if not exists classification_source text null
    check (classification_source is null or classification_source in ('manual','rule')),
  add column if not exists classified_by uuid null,
  add column if not exists classified_at timestamptz null;

create index if not exists bank_transactions_classification_status_idx
  on public.bank_transactions(classification_status);
create index if not exists bank_transactions_category_idx
  on public.bank_transactions(category_code);

create table if not exists public.bank_categories (
  code text primary key,
  label text not null,
  direction_scope text not null default 'both'
    check (direction_scope in ('credit','debit','both')),
  sort_order integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.bank_categories enable row level security;

insert into public.bank_categories (code,label,direction_scope,sort_order)
values
  ('membership_income','Memberships','credit',10),
  ('private_coaching_income','Private Coaching','credit',20),
  ('store_income','Store','credit',30),
  ('competition_event_income','Competition / Events','credit',40),
  ('other_income','Other Income','credit',50),
  ('owner_contribution','Owner Contribution','credit',60),
  ('refund_reversal','Refund Reversal','credit',70),

  ('rent','Rent','debit',110),
  ('payroll','Payroll','debit',120),
  ('coach_payments','Coach Payments','debit',130),
  ('suppliers','Suppliers','debit',140),
  ('store_inventory','Store Inventory','debit',150),
  ('utilities','Utilities','debit',160),
  ('marketing','Marketing','debit',170),
  ('federation','Federation','debit',180),
  ('competition_event_expense','Competition / Events','debit',190),
  ('maintenance','Maintenance','debit',200),
  ('legal_accounting','Legal / Accounting','debit',210),
  ('bank_fees','Bank Fees','debit',220),
  ('taxes','Taxes','debit',230),
  ('refunds','Refunds','debit',240),
  ('other_expense','Other Expense','debit',250),

  ('internal_transfer','Internal Transfer','both',310),
  ('owner_withdrawal','Owner Withdrawal','debit',320),
  ('unknown','Unknown','both',999)
on conflict (code) do update
set label = excluded.label,
    direction_scope = excluded.direction_scope,
    sort_order = excluded.sort_order,
    is_active = true;

create table if not exists public.bank_classification_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category_code text not null references public.bank_categories(code) on delete restrict,
  direction_scope text not null default 'both'
    check (direction_scope in ('credit','debit','both')),
  match_field text not null default 'combined'
    check (match_field in ('combined','description','counterparty','reference')),
  pattern text not null,
  priority integer not null default 100,
  is_active boolean not null default true,
  created_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bank_classification_rules_priority_idx
  on public.bank_classification_rules(is_active, priority);

alter table public.bank_classification_rules enable row level security;

-- Conservative initial suggestions only.
insert into public.bank_classification_rules
  (name,category_code,direction_scope,match_field,pattern,priority)
values
  ('Bank fees keywords','bank_fees','debit','combined','fee|fees|commission|charges|bank charge',10),
  ('Telecom utilities','utilities','debit','combined','vodafone|orange|etisalat|we telecom|telecom',20),
  ('Federation keywords','federation','debit','combined','federation|اتحاد',30),
  ('Tax keywords','taxes','debit','combined','tax|vat|ضريبة',40),
  ('Rent keywords','rent','debit','combined','rent|mall|lease|ايجار|إيجار',50)
on conflict do nothing;
