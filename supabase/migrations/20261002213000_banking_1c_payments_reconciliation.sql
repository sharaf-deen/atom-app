-- Banking 1C — Payments Reconciliation Integration
-- Links Banking bank_transactions to existing payment validation batches.
-- Existing Reconciliation 1D bank-statement history remains untouched.

create table if not exists public.bank_payment_matches (
  id uuid primary key default gen_random_uuid(),
  bank_transaction_id uuid not null
    references public.bank_transactions(id) on delete restrict,
  batch_id uuid not null
    references public.payment_validation_batches(id) on delete restrict,
  matched_amount numeric(14,2) not null,
  note text null,
  matched_at timestamptz not null default now(),
  matched_by uuid null,
  released_at timestamptz null,
  released_by uuid null,
  release_reason text null,
  constraint bank_payment_matches_amount_chk check (matched_amount > 0),
  constraint bank_payment_matches_note_len_chk check (note is null or char_length(note) <= 500),
  constraint bank_payment_matches_release_chk check (
    (released_at is null and released_by is null and release_reason is null)
    or (
      released_at is not null
      and nullif(btrim(coalesce(release_reason, '')), '') is not null
      and char_length(release_reason) <= 500
    )
  )
);

create unique index if not exists bank_payment_matches_active_pair_uidx
  on public.bank_payment_matches(bank_transaction_id, batch_id)
  where released_at is null;

create index if not exists bank_payment_matches_transaction_idx
  on public.bank_payment_matches(bank_transaction_id, matched_at desc);

create index if not exists bank_payment_matches_batch_idx
  on public.bank_payment_matches(batch_id, matched_at desc);

alter table public.bank_payment_matches enable row level security;

comment on table public.bank_payment_matches is
  'Auditable Banking 1C allocations between Banking bank credits and Payments Reconciliation validation batches. Many-to-many allocations are allowed; released rows remain historical.';
