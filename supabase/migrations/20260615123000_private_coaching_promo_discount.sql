-- Private Coaching Lot 6: promo code discount snapshots
-- amount_cents remains the final amount to pay, so existing payment confirmation/token logic stays unchanged.

alter table if exists public.private_coaching_requests
  add column if not exists original_amount_cents integer,
  add column if not exists discount_code text,
  add column if not exists discount_percent integer not null default 0,
  add column if not exists discount_amount_cents integer not null default 0;

update public.private_coaching_requests
set original_amount_cents = coalesce(original_amount_cents, amount_cents)
where original_amount_cents is null;

do $$
begin
  if to_regclass('public.private_coaching_requests') is not null
     and not exists (
       select 1 from pg_constraint
       where conrelid = 'public.private_coaching_requests'::regclass
         and conname = 'private_coaching_requests_discount_percent_nonnegative'
     ) then
    alter table public.private_coaching_requests
      add constraint private_coaching_requests_discount_percent_nonnegative
      check (discount_percent >= 0) not valid;
  end if;
end $$;

do $$
begin
  if to_regclass('public.private_coaching_requests') is not null
     and not exists (
       select 1 from pg_constraint
       where conrelid = 'public.private_coaching_requests'::regclass
         and conname = 'private_coaching_requests_discount_amount_nonnegative'
     ) then
    alter table public.private_coaching_requests
      add constraint private_coaching_requests_discount_amount_nonnegative
      check (discount_amount_cents >= 0) not valid;
  end if;
end $$;

do $$
begin
  if to_regclass('public.private_coaching_requests') is not null
     and not exists (
       select 1 from pg_constraint
       where conrelid = 'public.private_coaching_requests'::regclass
         and conname = 'private_coaching_requests_original_amount_nonnegative'
     ) then
    alter table public.private_coaching_requests
      add constraint private_coaching_requests_original_amount_nonnegative
      check (original_amount_cents is null or original_amount_cents >= 0) not valid;
  end if;
end $$;

alter table if exists public.private_coaching_requests
  validate constraint private_coaching_requests_discount_percent_nonnegative;

alter table if exists public.private_coaching_requests
  validate constraint private_coaching_requests_discount_amount_nonnegative;

alter table if exists public.private_coaching_requests
  validate constraint private_coaching_requests_original_amount_nonnegative;
