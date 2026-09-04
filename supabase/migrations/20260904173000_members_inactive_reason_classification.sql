-- Members Inactive — reason classification & filters
-- Read-only classification only. No member, subscription, Auth, Family or payment data is modified.

begin;

create or replace function public.search_members_v4(
  p_q text,
  p_status text,
  p_inactive_reason text,
  p_page integer,
  p_page_size integer
)
returns table(
  user_id uuid,
  email text,
  first_name text,
  last_name text,
  phone text,
  role text,
  created_at timestamptz,
  member_id text,
  date_of_birth date,
  is_active boolean,
  is_frozen boolean,
  inactive_reason text,
  total_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with params as (
    select (now() at time zone 'Africa/Cairo')::date as today
  ),
  base as (
    select
      p.user_id,
      p.email,
      p.first_name,
      p.last_name,
      p.phone,
      p.role::text as role,
      p.created_at,
      p.member_id,
      p.date_of_birth,
      public.member_is_active_now(p.user_id, params.today) as is_active,
      exists (
        select 1
        from public.subscriptions fs
        where fs.member_id = p.user_id
          and lower(coalesce(fs.status, '')) = 'active'
          and coalesce(fs.subscription_type, 'time') = 'time'
          and fs.frozen_until is not null
          and (
            (
              fs.frozen_from is not null
              and params.today >= fs.frozen_from
              and params.today < fs.frozen_until
            )
            or (
              fs.frozen_from is null
              and params.today < fs.frozen_until
            )
          )
      ) as is_frozen,
      ls.id as latest_subscription_id,
      ls.plan as latest_plan,
      ls.subscription_type as latest_subscription_type,
      ls.status as latest_status,
      ls.end_date as latest_end_date,
      ls.sessions_total as latest_sessions_total,
      ls.sessions_used as latest_sessions_used,
      p.search_tsv,
      p.phone_digits,
      params.today
    from public.profiles p
    cross join params
    left join lateral (
      select
        s.id,
        s.plan,
        s.subscription_type,
        s.status,
        s.end_date,
        s.sessions_total,
        s.sessions_used
      from public.subscriptions s
      where s.member_id = p.user_id
      order by
        coalesce(s.end_date, s.start_date, s.created_at::date) desc nulls last,
        s.created_at desc nulls last
      limit 1
    ) ls on true
    where p.role in ('member', 'champion', 'vip')
  ),
  classified as (
    select
      b.*,
      case
        when b.is_active or b.is_frozen then null
        when b.latest_subscription_id is null then 'no_membership'
        when lower(coalesce(b.latest_status, '')) = 'cancelled' then 'cancelled'
        when (
          (
            coalesce(b.latest_subscription_type, 'time') = 'sessions'
            or coalesce(b.latest_plan::text, '') = 'sessions'
          )
          and coalesce(b.latest_sessions_total, 0) > 0
          and coalesce(b.latest_sessions_used, 0) >= coalesce(b.latest_sessions_total, 0)
        ) then 'depleted_legacy'
        when (
          lower(coalesce(b.latest_status, '')) = 'expired'
          or (b.latest_end_date is not null and b.latest_end_date < b.today)
        ) then 'expired'
        else 'other_inactive'
      end as inactive_reason_value
    from base b
  ),
  filtered as (
    select *
    from classified c
    where
      (
        p_q is not null
        and btrim(p_q) <> ''
        and (
          c.search_tsv @@ plainto_tsquery('simple', p_q)
          or lower(coalesce(c.email, '')) like '%' || lower(p_q) || '%'
          or lower(coalesce(c.first_name, '')) like '%' || lower(p_q) || '%'
          or lower(coalesce(c.last_name, '')) like '%' || lower(p_q) || '%'
          or lower(coalesce(c.member_id, '')) like '%' || lower(p_q) || '%'
          or (
            regexp_replace(coalesce(p_q, ''), '\D', '', 'g') <> ''
            and c.phone_digits like '%' || regexp_replace(p_q, '\D', '', 'g') || '%'
          )
        )
      )
      or (
        (p_q is null or btrim(p_q) = '')
        and (
          coalesce(lower(p_status), 'all') = 'all'
          or (lower(p_status) = 'active' and c.is_active)
          or (lower(p_status) = 'frozen' and c.is_frozen and not c.is_active)
          or (lower(p_status) = 'inactive' and not c.is_active and not c.is_frozen)
        )
        and (
          lower(coalesce(p_status, 'all')) <> 'inactive'
          or coalesce(lower(p_inactive_reason), 'all') = 'all'
          or c.inactive_reason_value = lower(p_inactive_reason)
        )
      )
  ),
  numbered as (
    select
      c.user_id,
      c.email,
      c.first_name,
      c.last_name,
      c.phone,
      c.role,
      c.created_at,
      c.member_id,
      c.date_of_birth,
      c.is_active,
      (c.is_frozen and not c.is_active) as is_frozen,
      c.inactive_reason_value as inactive_reason,
      count(*) over()::bigint as total_count
    from filtered c
    order by c.created_at desc nulls last, c.member_id asc nulls last
    offset greatest((greatest(coalesce(p_page, 1), 1) - 1) * greatest(coalesce(p_page_size, 20), 1), 0)
    limit least(greatest(coalesce(p_page_size, 20), 1), 200)
  )
  select * from numbered;
$$;

comment on function public.search_members_v4(text, text, text, integer, integer) is
  'Members list with Active/Frozen/Inactive separation and read-only inactive reason classification. Search remains global.';

revoke all on function public.search_members_v4(text, text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.search_members_v4(text, text, text, integer, integer) to service_role;

create or replace function public.members_activity_stats_v4()
returns table(
  total bigint,
  active bigint,
  frozen bigint,
  inactive bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with params as (
    select (now() at time zone 'Africa/Cairo')::date as today
  ),
  states as (
    select
      p.user_id,
      public.member_is_active_now(p.user_id, params.today) as is_active,
      exists (
        select 1
        from public.subscriptions fs
        where fs.member_id = p.user_id
          and lower(coalesce(fs.status, '')) = 'active'
          and coalesce(fs.subscription_type, 'time') = 'time'
          and fs.frozen_until is not null
          and (
            (
              fs.frozen_from is not null
              and params.today >= fs.frozen_from
              and params.today < fs.frozen_until
            )
            or (
              fs.frozen_from is null
              and params.today < fs.frozen_until
            )
          )
      ) as is_frozen
    from public.profiles p
    cross join params
    where p.role in ('member', 'champion', 'vip')
  )
  select
    count(*)::bigint as total,
    count(*) filter (where is_active)::bigint as active,
    count(*) filter (where is_frozen and not is_active)::bigint as frozen,
    count(*) filter (where not is_active and not is_frozen)::bigint as inactive
  from states;
$$;

comment on function public.members_activity_stats_v4() is
  'Members counters with Frozen separated from Inactive. Email/Auth presence does not determine activity.';

revoke all on function public.members_activity_stats_v4() from public, anon, authenticated;
grant execute on function public.members_activity_stats_v4() to service_role;

do $$
begin
  perform pg_notify('pgrst', 'reload schema');
exception when others then
  null;
end $$;

commit;
