begin;

insert into public.roles (id, label)
values
  ('champion', 'Champion'),
  ('vip', 'VIP'),
  ('head_coach', 'Head Coach')
on conflict (id) do update
set label = excluded.label;

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role = any (array['member'::text, 'champion'::text, 'vip'::text, 'assistant_coach'::text, 'coach'::text, 'head_coach'::text, 'reception'::text, 'admin'::text, 'super_admin'::text]));

create or replace function public.member_is_active_now(
  p_member_id uuid,
  p_as_of date default current_date
)
returns boolean
language sql
stable
set search_path = public
as $$
  select case
    when exists (
      select 1
      from public.profiles p
      where p.user_id = p_member_id
        and p.role in ('assistant_coach', 'coach', 'head_coach', 'champion', 'vip')
    ) then true
    else exists (
      select 1
      from public.subscriptions s
      where s.member_id = p_member_id
        and lower(coalesce(s.status, '')) = 'active'
        and (
          (
            (
              coalesce(s.subscription_type, 'time') = 'sessions'
              or coalesce(s.plan::text, '') = 'sessions'
            )
            and greatest(coalesce(s.sessions_total, 0) - coalesce(s.sessions_used, 0), 0) > 0
          )
          or
          (
            (
              coalesce(s.subscription_type, 'time') <> 'sessions'
              and coalesce(s.plan::text, '') <> 'sessions'
            )
            and s.end_date is not null
            and s.end_date >= p_as_of
            and not (
              s.frozen_until is not null
              and (
                (
                  s.frozen_from is not null
                  and p_as_of >= s.frozen_from
                  and p_as_of < s.frozen_until
                )
                or (
                  s.frozen_from is null
                  and p_as_of < s.frozen_until
                )
              )
            )
          )
        )
    )
  end;
$$;

drop view if exists public.members_with_activity;
drop materialized view if exists public.members_with_activity_mv;

create materialized view public.members_with_activity_mv as
select
  p.user_id,
  p.email,
  p.first_name,
  p.last_name,
  p.phone,
  p.role,
  p.created_at,
  p.member_id,
  p.date_of_birth,
  public.member_is_active_now(p.user_id) as is_active
from public.profiles p
where p.role in ('member', 'champion', 'vip')
with data;

create unique index if not exists members_with_activity_mv_user_id_ux
  on public.members_with_activity_mv(user_id);
create index if not exists members_with_activity_mv_member_id_idx
  on public.members_with_activity_mv(member_id);
create index if not exists members_with_activity_mv_email_lower_idx
  on public.members_with_activity_mv(lower(email));
create index if not exists members_with_activity_mv_name_lower_idx
  on public.members_with_activity_mv(lower(coalesce(first_name, '') || ' ' || coalesce(last_name, '')));
create index if not exists members_with_activity_mv_is_active_idx
  on public.members_with_activity_mv (is_active);
create index if not exists members_with_activity_mv_is_active_created_at_idx
  on public.members_with_activity_mv (is_active, created_at desc);

create or replace view public.members_with_activity as
select * from public.members_with_activity_mv;

create or replace function public.members_activity_stats()
returns table(total bigint, active bigint, inactive bigint)
language sql
stable
as $$
  select
    count(*) as total,
    count(*) filter (where is_active) as active,
    count(*) filter (where not is_active) as inactive
  from public.members_with_activity_mv;
$$;

create or replace function public.tg_profiles_ensure_staff_subscription()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_staff boolean := false;
  v_was_staff boolean := false;
  v_has_active_staff boolean := false;
  v_today date := (now() at time zone 'utc')::date;
  v_end date := date '2099-12-31';
begin
  v_is_staff := coalesce(new.role, '') in ('coach', 'assistant_coach', 'head_coach');
  v_was_staff := coalesce(old.role, '') in ('coach', 'assistant_coach', 'head_coach');

  if (not v_is_staff) and v_was_staff then
    update public.subscriptions s
      set status = 'expired',
          end_date = least(coalesce(s.end_date, v_today), v_today)
    where s.member_id = new.user_id
      and s.is_staff = true
      and s.status = 'active';
    return new;
  end if;

  if not v_is_staff then
    return new;
  end if;

  select exists (
    select 1
    from public.subscriptions s
    where s.member_id = new.user_id
      and s.is_staff = true
      and s.status = 'active'
      and (s.end_date is null or s.end_date >= v_today)
  ) into v_has_active_staff;

  if not v_has_active_staff then
    insert into public.subscriptions (
      member_id,
      plan,
      subscription_type,
      status,
      amount,
      paid_at,
      start_date,
      end_date,
      sessions_total,
      sessions_used,
      remaining_classes,
      frozen_until,
      is_staff
    )
    values (
      new.user_id,
      '12m',
      'time',
      'active',
      0,
      now(),
      v_today,
      v_end,
      null,
      null,
      null,
      null,
      true
    );
  end if;

  return new;
end;
$$;

select public.refresh_members_with_activity_mv();

commit;
