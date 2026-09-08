-- Reconciliation 1C — Evidence / Proof
-- Adds append-only supporting evidence for reconciliation batches.
-- Governance remains aligned with 1B:
--   * Admin / Super Admin can read evidence.
--   * Only Super Admin can add evidence.
--   * No update/delete policy is granted to authenticated users.
-- Evidence never modifies original payments, income source rows, batch amounts,
-- validation status, or the 2026-08-01 reconciliation baseline.

begin;

create table if not exists public.payment_validation_batch_evidence (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null
    references public.payment_validation_batches(id)
    on delete restrict,
  reference text null,
  proof_path text null,
  original_filename text null,
  mime_type text null,
  file_size_bytes bigint null,
  created_at timestamptz not null default now(),
  created_by uuid null
    references public.profiles(user_id)
    on delete set null,

  constraint payment_validation_batch_evidence_payload_chk
    check (
      nullif(btrim(coalesce(reference, '')), '') is not null
      or nullif(btrim(coalesce(proof_path, '')), '') is not null
    ),
  constraint payment_validation_batch_evidence_reference_len_chk
    check (reference is null or char_length(reference) <= 250),
  constraint payment_validation_batch_evidence_path_len_chk
    check (proof_path is null or char_length(proof_path) <= 600),
  constraint payment_validation_batch_evidence_filename_len_chk
    check (original_filename is null or char_length(original_filename) <= 240),
  constraint payment_validation_batch_evidence_mime_len_chk
    check (mime_type is null or char_length(mime_type) <= 100),
  constraint payment_validation_batch_evidence_size_chk
    check (file_size_bytes is null or file_size_bytes > 0),
  constraint payment_validation_batch_evidence_file_meta_chk
    check (
      proof_path is not null
      or (
        original_filename is null
        and mime_type is null
        and file_size_bytes is null
      )
    )
);

create index if not exists payment_validation_batch_evidence_batch_created_idx
  on public.payment_validation_batch_evidence (batch_id, created_at desc);

create unique index if not exists payment_validation_batch_evidence_proof_path_uidx
  on public.payment_validation_batch_evidence (proof_path)
  where proof_path is not null;

alter table public.payment_validation_batch_evidence enable row level security;

drop policy if exists "admin read payment validation evidence"
  on public.payment_validation_batch_evidence;

create policy "admin read payment validation evidence"
  on public.payment_validation_batch_evidence
  for select
  using (public.is_admin_or_super_admin(auth.uid()));

drop policy if exists "super admin add payment validation evidence"
  on public.payment_validation_batch_evidence;

create policy "super admin add payment validation evidence"
  on public.payment_validation_batch_evidence
  for insert
  with check (public.is_super_admin(auth.uid()));

revoke all on table public.payment_validation_batch_evidence from authenticated;
grant select, insert on table public.payment_validation_batch_evidence to authenticated;
grant select, insert, update, delete on table public.payment_validation_batch_evidence to service_role;

comment on table public.payment_validation_batch_evidence is
  'Append-only references and private proof files supporting payment reconciliation batches. Admin can read; Super Admin can add.';

insert into storage.buckets (id, name, public)
values ('reconciliation-proofs', 'reconciliation-proofs', false)
on conflict (id) do nothing;

commit;
