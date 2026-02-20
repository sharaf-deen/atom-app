-- 20260220193000_staff_subscription_trigger.sql
-- Ensure coaches/assistant_coaches always have an active subscription (staff).
-- Security: staff subscriptions are marked is_staff=true so they can be revoked on role downgrade.

begin;

-- 1) Mark staff subscriptions explicitly
alter table public.subscriptions
  add column if not exists is_staff boolean not null default false;

create index if not exists subscriptions_is_staff_idx
  on public.subscriptions (is_staff);

create index if not exists subscriptions_member_staff_active_idx
  on public.subscriptions (member_id, is_staff, status);

-- 2) Trigger function on profiles role change
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
  v_is_staff := coalesce(new.role, '') in ('coach', 'assistant_coach');
  v_was_staff := coalesce(old.role, '') in ('coach', 'assistant_coach');

  -- If role downgraded: revoke staff subscription access
  if (not v_is_staff) and v_was_staff then
    update public.subscriptions s
      set status = 'inactive',
          end_date = least(coalesce(s.end_date, v_today), v_today)
    where s.member_id = new.user_id
      and s.is_staff = true
      and s.status = 'active';
    return new;
  end if;

  -- If not staff, nothing to do
  if not v_is_staff then
    return new;
  end if;

  -- Ensure at least one active staff subscription exists and is not expired
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

drop trigger if exists trg_profiles_ensure_staff_subscription on public.profiles;

create trigger trg_profiles_ensure_staff_subscription
after insert or update of role on public.profiles
for each row
execute function public.tg_profiles_ensure_staff_subscription();

-- 3) Backfill existing staff profiles (idempotent)
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
where coalesce(p.role,'') in ('coach', 'assistant_coach')
  and not exists (
    select 1
    from public.subscriptions s
    where s.member_id = p.user_id
      and s.is_staff = true
      and s.status = 'active'
      and (s.end_date is null or s.end_date >= (now() at time zone 'utc')::date)
  );

commit;
