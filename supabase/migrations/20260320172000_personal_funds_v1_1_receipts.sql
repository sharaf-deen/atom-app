-- Personal Funds V1.1
-- Add optional private receipt/invoice proof for personal fund entries.

alter table public.personal_fund_entries
  add column if not exists receipt_path text,
  add column if not exists receipt_mime text,
  add column if not exists receipt_filename text,
  add column if not exists receipt_size_bytes bigint;

insert into storage.buckets (id, name, public)
values ('personal-fund-receipts', 'personal-fund-receipts', false)
on conflict (id) do nothing;
