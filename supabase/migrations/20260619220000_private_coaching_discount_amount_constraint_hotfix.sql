-- Private Coaching: allow discounted final amounts on requests.
-- The legacy package amount constraint required amount_cents to equal the package base price.
-- With promo codes, amount_cents is now the final amount to pay and original_amount_cents stores the base package price.

alter table if exists public.private_coaching_requests
  add column if not exists original_amount_cents integer,
  add column if not exists discount_code text,
  add column if not exists discount_label text,
  add column if not exists discount_percent integer not null default 0,
  add column if not exists discount_amount_cents integer not null default 0;

update public.private_coaching_requests
set original_amount_cents = coalesce(original_amount_cents, amount_cents)
where original_amount_cents is null;

do $$
begin
  if to_regclass('public.private_coaching_requests') is not null
     and exists (
       select 1
       from pg_constraint
       where conrelid = 'public.private_coaching_requests'::regclass
         and conname = 'private_coaching_requests_package_amount_check'
     ) then
    alter table public.private_coaching_requests
      drop constraint private_coaching_requests_package_amount_check;
  end if;
end $$;

do $$
begin
  if to_regclass('public.private_coaching_requests') is not null
     and not exists (
       select 1
       from pg_constraint
       where conrelid = 'public.private_coaching_requests'::regclass
         and conname = 'private_coaching_requests_package_amount_discount_check'
     ) then
    alter table public.private_coaching_requests
      add constraint private_coaching_requests_package_amount_discount_check
      check (
        amount_cents >= 0
        and coalesce(original_amount_cents, amount_cents) >= amount_cents
        and (
          (package_sessions = 1 and coalesce(original_amount_cents, amount_cents) = 150000)
          or (package_sessions = 5 and coalesce(original_amount_cents, amount_cents) = 650000)
          or (package_sessions = 10 and coalesce(original_amount_cents, amount_cents) = 1100000)
        )
      ) not valid;
  end if;
end $$;

-- Do not validate the new constraint here so older historical rows cannot block the hotfix deployment.
-- PostgreSQL still enforces this CHECK for new and updated rows after it is added.
