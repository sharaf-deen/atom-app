-- Reconciliation 1D — Bank Statement Matching
-- Adds an auditable bank-statement layer on top of the existing reconciliation engine.
--
-- Principles:
--   * Reliable baseline remains 2026-08-01.
--   * Original ATOM payments and reconciliation batches are never modified by matching.
--   * Admin / Super Admin can read.
--   * Only Super Admin can import statements, match lines and release matches.
--   * One bank line can belong to only one active batch.
--   * One batch can contain many bank lines (important for Instapay / grouped deposits).
--   * Releasing a match is audited; match rows are never deleted by the application.

begin;

create table if not exists public.reconciliation_bank_imports (
  id uuid primary key default gen_random_uuid(),
  bank_name text not null default 'CIB',
  account_label text null,
  statement_from date not null,
  statement_to date not null,
  original_filename text not null,
  storage_path text not null,
  mime_type text null,
  file_size_bytes bigint not null,
  file_sha256 text not null,
  row_count integer not null,
  skipped_row_count integer not null default 0,
  total_credit numeric(14,2) not null default 0,
  total_debit numeric(14,2) not null default 0,
  imported_at timestamptz not null default now(),
  imported_by uuid null references public.profiles(user_id) on delete set null,

  constraint reconciliation_bank_imports_period_chk
    check (statement_from >= date '2026-08-01' and statement_to >= statement_from),
  constraint reconciliation_bank_imports_filename_len_chk
    check (char_length(original_filename) between 1 and 240),
  constraint reconciliation_bank_imports_path_len_chk
    check (char_length(storage_path) between 1 and 600),
  constraint reconciliation_bank_imports_sha_chk
    check (file_sha256 ~ '^[0-9a-f]{64}$'),
  constraint reconciliation_bank_imports_file_size_chk
    check (file_size_bytes > 0),
  constraint reconciliation_bank_imports_row_count_chk
    check (row_count > 0 and skipped_row_count >= 0),
  constraint reconciliation_bank_imports_totals_chk
    check (total_credit >= 0 and total_debit >= 0)
);

create unique index if not exists reconciliation_bank_imports_sha_uidx
  on public.reconciliation_bank_imports(file_sha256);

create index if not exists reconciliation_bank_imports_period_idx
  on public.reconciliation_bank_imports(statement_from desc, statement_to desc);

create table if not exists public.reconciliation_bank_statement_lines (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.reconciliation_bank_imports(id) on delete restrict,
  row_number integer not null,
  transaction_date date not null,
  value_date date null,
  description text null,
  reference text null,
  debit_amount numeric(14,2) not null default 0,
  credit_amount numeric(14,2) not null default 0,
  currency text not null default 'EGP',
  raw_payload jsonb null,
  created_at timestamptz not null default now(),

  constraint reconciliation_bank_statement_lines_row_chk check (row_number > 0),
  constraint reconciliation_bank_statement_lines_baseline_chk
    check (transaction_date >= date '2026-08-01'),
  constraint reconciliation_bank_statement_lines_amount_chk
    check (
      (credit_amount > 0 and debit_amount = 0)
      or (debit_amount > 0 and credit_amount = 0)
    ),
  constraint reconciliation_bank_statement_lines_currency_chk
    check (char_length(currency) between 3 and 8),
  constraint reconciliation_bank_statement_lines_description_len_chk
    check (description is null or char_length(description) <= 1000),
  constraint reconciliation_bank_statement_lines_reference_len_chk
    check (reference is null or char_length(reference) <= 300),
  unique(import_id, row_number)
);

create index if not exists reconciliation_bank_statement_lines_date_idx
  on public.reconciliation_bank_statement_lines(transaction_date desc);

create index if not exists reconciliation_bank_statement_lines_credit_idx
  on public.reconciliation_bank_statement_lines(transaction_date desc, credit_amount)
  where credit_amount > 0;

create table if not exists public.reconciliation_bank_matches (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.payment_validation_batches(id) on delete restrict,
  statement_line_id uuid not null references public.reconciliation_bank_statement_lines(id) on delete restrict,
  matched_amount numeric(14,2) not null,
  note text null,
  matched_at timestamptz not null default now(),
  matched_by uuid null references public.profiles(user_id) on delete set null,
  released_at timestamptz null,
  released_by uuid null references public.profiles(user_id) on delete set null,
  release_reason text null,

  constraint reconciliation_bank_matches_amount_chk check (matched_amount > 0),
  constraint reconciliation_bank_matches_note_len_chk
    check (note is null or char_length(note) <= 500),
  constraint reconciliation_bank_matches_release_chk
    check (
      (released_at is null and released_by is null and release_reason is null)
      or (
        released_at is not null
        and nullif(btrim(coalesce(release_reason, '')), '') is not null
        and char_length(release_reason) <= 500
      )
    )
);

create unique index if not exists reconciliation_bank_matches_active_line_uidx
  on public.reconciliation_bank_matches(statement_line_id)
  where released_at is null;

create index if not exists reconciliation_bank_matches_batch_idx
  on public.reconciliation_bank_matches(batch_id, matched_at desc);

create index if not exists reconciliation_bank_matches_line_idx
  on public.reconciliation_bank_matches(statement_line_id, matched_at desc);

alter table public.reconciliation_bank_imports enable row level security;
alter table public.reconciliation_bank_statement_lines enable row level security;
alter table public.reconciliation_bank_matches enable row level security;

drop policy if exists "admin read reconciliation bank imports" on public.reconciliation_bank_imports;
create policy "admin read reconciliation bank imports"
  on public.reconciliation_bank_imports for select
  using (public.is_admin_or_super_admin(auth.uid()));

drop policy if exists "super admin add reconciliation bank imports" on public.reconciliation_bank_imports;
create policy "super admin add reconciliation bank imports"
  on public.reconciliation_bank_imports for insert
  with check (public.is_super_admin(auth.uid()));

drop policy if exists "admin read reconciliation bank lines" on public.reconciliation_bank_statement_lines;
create policy "admin read reconciliation bank lines"
  on public.reconciliation_bank_statement_lines for select
  using (public.is_admin_or_super_admin(auth.uid()));

drop policy if exists "super admin add reconciliation bank lines" on public.reconciliation_bank_statement_lines;
create policy "super admin add reconciliation bank lines"
  on public.reconciliation_bank_statement_lines for insert
  with check (public.is_super_admin(auth.uid()));

drop policy if exists "admin read reconciliation bank matches" on public.reconciliation_bank_matches;
create policy "admin read reconciliation bank matches"
  on public.reconciliation_bank_matches for select
  using (public.is_admin_or_super_admin(auth.uid()));

drop policy if exists "super admin add reconciliation bank matches" on public.reconciliation_bank_matches;
create policy "super admin add reconciliation bank matches"
  on public.reconciliation_bank_matches for insert
  with check (public.is_super_admin(auth.uid()));

drop policy if exists "super admin release reconciliation bank matches" on public.reconciliation_bank_matches;
create policy "super admin release reconciliation bank matches"
  on public.reconciliation_bank_matches for update
  using (public.is_super_admin(auth.uid()))
  with check (public.is_super_admin(auth.uid()));

revoke all on table public.reconciliation_bank_imports from authenticated;
revoke all on table public.reconciliation_bank_statement_lines from authenticated;
revoke all on table public.reconciliation_bank_matches from authenticated;

grant select, insert on table public.reconciliation_bank_imports to authenticated;
grant select, insert on table public.reconciliation_bank_statement_lines to authenticated;
grant select, insert, update on table public.reconciliation_bank_matches to authenticated;

grant select, insert, update, delete on table public.reconciliation_bank_imports to service_role;
grant select, insert, update, delete on table public.reconciliation_bank_statement_lines to service_role;
grant select, insert, update, delete on table public.reconciliation_bank_matches to service_role;

comment on table public.reconciliation_bank_imports is
  'Imported bank-statement files used by Reconciliation 1D. Reliable baseline starts 2026-08-01.';
comment on table public.reconciliation_bank_statement_lines is
  'Immutable normalized bank-statement lines imported from CSV. Debits are preserved; only credits are eligible for batch matching.';
comment on table public.reconciliation_bank_matches is
  'Auditable links between bank credits and payment reconciliation batches. A batch may have many lines; a bank line may have only one active match.';

insert into storage.buckets (id, name, public)
values ('reconciliation-bank-statements', 'reconciliation-bank-statements', false)
on conflict (id) do nothing;

commit;
