-- 1) Normalize existing data (safe even if already clean)
update public.profiles
set email = null
where email is not null and btrim(email) = '';

update public.profiles
set email = lower(btrim(email))
where email is not null and email <> lower(btrim(email));

-- 2) Add BETON unique index: lower(trim(email))
create unique index if not exists profiles_email_unique_beton
on public.profiles (lower(btrim(email)))
where email is not null and btrim(email) <> '';

-- 3) Drop redundant old indexes (you have duplicates)
drop index if exists public.profiles_email_unique_ci;
drop index if exists public.profiles_email_unique_lower;

-- 4) Optional but recommended: remove the old case-sensitive unique constraint
-- (the BETON index is the real rule now)
alter table public.profiles
drop constraint if exists profiles_email_key;
