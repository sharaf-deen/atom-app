-- Payments reconciliation / validation foundation
-- Scope intentionally limited to subscriptions + external income.
-- Store cashflows are excluded from this first lot to avoid regressions.

begin;

create or replace function public.normalize_payment_method(input text)
returns text
language sql
immutable
as $$
  select case
    when input is null then null
    when btrim(lower(input)) in ('cash') then 'cash'
    when btrim(lower(input)) in ('instapay', 'insta pay', 'insta_pay') then 'instapay'
    when btrim(lower(input)) in ('card', 'visa', 'visa card', 'visa_card') then 'card'
    when btrim(lower(input)) in ('bank_transfer', 'bank transfer', 'transfer') then 'bank_transfer'
    else btrim(lower(input))
  end
$$;

create table if not exists public.payment_validation_approvers (
  user_id uuid primary key references public.profiles(user_id) on delete cascade,
  is_active boolean not null default true,
  note text null,
  created_at timestamptz not null default now(),
  created_by uuid null references public.profiles(user_id) on delete set null,
  updated_at timestamptz null,
  updated_by uuid null references public.profiles(user_id) on delete set null
);

create index if not exists payment_validation_approvers_active_idx
  on public.payment_validation_approvers (is_active)
  where is_active = true;

create or replace function public.is_payment_validation_approver(p_uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (
    public.is_super_admin(p_uid)
    or exists (
      select 1
      from public.payment_validation_approvers a
      where a.user_id = p_uid
        and a.is_active = true
    )
  );
$$;

create table if not exists public.payment_validation_batches (
  id uuid primary key default gen_random_uuid(),
  payment_method text not null,
  validation_mode text not null,
  business_date date null,
  period_from timestamptz not null,
  period_to timestamptz not null,
  expected_amount numeric(12,2) not null,
  counted_amount numeric(12,2) not null,
  difference_amount numeric(12,2) not null default 0,
  note text null,
  validated_by uuid null references public.profiles(user_id) on delete set null,
  validated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  created_by uuid null references public.profiles(user_id) on delete set null,
  updated_at timestamptz null,
  updated_by uuid null references public.profiles(user_id) on delete set null,
  deleted_at timestamptz null,
  deleted_by uuid null references public.profiles(user_id) on delete set null
);

create index if not exists payment_validation_batches_method_date_idx
  on public.payment_validation_batches (payment_method, business_date, validated_at desc)
  where deleted_at is null;

create index if not exists payment_validation_batches_period_idx
  on public.payment_validation_batches (period_from desc, period_to desc)
  where deleted_at is null;

create index if not exists payment_validation_batches_validated_by_idx
  on public.payment_validation_batches (validated_by, validated_at desc);

do $$
begin
  alter table public.payment_validation_batches
    add constraint payment_validation_batches_method_chk
    check (
      payment_method = public.normalize_payment_method(payment_method)
      and payment_method in ('cash', 'instapay', 'card', 'bank_transfer')
    ) not valid;
exception when duplicate_object then null;
end $$;
alter table public.payment_validation_batches validate constraint payment_validation_batches_method_chk;

do $$
begin
  alter table public.payment_validation_batches
    add constraint payment_validation_batches_mode_chk
    check (validation_mode in ('cash_period', 'daily')) not valid;
exception when duplicate_object then null;
end $$;
alter table public.payment_validation_batches validate constraint payment_validation_batches_mode_chk;

do $$
begin
  alter table public.payment_validation_batches
    add constraint payment_validation_batches_business_date_chk
    check (validation_mode <> 'daily' or business_date is not null) not valid;
exception when duplicate_object then null;
end $$;
alter table public.payment_validation_batches validate constraint payment_validation_batches_business_date_chk;

do $$
begin
  alter table public.payment_validation_batches
    add constraint payment_validation_batches_period_chk
    check (period_to > period_from) not valid;
exception when duplicate_object then null;
end $$;
alter table public.payment_validation_batches validate constraint payment_validation_batches_period_chk;

do $$
begin
  alter table public.payment_validation_batches
    add constraint payment_validation_batches_expected_amount_chk
    check (expected_amount >= 0) not valid;
exception when duplicate_object then null;
end $$;
alter table public.payment_validation_batches validate constraint payment_validation_batches_expected_amount_chk;

do $$
begin
  alter table public.payment_validation_batches
    add constraint payment_validation_batches_counted_amount_chk
    check (counted_amount >= 0) not valid;
exception when duplicate_object then null;
end $$;
alter table public.payment_validation_batches validate constraint payment_validation_batches_counted_amount_chk;

do $$
begin
  alter table public.payment_validation_batches
    add constraint payment_validation_batches_difference_chk
    check (difference_amount = (counted_amount - expected_amount)) not valid;
exception when duplicate_object then null;
end $$;
alter table public.payment_validation_batches validate constraint payment_validation_batches_difference_chk;

do $$
begin
  alter table public.payment_validation_batches
    add constraint payment_validation_batches_delete_audit_chk
    check (deleted_at is null or deleted_by is not null) not valid;
exception when duplicate_object then null;
end $$;
alter table public.payment_validation_batches validate constraint payment_validation_batches_delete_audit_chk;

create table if not exists public.payment_validation_batch_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.payment_validation_batches(id) on delete cascade,
  source_kind text not null,
  source_id uuid not null,
  amount_snapshot numeric(12,2) not null,
  business_date_snapshot date not null,
  event_at_snapshot timestamptz not null,
  released_at timestamptz null,
  released_by uuid null references public.profiles(user_id) on delete set null,
  created_at timestamptz not null default now(),
  created_by uuid null references public.profiles(user_id) on delete set null
);

create index if not exists payment_validation_batch_items_batch_idx
  on public.payment_validation_batch_items (batch_id, created_at desc);

create index if not exists payment_validation_batch_items_source_idx
  on public.payment_validation_batch_items (source_kind, source_id);

create unique index if not exists payment_validation_batch_items_open_event_uidx
  on public.payment_validation_batch_items (source_kind, source_id)
  where released_at is null;

do $$
begin
  alter table public.payment_validation_batch_items
    add constraint payment_validation_batch_items_source_kind_chk
    check (source_kind in ('subscription_payment', 'external_income')) not valid;
exception when duplicate_object then null;
end $$;
alter table public.payment_validation_batch_items validate constraint payment_validation_batch_items_source_kind_chk;

do $$
begin
  alter table public.payment_validation_batch_items
    add constraint payment_validation_batch_items_amount_chk
    check (amount_snapshot > 0) not valid;
exception when duplicate_object then null;
end $$;
alter table public.payment_validation_batch_items validate constraint payment_validation_batch_items_amount_chk;

do $$
begin
  alter table public.payment_validation_batch_items
    add constraint payment_validation_batch_items_release_audit_chk
    check (released_at is null or released_by is not null) not valid;
exception when duplicate_object then null;
end $$;
alter table public.payment_validation_batch_items validate constraint payment_validation_batch_items_release_audit_chk;

alter table public.payment_validation_approvers enable row level security;
alter table public.payment_validation_batches enable row level security;
alter table public.payment_validation_batch_items enable row level security;

do $$
begin
  create policy "admin read payment_validation_approvers"
    on public.payment_validation_approvers for select
    using (public.is_admin_or_super_admin(auth.uid()));
exception when duplicate_object then null;
end $$;

do $$
begin
  create policy "super admin write payment_validation_approvers"
    on public.payment_validation_approvers for all
    using (public.is_super_admin(auth.uid()))
    with check (public.is_super_admin(auth.uid()));
exception when duplicate_object then null;
end $$;

do $$
begin
  create policy "admin read payment_validation_batches"
    on public.payment_validation_batches for select
    using (public.is_admin_or_super_admin(auth.uid()));
exception when duplicate_object then null;
end $$;

do $$
begin
  create policy "approver write payment_validation_batches"
    on public.payment_validation_batches for all
    using (public.is_payment_validation_approver(auth.uid()))
    with check (public.is_payment_validation_approver(auth.uid()));
exception when duplicate_object then null;
end $$;

do $$
begin
  create policy "admin read payment_validation_batch_items"
    on public.payment_validation_batch_items for select
    using (public.is_admin_or_super_admin(auth.uid()));
exception when duplicate_object then null;
end $$;

do $$
begin
  create policy "approver write payment_validation_batch_items"
    on public.payment_validation_batch_items for all
    using (public.is_payment_validation_approver(auth.uid()))
    with check (public.is_payment_validation_approver(auth.uid()));
exception when duplicate_object then null;
end $$;

grant select, insert, update, delete on table public.payment_validation_approvers to authenticated, service_role;
grant select, insert, update, delete on table public.payment_validation_batches to authenticated, service_role;
grant select, insert, update, delete on table public.payment_validation_batch_items to authenticated, service_role;

create or replace view public.admin_income_events_v1 as
  select
    'subscription_payment'::text as source_kind,
    sp.id as source_id,
    sp.subscription_id,
    sp.member_id,
    null::text as source_key,
    coalesce(nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''), p.email, p.member_id, 'Subscription payment') as title,
    sp.note,
    sp.amount::numeric(12,2) as amount,
    public.normalize_payment_method(sp.payment_method) as payment_method_norm,
    sp.payment_method as payment_method_raw,
    coalesce(sp.paid_at, sp.created_at) as event_at,
    ((coalesce(sp.paid_at, sp.created_at) at time zone 'Africa/Cairo')::date) as business_date,
    sp.created_by,
    sp.created_at
  from public.subscription_payments sp
  left join public.profiles p
    on p.user_id = sp.member_id
  where public.normalize_payment_method(sp.payment_method) in ('cash', 'instapay', 'card', 'bank_transfer')

  union all

  select
    'external_income'::text as source_kind,
    ei.id as source_id,
    null::uuid as subscription_id,
    null::uuid as member_id,
    ei.source_key,
    ei.title,
    ei.note,
    ei.amount::numeric(12,2) as amount,
    public.normalize_payment_method(ei.payment_method) as payment_method_norm,
    ei.payment_method as payment_method_raw,
    coalesce(ei.created_at, ((ei.entry_date::timestamp) at time zone 'Africa/Cairo')) as event_at,
    ei.entry_date as business_date,
    ei.created_by,
    ei.created_at
  from public.external_income_entries ei
  where ei.payment_method is not null
    and public.normalize_payment_method(ei.payment_method) in ('cash', 'instapay', 'card', 'bank_transfer');

create or replace view public.admin_income_events_open_v1 as
  select e.*
  from public.admin_income_events_v1 e
  where not exists (
    select 1
    from public.payment_validation_batch_items i
    join public.payment_validation_batches b
      on b.id = i.batch_id
    where i.released_at is null
      and b.deleted_at is null
      and i.source_kind = e.source_kind
      and i.source_id = e.source_id
  );

grant select on public.admin_income_events_v1 to service_role;
grant select on public.admin_income_events_open_v1 to service_role;

commit;
