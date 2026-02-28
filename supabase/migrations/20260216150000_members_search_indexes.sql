-- Improve /members search performance
-- Adds trigram + full-text indexes on the materialized view used by the members listing.
-- Also adds a couple of supporting indexes to speed up MV refresh.

-- 1) Extensions
-- pg_trgm enables fast ILIKE/contains search with GIN indexes.
create extension if not exists pg_trgm with schema extensions;

-- 2) Speed up MV refresh (EXISTS on subscriptions)
-- Most of the MV cost is checking whether a member currently has an active subscription.
create index if not exists subscriptions_active_member_end_idx
  on public.subscriptions (member_id, end_date)
  where status = 'active';

-- Useful when filtering profiles by role during MV refresh.
create index if not exists profiles_role_idx
  on public.profiles (role);

-- 3) Search indexes on the materialized view
-- Trigram indexes help queries like: column ILIKE '%text%'
create index if not exists members_with_activity_mv_member_id_trgm_idx
  on public.members_with_activity_mv
  using gin (member_id gin_trgm_ops);

create index if not exists members_with_activity_mv_email_trgm_idx
  on public.members_with_activity_mv
  using gin (email gin_trgm_ops);

create index if not exists members_with_activity_mv_first_name_trgm_idx
  on public.members_with_activity_mv
  using gin (first_name gin_trgm_ops);

create index if not exists members_with_activity_mv_last_name_trgm_idx
  on public.members_with_activity_mv
  using gin (last_name gin_trgm_ops);

create index if not exists members_with_activity_mv_phone_trgm_idx
  on public.members_with_activity_mv
  using gin (phone gin_trgm_ops);

-- 4) Full-text search (FTS)
-- This is optional but future-proof: it enables fast multi-word search using websearch_to_tsquery.
-- Note: your app can keep using ILIKE today; this index will be used once you switch to FTS.
create index if not exists members_with_activity_mv_search_fts_idx
  on public.members_with_activity_mv
  using gin (
    to_tsvector(
      'simple',
      coalesce(member_id, '') || ' ' ||
      coalesce(email, '') || ' ' ||
      coalesce(first_name, '') || ' ' ||
      coalesce(last_name, '') || ' ' ||
      coalesce(phone, '')
    )
  );

-- 5) Filter + sort helpers (cheap, useful)
create index if not exists members_with_activity_mv_is_active_idx
  on public.members_with_activity_mv (is_active);

create index if not exists members_with_activity_mv_created_at_desc_idx
  on public.members_with_activity_mv (created_at desc);

create index if not exists members_with_activity_mv_active_created_at_desc_idx
  on public.members_with_activity_mv (is_active, created_at desc);
