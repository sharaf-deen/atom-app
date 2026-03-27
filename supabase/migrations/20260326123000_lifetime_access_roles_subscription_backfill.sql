begin;

create or replace function public.tg_profiles_ensure_staff_subscription()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_has_lifetime_access boolean := false;
  v_had_lifetime_access boolean := false;
  v_has_active_lifetime boolean := false;
  v_today date := (now() at time zone 'utc')::date;
  v_end date := date '2099-12-31';
begin
  v_has_lifetime_access := coalesce(new.role, '') in ('coach', 'assistant_coach', 'head_coach', 'champion', 'vip');
  v_had_lifetime_access := coalesce(old.role, '') in ('coach', 'assistant_coach', 'head_coach', 'champion', 'vip');

  if (not v_has_lifetime_access) and v_had_lifetime_access then
    update public.subscriptions s
      set status = 'expired',
          end_date = least(coalesce(s.end_date, v_today), v_today)
    where s.member_id = new.user_id
      and s.is_staff = true
      and s.status = 'active';
    return new;
  end if;

  if not v_has_lifetime_access then
    return new;
  end if;

  select exists (
    select 1
    from public.subscriptions s
    where s.member_id = new.user_id
      and s.is_staff = true
      and s.status = 'active'
      and (s.end_date is null or s.end_date >= v_today)
  ) into v_has_active_lifetime;

  if not v_has_active_lifetime then
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
select
  p.user_id,
  '12m',
  'time',
  'active',
  0,
  now(),
  (now() at time zone 'utc')::date,
  date '2099-12-31',
  null,
  null,
  null,
  null,
  true
from public.profiles p
where coalesce(p.role, '') in ('coach', 'assistant_coach', 'head_coach', 'champion', 'vip')
  and not exists (
    select 1
    from public.subscriptions s
    where s.member_id = p.user_id
      and s.is_staff = true
      and s.status = 'active'
      and (s.end_date is null or s.end_date >= (now() at time zone 'utc')::date)
  );

commit;
