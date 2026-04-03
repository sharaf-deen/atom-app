-- External Income V1
-- Tracks money entries outside subscriptions (bar, store, other).

begin;

create table if not exists public.external_income_entries (
  id uuid primary key default gen_random_uuid(),
  entry_date date not null default ((now() at time zone 'Africa/Cairo')::date),
  source_key text not null,
  title text not null,
  amount numeric(12,2) not null,
  payment_method text null,
  note text null,
  created_at timestamptz not null default now(),
  created_by uuid null references public.profiles(user_id) on delete set null,
  updated_at timestamptz null,
  updated_by uuid null references public.profiles(user_id) on delete set null,
  attachment_path text null,
  attachment_mime text null,
  attachment_filename text null,
  attachment_size_bytes bigint null
);

create index if not exists external_income_entries_entry_date_idx
  on public.external_income_entries (entry_date desc);

create index if not exists external_income_entries_source_idx
  on public.external_income_entries (source_key);

create index if not exists external_income_entries_created_at_idx
  on public.external_income_entries (created_at desc);

create index if not exists external_income_entries_created_by_idx
  on public.external_income_entries (created_by);

do $$
begin
  alter table public.external_income_entries
    add constraint external_income_entries_source_chk
    check (source_key in ('bar', 'store', 'other')) not valid;
exception when duplicate_object then null;
end $$;
alter table public.external_income_entries validate constraint external_income_entries_source_chk;

do $$
begin
  alter table public.external_income_entries
    add constraint external_income_entries_title_not_blank
    check (btrim(title) <> '') not valid;
exception when duplicate_object then null;
end $$;
alter table public.external_income_entries validate constraint external_income_entries_title_not_blank;

do $$
begin
  alter table public.external_income_entries
    add constraint external_income_entries_amount_pos
    check (amount > 0) not valid;
exception when duplicate_object then null;
end $$;
alter table public.external_income_entries validate constraint external_income_entries_amount_pos;

do $$
begin
  alter table public.external_income_entries
    add constraint external_income_entries_method_chk
    check (payment_method is null or payment_method in ('cash', 'visa', 'instapay', 'bank_transfer')) not valid;
exception when duplicate_object then null;
end $$;
alter table public.external_income_entries validate constraint external_income_entries_method_chk;

alter table public.external_income_entries enable row level security;

do $$
begin
  create policy "admin read external_income_entries"
    on public.external_income_entries for select
    using (public.is_admin_or_super_admin(auth.uid()));
exception when duplicate_object then null;
end $$;

do $$
begin
  create policy "admin write external_income_entries"
    on public.external_income_entries for all
    using (public.is_admin_or_super_admin(auth.uid()))
    with check (public.is_admin_or_super_admin(auth.uid()));
exception when duplicate_object then null;
end $$;

grant select, insert, update, delete on table public.external_income_entries to authenticated, service_role;

insert into storage.buckets (id, name, public)
values ('external-income-attachments', 'external-income-attachments', false)
on conflict (id) do nothing;

commit;
