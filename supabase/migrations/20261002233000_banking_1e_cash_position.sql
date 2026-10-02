-- Banking 1E — Cash Position Dashboard
-- Manual future cash commitments complement derived ATOM obligations.

create table if not exists public.bank_cash_commitments (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  category_code text not null
    check (category_code in (
      'rent','supplier','utilities','taxes','legal_accounting',
      'federation','marketing','maintenance','payroll_other','other'
    )),
  amount numeric(14,2) not null check (amount > 0),
  due_date date not null,
  note text null,
  status text not null default 'open'
    check (status in ('open','settled','cancelled')),
  created_at timestamptz not null default now(),
  created_by uuid null,
  updated_at timestamptz not null default now(),
  updated_by uuid null,
  settled_at timestamptz null,
  settled_by uuid null,
  cancelled_at timestamptz null,
  cancelled_by uuid null,
  cancellation_reason text null,

  constraint bank_cash_commitments_label_chk
    check (char_length(btrim(label)) between 1 and 200),
  constraint bank_cash_commitments_note_chk
    check (note is null or char_length(note) <= 1000),
  constraint bank_cash_commitments_cancel_reason_chk
    check (cancellation_reason is null or char_length(btrim(cancellation_reason)) between 3 and 500),
  constraint bank_cash_commitments_state_chk
    check (
      (status = 'open'
        and settled_at is null
        and settled_by is null
        and cancelled_at is null
        and cancelled_by is null
        and cancellation_reason is null)
      or
      (status = 'settled'
        and settled_at is not null
        and cancelled_at is null
        and cancellation_reason is null)
      or
      (status = 'cancelled'
        and cancelled_at is not null
        and cancellation_reason is not null
        and settled_at is null)
    )
);

create index if not exists bank_cash_commitments_due_open_idx
  on public.bank_cash_commitments(due_date, created_at)
  where status = 'open';

alter table public.bank_cash_commitments enable row level security;

comment on table public.bank_cash_commitments is
  'Manual future cash obligations used by Banking 1E. Does not create Expenses or bank transactions.';
