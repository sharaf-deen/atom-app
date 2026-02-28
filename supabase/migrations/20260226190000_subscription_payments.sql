-- Subscription payments history (for Cash Report + Payment timeline)

create table if not exists public.subscription_payments (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  member_id uuid not null references public.profiles(user_id) on delete cascade,
  amount numeric(10,2) not null,
  payment_method text not null default 'cash',
  note text null,
  created_by uuid null references public.profiles(user_id) on delete set null,
  created_at timestamptz not null default now()
);

-- Constraints
do $$
begin
  alter table public.subscription_payments
    add constraint subscription_payments_amount_pos check (amount > 0) not valid;
exception when duplicate_object then null;
end $$;
alter table public.subscription_payments validate constraint subscription_payments_amount_pos;

do $$
begin
  alter table public.subscription_payments
    add constraint subscription_payments_method_chk
      check (payment_method in ('cash','instapay','card','bank_transfer')) not valid;
exception when duplicate_object then null;
end $$;
alter table public.subscription_payments validate constraint subscription_payments_method_chk;

-- Helpful indexes
create index if not exists subscription_payments_subscription_id_idx on public.subscription_payments(subscription_id);
create index if not exists subscription_payments_member_id_idx on public.subscription_payments(member_id);
create index if not exists subscription_payments_created_at_idx on public.subscription_payments(created_at);

-- Optional RLS (service role bypasses anyway)
alter table public.subscription_payments enable row level security;

do $$
begin
  create policy "staff read subscription_payments"
    on public.subscription_payments for select
    using (
      exists (
        select 1 from public.profiles p
        where p.user_id = auth.uid()
          and p.role in ('admin','super_admin')
      )
    );
exception when duplicate_object then null;
end $$;

do $$
begin
  create policy "staff insert subscription_payments"
    on public.subscription_payments for insert
    with check (
      exists (
        select 1 from public.profiles p
        where p.user_id = auth.uid()
          and p.role in ('admin','super_admin')
      )
    );
exception when duplicate_object then null;
end $$;