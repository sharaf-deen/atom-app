-- Private Coaching Lot 6B: dynamic private promo codes
-- Codes are managed by head_coach/super_admin and are not exposed to members.
-- Existing requests keep their saved discount snapshots.

create table if not exists public.private_coaching_promo_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  title text not null default '',
  discount_percent integer not null,
  is_active boolean not null default true,
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint private_coaching_promo_codes_code_format
    check (code = upper(code) and code ~ '^[A-Z0-9_-]{2,32}$'),
  constraint private_coaching_promo_codes_discount_percent_range
    check (discount_percent >= 1 and discount_percent <= 100)
);

create unique index if not exists private_coaching_promo_codes_code_unique_active_idx
  on public.private_coaching_promo_codes (lower(code))
  where deleted_at is null;

alter table if exists public.private_coaching_requests
  add column if not exists discount_label text;

update public.private_coaching_requests
set discount_label = coalesce(discount_label, discount_code)
where discount_code is not null
  and discount_label is null;

insert into public.private_coaching_promo_codes (code, title, discount_percent, is_active)
select 'PC10', 'Private coaching 10% discount', 10, true
where not exists (
  select 1
  from public.private_coaching_promo_codes
  where lower(code) = lower('PC10')
    and deleted_at is null
);
