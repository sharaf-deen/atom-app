-- Add real payment timestamp for accounting without changing technical created_at

alter table public.subscription_payments
  add column if not exists paid_at timestamptz;

update public.subscription_payments
set paid_at = created_at
where paid_at is null;

alter table public.subscription_payments
  alter column paid_at set default now();

alter table public.subscription_payments
  alter column paid_at set not null;

create index if not exists subscription_payments_paid_at_idx
  on public.subscription_payments(paid_at desc);
