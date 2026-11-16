-- Program Health 2A: Super Admin-only read-only retention and enrollment trend signals.
-- Keeps original cash attribution unchanged. Gym-wide attendance is NOT a class attendance signal.
begin;
create or replace function public.atom_program_health_signals(p_actor uuid)
returns jsonb
language plpgsql security definer set search_path=public,pg_catalog
as $$
declare v_payload jsonb;
begin
 if not exists (
   select 1 from public.profiles
   where user_id=p_actor and role='super_admin' and archived_at is null
 ) then raise exception 'SUPER_ADMIN_REQUIRED'; end if;
 with
 today as (select (now() at time zone 'Africa/Cairo')::date as d),
 valid_profiles as (
   select user_id from public.profiles
   where archived_at is null and role in ('member','champion','vip')
 ),
 current_assignment as (
   select distinct e.program_key,e.member_user_id
   from public.member_program_enrollments e
   join valid_profiles p on p.user_id=e.member_user_id
   where e.is_current=true and e.ended_at is null
 ),
 assignment_events as (
   select e.program_key,
     count(distinct e.member_user_id) filter(
       where e.started_at>=now()-interval '30 days' and e.started_at<=now()
     )::int as joined_30,
     count(distinct e.member_user_id) filter(
       where e.started_at>=now()-interval '60 days' and e.started_at<now()-interval '30 days'
     )::int as joined_previous_30,
     count(distinct e.member_user_id) filter(
       where e.ended_at>=now()-interval '30 days' and e.ended_at<=now()
     )::int as ended_30,
     count(distinct e.member_user_id) filter(
       where e.ended_at>=now()-interval '60 days' and e.ended_at<now()-interval '30 days'
     )::int as ended_previous_30
   from public.member_program_enrollments e
   join valid_profiles p on p.user_id=e.member_user_id
   group by e.program_key
 ),
 active_end as (
   select s.member_id,max(s.end_date) as latest_end_date
   from public.subscriptions s cross join today t
   where s.status='active' and s.start_date<=t.d and s.end_date>=t.d
   and (coalesce(s.subscription_type,'')<>'sessions'
        or coalesce(s.remaining_classes,s.sessions_total-coalesce(s.sessions_used,0),0)>0)
   group by s.member_id
 ),
 expiring as (
   select a.program_key,a.member_user_id,
     (v.latest_end_date-(select d from today))::integer days_left,
     v.latest_end_date
   from current_assignment a
   join active_end v on v.member_id=a.member_user_id
   where v.latest_end_date<=(select d+30 from today)
 ),
 expiry_stats as (
   select program_key,
     count(*) filter(where days_left<=7)::int as expiring_7,
     count(*)::int as expiring_30,
     coalesce(jsonb_agg(
       jsonb_build_object('user_id',member_user_id,'days_left',days_left,'end_date',latest_end_date)
       order by days_left,member_user_id
     ),'[]'::jsonb) as renewal_members
   from expiring
   group by program_key
 )
 select jsonb_build_object(
   'as_of',(select d from today),
   'methodology','30-day enrollment comparisons count distinct member IDs with an enrollment start or end event in the period (not monthly active snapshots). Renewal risk uses latest end date of valid active subscriptions. Gym-wide scans are an imperfect attendance proxy and are excluded from scoring.',
   'programs',coalesce(jsonb_agg(jsonb_build_object(
     'key',c.key,
     'joined_30',coalesce(e.joined_30,0),
     'joined_previous_30',coalesce(e.joined_previous_30,0),
     'ended_30',coalesce(e.ended_30,0),
     'ended_previous_30',coalesce(e.ended_previous_30,0),
     'expiring_7',coalesce(x.expiring_7,0),
     'expiring_30',coalesce(x.expiring_30,0),
     'renewal_members',coalesce(x.renewal_members,'[]'::jsonb)
   ) order by c.sort_order,c.name),'[]'::jsonb)
 ) into v_payload
 from public.member_program_catalog c
 left join assignment_events e on e.program_key=c.key
 left join expiry_stats x on x.program_key=c.key;
 return v_payload;
end;
$$;
revoke all on function public.atom_program_health_signals(uuid) from public,anon,authenticated;
grant execute on function public.atom_program_health_signals(uuid) to service_role;
commit;
