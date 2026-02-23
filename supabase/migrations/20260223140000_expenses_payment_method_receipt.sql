-- Add payment method + receipt attachment to expenses

-- 1) Columns
alter table public.expenses
  add column if not exists payment_method text,
  add column if not exists receipt_path text,
  add column if not exists receipt_mime text,
  add column if not exists receipt_filename text;

-- Backfill existing rows
update public.expenses
set payment_method = 'cash'
where payment_method is null;

-- Defaults & constraints
alter table public.expenses
  alter column payment_method set default 'cash',
  alter column payment_method set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'expenses_payment_method_check'
  ) then
    alter table public.expenses
      add constraint expenses_payment_method_check
      check (payment_method in ('cash','visa','instapay','bank_transfer')) not valid;
  end if;
end $$;

alter table public.expenses validate constraint expenses_payment_method_check;

-- 2) Storage bucket for receipts (private)
insert into storage.buckets (id, name, public)
values ('expense-receipts', 'expense-receipts', false)
on conflict (id) do nothing;
