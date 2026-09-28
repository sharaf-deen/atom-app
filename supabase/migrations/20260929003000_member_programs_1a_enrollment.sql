-- Member Programs 1A — Enrollment, history and Members filtering
-- Keeps academy program/group assignment separate from athlete progression level.

begin;

create table if not exists public.member_program_enrollments (
  id uuid primary key default gen_random_uuid(),
  member_user_id uuid not null references public.profiles(user_id) on delete cascade,
  program_key text not null,
  program_name_snapshot text not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz null,
  is_current boolean not null default true,
  source text not null default 'manual',
  assigned_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint member_program_enrollments_program_key_check
    check (program_key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint member_program_enrollments_program_name_check
    check (char_length(btrim(program_name_snapshot)) between 2 and 180),
  constraint member_program_enrollments_source_check
    check (char_length(btrim(source)) between 2 and 80),
  constraint member_program_enrollments_period_check
    check (ended_at is null or ended_at >= started_at),
  constraint member_program_enrollments_current_end_check
    check ((is_current and ended_at is null) or (not is_current and ended_at is not null))
);

create unique index if not exists member_program_enrollments_one_current_uq
  on public.member_program_enrollments (member_user_id)
  where is_current = true;

create index if not exists member_program_enrollments_program_current_idx
  on public.member_program_enrollments (program_key, is_current, member_user_id);

create index if not exists member_program_enrollments_member_history_idx
  on public.member_program_enrollments (member_user_id, started_at desc);

alter table public.member_program_enrollments enable row level security;

grant select on public.member_program_enrollments to authenticated;
revoke insert, update, delete on public.member_program_enrollments from authenticated;

drop policy if exists member_program_enrollments_read_authorized on public.member_program_enrollments;
create policy member_program_enrollments_read_authorized
on public.member_program_enrollments
for select to authenticated
using (
  member_user_id = auth.uid()
  or exists (
    select 1
    from public.profiles viewer
    where viewer.user_id = auth.uid()
      and viewer.role::text = any (array['coach','head_coach','reception','admin','super_admin']::text[])
  )
);

create or replace function public.set_member_current_program_v1(
  p_member_user_id uuid,
  p_program_key text,
  p_actor_user_id uuid,
  p_source text default 'manual'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_role text;
  v_target_role text;
  v_program_name text;
  v_existing public.member_program_enrollments%rowtype;
  v_new_id uuid;
  v_now timestamptz := now();
begin
  select p.role::text into v_actor_role
  from public.profiles p
  where p.user_id = p_actor_user_id;

  if v_actor_role is null or v_actor_role <> all (array['reception','admin','super_admin','head_coach']::text[]) then
    raise exception 'MEMBER_PROGRAM_FORBIDDEN';
  end if;

  select p.role::text into v_target_role
  from public.profiles p
  where p.user_id = p_member_user_id;

  if v_target_role is null or v_target_role <> all (array['member','champion','vip']::text[]) then
    raise exception 'MEMBER_PROGRAM_INVALID_TARGET';
  end if;

  select * into v_existing
  from public.member_program_enrollments e
  where e.member_user_id = p_member_user_id
    and e.is_current = true
  for update;

  if p_program_key is null or btrim(p_program_key) = '' then
    if v_existing.id is not null then
      update public.member_program_enrollments
      set is_current = false,
          ended_at = v_now,
          updated_at = v_now
      where id = v_existing.id;
    end if;
    return null;
  end if;

  select t.name into v_program_name
  from public.schedule_class_templates t
  where t.is_active = true
    and t.series_key = btrim(p_program_key)
    and t.activity_type = any (array['jiu_jitsu','competition','wrestling']::text[])
  order by t.sort_order asc, t.day_of_week asc, t.start_time asc
  limit 1;

  if v_program_name is null then
    raise exception 'MEMBER_PROGRAM_INVALID_PROGRAM';
  end if;

  if v_existing.id is not null and v_existing.program_key = btrim(p_program_key) then
    return v_existing.id;
  end if;

  if v_existing.id is not null then
    update public.member_program_enrollments
    set is_current = false,
        ended_at = v_now,
        updated_at = v_now
    where id = v_existing.id;
  end if;

  insert into public.member_program_enrollments (
    member_user_id,
    program_key,
    program_name_snapshot,
    started_at,
    is_current,
    source,
    assigned_by
  ) values (
    p_member_user_id,
    btrim(p_program_key),
    v_program_name,
    v_now,
    true,
    coalesce(nullif(btrim(p_source), ''), 'manual'),
    p_actor_user_id
  )
  returning id into v_new_id;

  return v_new_id;
end;
$$;

revoke all on function public.set_member_current_program_v1(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.set_member_current_program_v1(uuid, text, uuid, text) to service_role;

create or replace function public.search_members_v5(
  p_q text,
  p_status text,
  p_inactive_reason text,
  p_program_key text,
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
      p.search_tsv,
      p.phone_digits,
      params.today
    from public.profiles p
    cross join params
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
      count(*) over()::bigint as total_count
    from filtered c
    order by c.created_at desc nulls last, c.member_id asc nulls last
    offset greatest((greatest(coalesce(p_page, 1), 1) - 1) * greatest(coalesce(p_page_size, 20), 1), 0)
    limit least(greatest(coalesce(p_page_size, 20), 1), 200)
  )
  select * from numbered;
$$;

comment on table public.member_program_enrollments is
  'Historical academy program assignments for members. Program key uses Structured Schedule series_key; athlete progression level remains separate.';

comment on function public.search_members_v5(text, text, text, text, integer, integer) is
  'Members list with activity state plus current academy program filtering.';

revoke all on function public.search_members_v5(text, text, text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.search_members_v5(text, text, text, text, integer, integer) to service_role;

do $$
begin
  perform pg_notify('pgrst', 'reload schema');
exception when others then
  null;
end $$;

commit;
