-- Fix staff subscription trigger: downgrading a coach/assistant coach must not use
-- subscriptions.status = 'inactive' because subscriptions_status_check only allows:
-- active, paused, cancelled, expired.

begin;

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

  -- If role downgraded: revoke staff subscription access safely.
  -- 'inactive' is NOT a valid subscriptions.status value.
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

commit;
