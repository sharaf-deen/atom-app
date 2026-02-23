-- Add payment method + remaining due to subscriptions
-- Used in Member profile (Subscriptions table) and invoices

alter table public.subscriptions
  add column if not exists payment_method text not null default 'cash',
  add column if not exists amount_due numeric(10,2) not null default 0;

-- Allowed payment methods for subscriptions
do $$
begin
  alter table public.subscriptions
    add constraint subscriptions_payment_method_check
    check (payment_method in ('cash','instapay','card','bank_transfer')) not valid;
exception
  when duplicate_object then null;
end $$;

alter table public.subscriptions
  validate constraint subscriptions_payment_method_check;

-- Basic guards for amount_due
do $$
begin
  alter table public.subscriptions
    add constraint subscriptions_amount_due_nonneg
    check (amount_due >= 0) not valid;
exception
  when duplicate_object then null;
end $$;

alter table public.subscriptions
  validate constraint subscriptions_amount_due_nonneg;

do $$
begin
  alter table public.subscriptions
    add constraint subscriptions_amount_due_le_amount
    check (amount is null or amount_due <= amount) not valid;
exception
  when duplicate_object then null;
end $$;

alter table public.subscriptions
  validate constraint subscriptions_amount_due_le_amount;
