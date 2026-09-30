-- Member Consent 1D — Legal Consent Visibility & Operations Dashboard
-- Adds member-list legal status filtering and aggregate legal-consent counters.
-- Read/visibility only: does not mutate legal acceptance history or change 1C enforcement.

begin;

create or replace function public.search_members_v6(
  p_q text,
  p_status text,
  p_inactive_reason text,
  p_program_key text,
  p_legal_status text,
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
  program_key text,
  program_name text,
  legal_complete boolean,
  legal_required_count integer,
  legal_accepted_count integer,
  legal_missing_count integer,
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
  required_docs as (
    select
      array_agg(ldv.id order by ldv.document_key, ldv.version_label) as ids,
      count(*)::integer as required_count
    from public.legal_document_versions ldv
    where ldv.status = 'active'
      and ldv.is_required = true
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
            (fs.frozen_from is not null and params.today >= fs.frozen_from and params.today < fs.frozen_until)
            or (fs.frozen_from is null and params.today < fs.frozen_until)
          )
      ) as is_frozen,
      ls.id as latest_subscription_id,
      ls.plan as latest_plan,
      ls.subscription_type as latest_subscription_type,
      ls.status as latest_status,
      ls.end_date as latest_end_date,
      ls.sessions_total as latest_sessions_total,
      ls.sessions_used as latest_sessions_used,
      mpe.program_key,
      mpe.program_name_snapshot as program_name,
      rd.required_count as legal_required_count,
      coalesce(la.accepted_count, 0)::integer as legal_accepted_count,
      greatest(rd.required_count - coalesce(la.accepted_count, 0), 0)::integer as legal_missing_count,
      (rd.required_count = coalesce(la.accepted_count, 0)) as legal_complete,
      p.search_tsv,
      p.phone_digits,
      params.today
    from public.profiles p
    cross join params
    cross join required_docs rd
    left join lateral (
      select s.id, s.plan, s.subscription_type, s.status, s.end_date, s.sessions_total, s.sessions_used
      from public.subscriptions s
      where s.member_id = p.user_id
      order by coalesce(s.end_date, s.start_date, s.created_at::date) desc nulls last,
               s.created_at desc nulls last
      limit 1
    ) ls on true
    left join public.member_program_enrollments mpe
      on mpe.member_user_id = p.user_id
     and mpe.is_current = true
    left join lateral (
      select count(distinct mla.document_version_id)::integer as accepted_count
      from public.member_legal_acceptances mla
      where mla.member_user_id = p.user_id
        and (
          rd.required_count = 0
          or mla.document_version_id = any(coalesce(rd.ids, array[]::uuid[]))
        )
    ) la on true
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
          (coalesce(b.latest_subscription_type, 'time') = 'sessions' or coalesce(b.latest_plan::text, '') = 'sessions')
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
        p_q is null
        or btrim(p_q) = ''
        or c.search_tsv @@ plainto_tsquery('simple', p_q)
        or lower(coalesce(c.email, '')) like '%' || lower(p_q) || '%'
        or lower(coalesce(c.first_name, '')) like '%' || lower(p_q) || '%'
        or lower(coalesce(c.last_name, '')) like '%' || lower(p_q) || '%'
        or lower(coalesce(c.member_id, '')) like '%' || lower(p_q) || '%'
        or (
          regexp_replace(coalesce(p_q, ''), '\D', '', 'g') <> ''
          and c.phone_digits like '%' || regexp_replace(p_q, '\D', '', 'g') || '%'
        )
      )
      and (
        p_q is not null and btrim(p_q) <> ''
        or coalesce(lower(p_status), 'all') = 'all'
        or (lower(p_status) = 'active' and c.is_active)
        or (lower(p_status) = 'frozen' and c.is_frozen and not c.is_active)
        or (lower(p_status) = 'inactive' and not c.is_active and not c.is_frozen)
      )
      and (
        p_q is not null and btrim(p_q) <> ''
        or lower(coalesce(p_status, 'all')) <> 'inactive'
        or coalesce(lower(p_inactive_reason), 'all') = 'all'
        or c.inactive_reason_value = lower(p_inactive_reason)
      )
      and (
        p_program_key is null
        or btrim(p_program_key) = ''
        or lower(p_program_key) = 'all'
        or (p_program_key = '__unassigned__' and c.program_key is null)
        or c.program_key = btrim(p_program_key)
      )
      and (
        p_legal_status is null
        or btrim(p_legal_status) = ''
        or lower(p_legal_status) = 'all'
        or (lower(p_legal_status) = 'complete' and c.legal_complete)
        or (lower(p_legal_status) = 'action_required' and not c.legal_complete)
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
      c.program_key,
      c.program_name,
      c.legal_complete,
      c.legal_required_count,
      c.legal_accepted_count,
      c.legal_missing_count,
      count(*) over()::bigint as total_count
    from filtered c
    order by
      case when not c.legal_complete then 0 else 1 end,
      c.created_at desc nulls last,
      c.member_id asc nulls last
    offset greatest((greatest(coalesce(p_page, 1), 1) - 1) * greatest(coalesce(p_page_size, 20), 1), 0)
    limit least(greatest(coalesce(p_page_size, 20), 1), 200)
  )
  select * from numbered;
$$;

revoke all on function public.search_members_v6(text, text, text, text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.search_members_v6(text, text, text, text, text, integer, integer)
  to service_role;

comment on function public.search_members_v6(text, text, text, text, text, integer, integer) is
  'Members list with activity, academy-program and current required legal-consent status filtering.';

create or replace function public.member_legal_consent_stats_v1()
returns table(
  total_members bigint,
  complete bigint,
  action_required bigint,
  required_documents integer
)
language sql
stable
security definer
set search_path = public
as $$
  with required_docs as (
    select
      array_agg(ldv.id order by ldv.document_key, ldv.version_label) as ids,
      count(*)::integer as required_count
    from public.legal_document_versions ldv
    where ldv.status = 'active'
      and ldv.is_required = true
  ),
  members as (
    select p.user_id
    from public.profiles p
    where p.role in ('member', 'champion', 'vip')
  ),
  compliance as (
    select
      m.user_id,
      rd.required_count,
      (
        rd.required_count = coalesce((
          select count(distinct mla.document_version_id)::integer
          from public.member_legal_acceptances mla
          where mla.member_user_id = m.user_id
            and (
              rd.required_count = 0
              or mla.document_version_id = any(coalesce(rd.ids, array[]::uuid[]))
            )
        ), 0)
      ) as legal_complete
    from members m
    cross join required_docs rd
  )
  select
    count(*)::bigint as total_members,
    count(*) filter (where legal_complete)::bigint as complete,
    count(*) filter (where not legal_complete)::bigint as action_required,
    coalesce(max(required_count), 0)::integer as required_documents
  from compliance;
$$;

revoke all on function public.member_legal_consent_stats_v1()
  from public, anon, authenticated;
grant execute on function public.member_legal_consent_stats_v1()
  to service_role;

do $$
begin
  perform pg_notify('pgrst', 'reload schema');
exception when others then
  null;
end $$;

commit;
