-- Functional 1B.4: atomic, serialized freeze lifecycle.
-- Apply the migration before deploying the API route.
create or replace function public.manage_subscription_freeze_atomic(
  p_subscription_id uuid,
  p_action text,
  p_freeze_id uuid,
  p_from date,
  p_to date,
  p_actor uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.subscriptions%rowtype;
  f public.subscription_freezes%rowtype;
  v_today date := (now() at time zone 'Africa/Cairo')::date;
  v_allowed integer;
  v_used integer;
  v_days integer;
  v_old_days integer;
  v_new_end date;
  v_base_end date;
  v_total integer;
  v_to_exclusive date;
  v_surface_from date := null;
  v_surface_until date := null;
  v_created_id uuid;
begin
  if p_action not in ('create','update','delete') then
    raise exception 'Invalid freeze action' using errcode = '22023';
  end if;
  if p_actor is null or not exists (select 1 from public.profiles where user_id = p_actor and role = 'super_admin') then
    raise exception 'Only Super Admin may manage freezes' using errcode = '42501';
  end if;
  -- Lock parent first: concurrent lifecycle requests must serialize.
  select * into s from public.subscriptions where id = p_subscription_id for update;
  if not found then raise exception 'Subscription not found' using errcode = 'P0002'; end if;
  if s.end_date is null then raise exception 'Subscription end date missing' using errcode = '22023'; end if;
  select count(*), coalesce(sum(days),0) into v_used, v_old_days
    from public.subscription_freezes
   where subscription_id = p_subscription_id and cleared_at is null;
  v_base_end := s.end_date::date - v_old_days;
  v_allowed := case when s.subscription_type = 'time' then
    case s.plan when '3m' then 1 when '6m' then 2 when '12m' then 3 else 0 end
    else 0 end;

  if p_action = 'create' then
    if v_allowed = 0 then raise exception 'Plan is not eligible for freezes' using errcode = '22023'; end if;
    if s.status not in ('active','expired') then raise exception 'Subscription status does not allow freezes' using errcode = '22023'; end if;
    if v_used >= v_allowed then raise exception 'No freeze tokens remaining' using errcode = '22023'; end if;
  else
    if p_freeze_id is null then raise exception 'Freeze ID required' using errcode = '22023'; end if;
    select * into f from public.subscription_freezes
      where id = p_freeze_id and subscription_id = p_subscription_id and cleared_at is null for update;
    if not found then raise exception 'Freeze not found' using errcode = 'P0002'; end if;
    if s.subscription_type <> 'time' or s.status not in ('active','expired') then
      raise exception 'Subscription is not manageable for freezes' using errcode = '22023';
    end if;
  end if;

  if p_action in ('create','update') then
    if p_from is null or p_to is null or p_from > p_to then
      raise exception 'Invalid freeze date range' using errcode = '22023';
    end if;
    if s.start_date is null or p_from < s.start_date::date or p_from > s.end_date::date or p_to > s.end_date::date then
      raise exception 'Freeze must be within subscription coverage' using errcode = '22023';
    end if;
    v_days := p_to - p_from + 1;
    if v_days < 1 or v_days > 30 then raise exception 'Freeze must be 1 to 30 days' using errcode = '22023'; end if;
    v_to_exclusive := p_to + 1;
    if exists (
      select 1 from public.subscription_freezes x
      where x.subscription_id = p_subscription_id and x.cleared_at is null
        and (p_action = 'create' or x.id <> p_freeze_id)
        and x.freeze_from < v_to_exclusive and p_from < x.freeze_until
    ) then raise exception 'Freeze ranges overlap' using errcode = '23505'; end if;
  end if;

  if p_action = 'create' then
    insert into public.subscription_freezes (subscription_id, freeze_from, freeze_until, days, created_by, updated_at, updated_by)
    values (p_subscription_id, p_from, v_to_exclusive, v_days, p_actor, now(), p_actor)
    returning id into v_created_id;
  elsif p_action = 'update' then
    update public.subscription_freezes
      set freeze_from = p_from, freeze_until = v_to_exclusive, days = v_days,
          updated_at = now(), updated_by = p_actor
      where id = p_freeze_id;
    v_created_id := p_freeze_id;
  else
    update public.subscription_freezes
      set cleared_at = now(), cleared_by = p_actor, updated_at = now(), updated_by = p_actor
      where id = p_freeze_id;
    v_created_id := p_freeze_id;
  end if;

  select coalesce(sum(days),0), count(*) into v_total, v_used
  from public.subscription_freezes where subscription_id = p_subscription_id and cleared_at is null;
  v_new_end := v_base_end + v_total;

  -- Active freeze takes precedence; otherwise select nearest future freeze.
  select freeze_from, freeze_until into v_surface_from, v_surface_until
  from public.subscription_freezes x
  where x.subscription_id = p_subscription_id and x.cleared_at is null and x.freeze_until > v_today
  order by case when x.freeze_from <= v_today then 0 else 1 end,
           case when x.freeze_from <= v_today then x.freeze_from end desc nulls last,
           case when x.freeze_from > v_today then x.freeze_from end asc nulls last,
           x.created_at asc
  limit 1;

  update public.subscriptions
    set end_date = v_new_end,
        frozen_from = v_surface_from,
        frozen_until = v_surface_until,
        status = case when s.subscription_type = 'time' and s.status in ('active','expired')
          then case when v_new_end >= v_today then 'active' else 'expired' end
          else s.status end
    where id = p_subscription_id;

  return jsonb_build_object('ok',true,'action',p_action,'id',p_subscription_id,
    'freeze_id',v_created_id,'end_date',v_new_end,
    'frozen_from',v_surface_from,'frozen_until',v_surface_until,
    'freeze_tokens_used',v_used,'freeze_tokens_allowed',v_allowed);
end;
$$;
