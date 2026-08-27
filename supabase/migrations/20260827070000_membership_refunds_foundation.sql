-- Membership Refunds Lot 1A — exceptional refund record
-- Creates a separate, auditable refund record.
-- This does not modify subscriptions, subscription payments, member access, freezes, Store, Cash, or Payment Reconciliation.

create table if not exists public.membership_refunds (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles(user_id) on delete cascade,
  subscription_id uuid null references public.subscriptions(id) on delete set null,
  amount numeric(10,2) not null,
  refund_method text not null default 'bank_transfer',
  reason text not null,
  internal_note text null,
  proof_url text null,
  status text not null default 'paid',
  refunded_at timestamptz not null default now(),
  created_by uuid null references public.profiles(user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'membership_refunds_amount_positive') then
    alter table public.membership_refunds
      add constraint membership_refunds_amount_positive
      check (amount > 0) not valid;
  end if;
end $$;
alter table public.membership_refunds validate constraint membership_refunds_amount_positive;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'membership_refunds_method_chk') then
    alter table public.membership_refunds
      add constraint membership_refunds_method_chk
      check (refund_method in ('cash','instapay','card','bank_transfer')) not valid;
  end if;
end $$;
alter table public.membership_refunds validate constraint membership_refunds_method_chk;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'membership_refunds_status_chk') then
    alter table public.membership_refunds
      add constraint membership_refunds_status_chk
      check (status in ('paid','cancelled')) not valid;
  end if;
end $$;
alter table public.membership_refunds validate constraint membership_refunds_status_chk;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'membership_refunds_reason_required') then
    alter table public.membership_refunds
      add constraint membership_refunds_reason_required
      check (length(btrim(reason)) >= 3) not valid;
  end if;
end $$;
alter table public.membership_refunds validate constraint membership_refunds_reason_required;

create index if not exists membership_refunds_member_id_idx on public.membership_refunds(member_id);
create index if not exists membership_refunds_subscription_id_idx on public.membership_refunds(subscription_id);
create index if not exists membership_refunds_status_idx on public.membership_refunds(status);
create index if not exists membership_refunds_refunded_at_idx on public.membership_refunds(refunded_at desc);
create index if not exists membership_refunds_created_at_idx on public.membership_refunds(created_at desc);

create or replace function public.set_membership_refunds_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_membership_refunds_updated_at on public.membership_refunds;
create trigger trg_membership_refunds_updated_at
before update on public.membership_refunds
for each row
execute function public.set_membership_refunds_updated_at();

alter table public.membership_refunds enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'membership_refunds' and policyname = 'admin read membership_refunds'
  ) then
    create policy "admin read membership_refunds"
      on public.membership_refunds
      for select
      using (
        exists (
          select 1 from public.profiles p
          where p.user_id = auth.uid()
            and p.role in ('admin','super_admin')
        )
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'membership_refunds' and policyname = 'admin insert membership_refunds'
  ) then
    create policy "admin insert membership_refunds"
      on public.membership_refunds
      for insert
      with check (
        exists (
          select 1 from public.profiles p
          where p.user_id = auth.uid()
            and p.role in ('admin','super_admin')
        )
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'membership_refunds' and policyname = 'admin update membership_refunds'
  ) then
    create policy "admin update membership_refunds"
      on public.membership_refunds
      for update
      using (
        exists (
          select 1 from public.profiles p
          where p.user_id = auth.uid()
            and p.role in ('admin','super_admin')
        )
      )
      with check (
        exists (
          select 1 from public.profiles p
          where p.user_id = auth.uid()
            and p.role in ('admin','super_admin')
        )
      );
  end if;
end $$;

grant select, insert, update on public.membership_refunds to authenticated;
