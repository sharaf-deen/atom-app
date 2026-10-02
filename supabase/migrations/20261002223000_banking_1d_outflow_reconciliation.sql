-- Banking 1D — Expenses & Outflows Reconciliation
-- Auditable matching of bank debits to existing ATOM outflow records.

create table if not exists public.bank_outflow_matches (
  id uuid primary key default gen_random_uuid(),
  bank_transaction_id uuid not null
    references public.bank_transactions(id) on delete restrict,
  source_kind text not null
    check (source_kind in ('expense','staff_payroll_payment','membership_refund')),
  source_id uuid not null,
  matched_amount numeric(14,2) not null,
  note text null,
  matched_at timestamptz not null default now(),
  matched_by uuid null,
  released_at timestamptz null,
  released_by uuid null,
  release_reason text null,

  constraint bank_outflow_matches_amount_chk check (matched_amount > 0),
  constraint bank_outflow_matches_note_len_chk
    check (note is null or char_length(note) <= 500),
  constraint bank_outflow_matches_release_chk
    check (
      (released_at is null and released_by is null and release_reason is null)
      or (
        released_at is not null
        and nullif(btrim(coalesce(release_reason, '')), '') is not null
        and char_length(release_reason) <= 500
      )
    )
);

create unique index if not exists bank_outflow_matches_active_pair_uidx
  on public.bank_outflow_matches(bank_transaction_id, source_kind, source_id)
  where released_at is null;

create index if not exists bank_outflow_matches_transaction_idx
  on public.bank_outflow_matches(bank_transaction_id, matched_at desc);

create index if not exists bank_outflow_matches_source_idx
  on public.bank_outflow_matches(source_kind, source_id, matched_at desc);

alter table public.bank_outflow_matches enable row level security;

comment on table public.bank_outflow_matches is
  'Auditable Banking 1D allocations between bank debits and existing ATOM expense, payroll-payment or paid-refund records. Released rows remain historical.';
