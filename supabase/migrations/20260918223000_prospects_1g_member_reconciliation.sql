-- ATOM Prospects 1G — Prospect-to-Member Reconciliation
-- Read-only comparison of prospects with eligible member profiles and memberships.
-- No profile, subscription, payment or prospect link is mutated by this function.

begin;

create or replace function public.prospect_member_reconciliation()
returns table (
  prospect_id uuid,
  reconciliation_state text,
  match_basis text,
  candidate_count integer,
  member_user_id uuid,
  member_code text,
  member_full_name text,
  member_email text,
  member_phone text,
  member_created_at timestamptz,
  first_membership_start_date date,
  first_membership_created_at timestamptz,
  first_paid_membership_start_date date,
  subscription_count integer,
  has_membership_history boolean,
  has_active_membership boolean,
  became_member_after_prospect boolean,
  days_to_first_membership integer
)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  with eligible_members as (
    select
      profile.user_id,
      profile.member_id,
      profile.first_name,
      profile.last_name,
      profile.email,
      profile.phone,
      profile.created_at,
      public.prospect_normalize_email(profile.email) as email_normalized,
      public.prospect_normalize_phone(profile.phone) as phone_normalized
    from public.profiles profile
    where profile.role in ('member', 'champion', 'vip', 'assistant_coach', 'coach', 'head_coach')
  ),
  candidate_matches as (
    select
      prospect.id as prospect_id,
      member.user_id,
      bool_or(
        prospect.email_normalized is not null
        and member.email_normalized = prospect.email_normalized
      ) as email_match,
      bool_or(
        prospect.phone_digits is not null
        and member.phone_normalized = prospect.phone_digits
      ) as phone_match
    from public.prospects prospect
    join eligible_members member
      on prospect.linked_member_id is null
      and (
        (
          prospect.email_normalized is not null
          and member.email_normalized = prospect.email_normalized
        )
        or
        (
          prospect.phone_digits is not null
          and member.phone_normalized = prospect.phone_digits
        )
      )
    group by prospect.id, member.user_id
  ),
  candidate_rollup as (
    select
      match.prospect_id,
      count(*)::integer as candidate_count,
      (array_agg(match.user_id order by match.user_id))[1] as sole_candidate_id,
      bool_or(match.email_match) as any_email_match,
      bool_or(match.phone_match) as any_phone_match
    from candidate_matches match
    group by match.prospect_id
  ),
  resolved as (
    select
      prospect.id as prospect_id,
      prospect.first_seen_at,
      prospect.converted_at,
      prospect.linked_member_id,
      coalesce(rollup.candidate_count, 0)::integer as candidate_count,
      case
        when prospect.linked_member_id is not null then prospect.linked_member_id
        when coalesce(rollup.candidate_count, 0) = 1 then rollup.sole_candidate_id
        else null
      end as resolved_member_id,
      case
        when prospect.linked_member_id is not null then 'linked'
        when coalesce(rollup.candidate_count, 0) = 1 then 'unique_match'
        when coalesce(rollup.candidate_count, 0) > 1 then 'ambiguous'
        else 'unmatched'
      end as reconciliation_state,
      case
        when prospect.linked_member_id is not null then 'linked'
        when coalesce(rollup.candidate_count, 0) = 1 and rollup.any_email_match and rollup.any_phone_match then 'email_and_phone'
        when coalesce(rollup.candidate_count, 0) = 1 and rollup.any_email_match then 'email'
        when coalesce(rollup.candidate_count, 0) = 1 and rollup.any_phone_match then 'phone'
        else null
      end as match_basis
    from public.prospects prospect
    left join candidate_rollup rollup on rollup.prospect_id = prospect.id
  )
  select
    resolved.prospect_id,
    resolved.reconciliation_state,
    resolved.match_basis,
    resolved.candidate_count,
    member.user_id as member_user_id,
    member.member_id as member_code,
    nullif(btrim(concat_ws(' ', member.first_name, member.last_name)), '') as member_full_name,
    member.email as member_email,
    member.phone as member_phone,
    member.created_at as member_created_at,
    membership.first_start_date as first_membership_start_date,
    membership.first_created_at as first_membership_created_at,
    membership.first_paid_start_date as first_paid_membership_start_date,
    membership.subscription_count,
    membership.subscription_count > 0 as has_membership_history,
    membership.has_active_membership,
    case
      when member.user_id is null then false
      when resolved.converted_at is not null and resolved.converted_at >= resolved.first_seen_at then true
      when member.created_at is not null and member.created_at >= resolved.first_seen_at then true
      when membership.first_created_at is not null and membership.first_created_at >= resolved.first_seen_at then true
      when membership.first_start_date is not null
        and membership.first_start_date >= (resolved.first_seen_at at time zone 'Africa/Cairo')::date then true
      else false
    end as became_member_after_prospect,
    case
      when membership.first_start_date is null then null
      else membership.first_start_date - (resolved.first_seen_at at time zone 'Africa/Cairo')::date
    end::integer as days_to_first_membership
  from resolved
  left join eligible_members member on member.user_id = resolved.resolved_member_id
  left join lateral (
    select
      count(subscription.id)::integer as subscription_count,
      min(subscription.start_date) as first_start_date,
      min(subscription.created_at) as first_created_at,
      min(subscription.start_date) filter (where coalesce(subscription.amount, 0) > 0) as first_paid_start_date,
      coalesce(bool_or(
        lower(coalesce(subscription.status, '')) = 'active'
        and subscription.start_date <= (now() at time zone 'Africa/Cairo')::date
        and (
          (
            (
              coalesce(subscription.subscription_type, 'time') = 'sessions'
              or coalesce(subscription.plan::text, '') = 'sessions'
            )
            and greatest(coalesce(subscription.sessions_total, 0) - coalesce(subscription.sessions_used, 0), 0) > 0
          )
          or
          (
            coalesce(subscription.subscription_type, 'time') <> 'sessions'
            and coalesce(subscription.plan::text, '') <> 'sessions'
            and subscription.end_date is not null
            and subscription.end_date >= (now() at time zone 'Africa/Cairo')::date
            and not (
              subscription.frozen_until is not null
              and (
                (
                  subscription.frozen_from is not null
                  and (now() at time zone 'Africa/Cairo')::date >= subscription.frozen_from
                  and (now() at time zone 'Africa/Cairo')::date < subscription.frozen_until
                )
                or
                (
                  subscription.frozen_from is null
                  and (now() at time zone 'Africa/Cairo')::date < subscription.frozen_until
                )
              )
            )
          )
        )
      ), false) as has_active_membership
    from public.subscriptions subscription
    where subscription.member_id = member.user_id
  ) membership on true
  order by resolved.first_seen_at desc, resolved.prospect_id;
$$;

comment on function public.prospect_member_reconciliation() is
  'Read-only prospect/member reconciliation. Exact links win; otherwise only exact normalized email/phone candidates are returned. Names are never used for matching.';

revoke all on function public.prospect_member_reconciliation() from public, anon, authenticated;
grant execute on function public.prospect_member_reconciliation() to service_role;

commit;
