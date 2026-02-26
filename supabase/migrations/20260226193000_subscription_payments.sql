-- Subscription payments history (cash report + audit-friendly partial payments)

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

-- Amount must be > 0
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'subscription_payments_amount_pos'
  ) THEN
    ALTER TABLE public.subscription_payments
      ADD CONSTRAINT subscription_payments_amount_pos CHECK (amount > 0) NOT VALID;
  END IF;
END $$;
ALTER TABLE public.subscription_payments VALIDATE CONSTRAINT subscription_payments_amount_pos;

-- Allowed payment methods
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'subscription_payments_method_chk'
  ) THEN
    ALTER TABLE public.subscription_payments
      ADD CONSTRAINT subscription_payments_method_chk
      CHECK (payment_method in ('cash','instapay','card','bank_transfer')) NOT VALID;
  END IF;
END $$;
ALTER TABLE public.subscription_payments VALIDATE CONSTRAINT subscription_payments_method_chk;

-- Indexes
create index if not exists subscription_payments_subscription_id_idx on public.subscription_payments(subscription_id);
create index if not exists subscription_payments_member_id_idx on public.subscription_payments(member_id);
create index if not exists subscription_payments_created_at_idx on public.subscription_payments(created_at);

-- RLS (service role bypasses)
alter table public.subscription_payments enable row level security;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'staff read subscription_payments'
  ) THEN
    CREATE POLICY "staff read subscription_payments"
      ON public.subscription_payments
      FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.user_id = auth.uid()
            AND p.role in ('admin','super_admin')
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'staff insert subscription_payments'
  ) THEN
    CREATE POLICY "staff insert subscription_payments"
      ON public.subscription_payments
      FOR INSERT
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.user_id = auth.uid()
            AND p.role in ('admin','super_admin')
        )
      );
  END IF;
END $$;
