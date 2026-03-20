-- Personal Funds V1 (isolated from Cash Report / Payments)
-- Tracks partner advances, gym expenses paid personally, and reimbursements.

begin;

create table if not exists public.personal_fund_people (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  is_active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  created_by uuid null references public.profiles(user_id) on delete set null
);

create table if not exists public.personal_fund_entries (
  id uuid primary key default gen_random_uuid(),
  entry_date date not null default ((now() at time zone 'Africa/Cairo')::date),
  person_id uuid not null references public.personal_fund_people(id) on delete restrict,
  kind text not null,
  amount numeric(12,2) not null,
  payment_method text null,
  note text null,
  created_at timestamptz not null default now(),
  created_by uuid null references public.profiles(user_id) on delete set null
);

do $$
begin
  create unique index if not exists personal_fund_people_label_lower_uidx
    on public.personal_fund_people (lower(label));
exception when others then null;
end $$;

create index if not exists personal_fund_people_active_sort_idx
  on public.personal_fund_people (is_active, sort_order, label);

create index if not exists personal_fund_entries_entry_date_idx
  on public.personal_fund_entries (entry_date desc);

create index if not exists personal_fund_entries_person_id_idx
  on public.personal_fund_entries (person_id);

create index if not exists personal_fund_entries_kind_idx
  on public.personal_fund_entries (kind);

create index if not exists personal_fund_entries_created_at_idx
  on public.personal_fund_entries (created_at desc);

do $$
begin
  alter table public.personal_fund_people
    add constraint personal_fund_people_label_not_blank
    check (btrim(label) <> '') not valid;
exception when duplicate_object then null;
end $$;
alter table public.personal_fund_people validate constraint personal_fund_people_label_not_blank;

do $$
begin
  alter table public.personal_fund_entries
    add constraint personal_fund_entries_kind_chk
    check (kind in ('advance_to_gym', 'expense_paid_personally', 'reimbursement_from_gym')) not valid;
exception when duplicate_object then null;
end $$;
alter table public.personal_fund_entries validate constraint personal_fund_entries_kind_chk;

do $$
begin
  alter table public.personal_fund_entries
    add constraint personal_fund_entries_amount_pos
    check (amount > 0) not valid;
exception when duplicate_object then null;
end $$;
alter table public.personal_fund_entries validate constraint personal_fund_entries_amount_pos;

do $$
begin
  alter table public.personal_fund_entries
    add constraint personal_fund_entries_method_chk
    check (payment_method is null or payment_method in ('cash', 'visa', 'instapay', 'bank_transfer')) not valid;
exception when duplicate_object then null;
end $$;
alter table public.personal_fund_entries validate constraint personal_fund_entries_method_chk;

alter table public.personal_fund_people enable row level security;
alter table public.personal_fund_entries enable row level security;

do $$
begin
  create policy "admin read personal_fund_people"
    on public.personal_fund_people for select
    using (public.is_admin_or_super_admin(auth.uid()));
exception when duplicate_object then null;
end $$;

do $$
begin
  create policy "admin write personal_fund_people"
    on public.personal_fund_people for all
    using (public.is_admin_or_super_admin(auth.uid()))
    with check (public.is_admin_or_super_admin(auth.uid()));
exception when duplicate_object then null;
end $$;

do $$
begin
  create policy "admin read personal_fund_entries"
    on public.personal_fund_entries for select
    using (public.is_admin_or_super_admin(auth.uid()));
exception when duplicate_object then null;
end $$;

do $$
begin
  create policy "admin write personal_fund_entries"
    on public.personal_fund_entries for all
    using (public.is_admin_or_super_admin(auth.uid()))
    with check (public.is_admin_or_super_admin(auth.uid()));
exception when duplicate_object then null;
end $$;

grant select, insert, update, delete on table public.personal_fund_people to authenticated, service_role;
grant select, insert, update, delete on table public.personal_fund_entries to authenticated, service_role;

commit;
