-- Adds a server-side RPC to search invoices by:
-- - invoice_number (ILIKE)
-- - member_id UUID match (when q is UUID)
-- - member profile fields: first_name, last_name, email, member_id (ILIKE)
-- Includes pagination + total_count in one call.
-- Server-side only: grant execute to service_role.

create extension if not exists pg_trgm;

create or replace function public.search_invoices(
  q text,
  from_date date default null,
  to_date date default null,
  page integer default 1,
  page_size integer default 50
)
returns table (
  id uuid,
  invoice_number text,
  member_user_id uuid,
  amount numeric,
  currency text,
  paid_at timestamptz,
  first_name text,
  last_name text,
  email text,
  member_code text,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  q_txt text := coalesce(btrim(q), '');
  q_lower text := lower(coalesce(btrim(q), ''));
  q_is_uuid boolean := false;

  page_n int := greatest(coalesce(page, 1), 1);
  page_size_n int := greatest(1, least(coalesce(page_size, 50), 200));
  _offset int := (page_n - 1) * page_size_n;
begin
  q_is_uuid := (q_txt ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$');

  return query
  with base as (
    select
      i.id,
      i.invoice_number,
      i.member_id as member_user_id,
      i.amount,
      i.currency,
      i.paid_at,
      p.first_name,
      p.last_name,
      p.email,
      p.member_id as member_code
    from public.invoices i
    left join public.profiles p
      on p.user_id = i.member_id
    where
      -- Date range (paid_at). If filters are set, unpaid invoices (paid_at null) won't match, which is intended.
      (from_date is null or i.paid_at >= (from_date::timestamp at time zone 'UTC'))
      and (to_date is null or i.paid_at < ((to_date + 1)::timestamp at time zone 'UTC'))
      and (
        q_txt = ''
        or (i.invoice_number ilike ('%' || q_txt || '%'))
        or (q_is_uuid and i.member_id = q_txt::uuid)
        or (p.first_name ilike ('%' || q_txt || '%'))
        or (p.last_name ilike ('%' || q_txt || '%'))
        or (p.email ilike ('%' || q_txt || '%'))
        or (p.member_id ilike ('%' || q_txt || '%'))
      )
  ),
  counted as (
    select b.*, count(*) over() as total_count
    from base b
  )
  select
    c.id,
    c.invoice_number,
    c.member_user_id,
    c.amount,
    c.currency,
    c.paid_at,
    c.first_name,
    c.last_name,
    c.email,
    c.member_code,
    c.total_count
  from counted c
  order by c.paid_at desc nulls last, c.invoice_number nulls last
  offset _offset
  limit page_size_n;
end;
$$;

revoke all on function public.search_invoices(text, date, date, integer, integer) from public;
grant execute on function public.search_invoices(text, date, date, integer, integer) to service_role;

notify pgrst, 'reload schema';
