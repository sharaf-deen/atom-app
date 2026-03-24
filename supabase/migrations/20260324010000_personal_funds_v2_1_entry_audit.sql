begin;

alter table public.personal_fund_entries
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists updated_by uuid null references public.profiles(user_id) on delete set null;

update public.personal_fund_entries
set updated_at = coalesce(updated_at, created_at, now()),
    updated_by = coalesce(updated_by, created_by)
where updated_at is null or updated_by is null;

create index if not exists personal_fund_entries_updated_at_idx
  on public.personal_fund_entries (updated_at desc);

DROP TRIGGER IF EXISTS trg_personal_fund_entries_set_updated_at ON public.personal_fund_entries;
create trigger trg_personal_fund_entries_set_updated_at
before update on public.personal_fund_entries
for each row execute function public.set_updated_at();

commit;
