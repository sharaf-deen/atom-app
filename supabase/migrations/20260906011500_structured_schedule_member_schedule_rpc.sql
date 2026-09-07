-- Structured Schedule Lot 2C — Member Schedule UX
-- Exposes only member-safe dated schedule fields through a narrow authenticated RPC.
-- The underlying schedule_training_sessions table keeps its coaching-staff RLS from Lot 2B,
-- so future internal/session-link fields do not become broadly readable by members by accident.

begin;

create or replace function public.get_member_schedule_sessions(
  p_from_date date,
  p_to_date date
)
returns table (
  id uuid,
  session_date date,
  start_time time without time zone,
  end_time time without time zone,
  name_snapshot text,
  audience_snapshot text,
  age_min_snapshot smallint,
  age_max_snapshot smallint,
  level_snapshot text,
  activity_type_snapshot text,
  uniform_snapshot text,
  mat_snapshot text,
  status text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;

  if p_from_date is null or p_to_date is null or p_to_date < p_from_date then
    raise exception 'INVALID_DATE_RANGE' using errcode = '22023';
  end if;

  if (p_to_date - p_from_date) > 31 then
    raise exception 'DATE_RANGE_TOO_LARGE' using errcode = '22023';
  end if;

  return query
  select
    s.id,
    s.session_date,
    s.start_time,
    s.end_time,
    s.name_snapshot,
    s.audience_snapshot,
    s.age_min_snapshot,
    s.age_max_snapshot,
    s.level_snapshot,
    s.activity_type_snapshot,
    s.uniform_snapshot,
    s.mat_snapshot,
    s.status
  from public.schedule_training_sessions s
  where s.session_date >= p_from_date
    and s.session_date <= p_to_date
    and s.status in ('scheduled', 'completed', 'cancelled')
  order by s.session_date asc, s.start_time asc, s.name_snapshot asc;
end;
$$;

revoke all on function public.get_member_schedule_sessions(date, date) from public;
revoke all on function public.get_member_schedule_sessions(date, date) from anon;
grant execute on function public.get_member_schedule_sessions(date, date) to authenticated;

commit;
