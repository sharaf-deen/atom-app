begin;

create or replace function public.notify_subscription_update_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  jn jsonb;
  jo jsonb;

  v_user_id uuid;
  v_member_id text;
  v_actor_id uuid;

  -- update/freeze detection
  old_status text;
  new_status text;
  old_frozen boolean;
  new_frozen boolean;
  freeze_until text;

  action text;
  title text;
  body text;

  plan_label text;
  start_label text;
  end_label text;

  changed boolean := false;
begin
  if tg_op = 'UPDATE' then
    jn := to_jsonb(new);
    jo := to_jsonb(old);

    -- Only notify on meaningful changes (avoid noise on updated_at, etc.)
    if (jo->>'status') is distinct from (jn->>'status') then changed := true; end if;
    if (jo->>'is_frozen') is distinct from (jn->>'is_frozen') then changed := true; end if;
    if (jo->>'freeze_until') is distinct from (jn->>'freeze_until') then changed := true; end if;

    if (jo->>'start_date') is distinct from (jn->>'start_date') then changed := true; end if;
    if (jo->>'end_date') is distinct from (jn->>'end_date') then changed := true; end if;

    if (jo->>'plan_name') is distinct from (jn->>'plan_name') then changed := true; end if;
    if (jo->>'plan_id') is distinct from (jn->>'plan_id') then changed := true; end if;

    if (jo->>'amount_cents') is distinct from (jn->>'amount_cents') then changed := true; end if;

    if not changed then
      return new;
    end if;
  else
    -- DELETE
    jo := to_jsonb(old);
  end if;

  -- Resolve actor (best effort)
  begin
    v_actor_id := nullif(coalesce(
      (case when tg_op='UPDATE' then jn->>'updated_by' end),
      (case when tg_op='UPDATE' then jn->>'created_by' end),
      jo->>'updated_by',
      jo->>'created_by'
    ), '')::uuid;
  exception when others then
    v_actor_id := null;
  end;

  v_actor_id := coalesce(v_actor_id, auth.uid());

  -- Resolve member_id / user_id safely using JSON (no direct NEW.user_id access)
  v_member_id := nullif(coalesce(
    (case when tg_op='UPDATE' then jn->>'member_id' end),
    jo->>'member_id'
  ), '');

  -- 1) Try get user_id from JSON keys (if your table ever has them)
  begin
    v_user_id := nullif(coalesce(
      (case when tg_op='UPDATE' then jn->>'user_id' end),
      jo->>'user_id',
      (case when tg_op='UPDATE' then jn->>'member_user_id' end),
      jo->>'member_user_id',
      (case when tg_op='UPDATE' then jn->>'profile_id' end),
      jo->>'profile_id'
    ), '')::uuid;
  exception when others then
    v_user_id := null;
  end;

  -- 2) If we have member_id but no user_id, resolve from profiles
  if v_user_id is null and v_member_id is not null then
    select p.user_id into v_user_id
    from public.profiles p
    where p.member_id = v_member_id
    limit 1;
  end if;

  -- 3) If we have user_id but no member_id, resolve member_id
  if v_member_id is null and v_user_id is not null then
    select p.member_id into v_member_id
    from public.profiles p
    where p.user_id = v_user_id
    limit 1;
  end if;

  -- If still no recipient, do nothing
  if v_user_id is null then
    if tg_op = 'UPDATE' then return new; else return old; end if;
  end if;

  -- Prepare labels
  plan_label := coalesce(
    nullif((case when tg_op='UPDATE' then jn->>'plan_name' end), ''),
    nullif(jo->>'plan_name', ''),
    nullif((case when tg_op='UPDATE' then jn->>'plan' end), ''),
    nullif(jo->>'plan', ''),
    nullif((case when tg_op='UPDATE' then jn->>'package_name' end), ''),
    nullif(jo->>'package_name', '')
  );

  start_label := coalesce(
    nullif((case when tg_op='UPDATE' then jn->>'start_date' end), ''),
    nullif(jo->>'start_date', ''),
    nullif((case when tg_op='UPDATE' then jn->>'starts_at' end), ''),
    nullif(jo->>'starts_at', '')
  );

  end_label := coalesce(
    nullif((case when tg_op='UPDATE' then jn->>'end_date' end), ''),
    nullif(jo->>'end_date', ''),
    nullif((case when tg_op='UPDATE' then jn->>'ends_at' end), ''),
    nullif(jo->>'ends_at', ''),
    nullif((case when tg_op='UPDATE' then jn->>'expires_at' end), ''),
    nullif(jo->>'expires_at', '')
  );

  -- Detect freeze/unfreeze if possible
  old_status := coalesce(jo->>'status', '');
  new_status := coalesce((case when tg_op='UPDATE' then jn->>'status' end), '');

  begin old_frozen := (jo->>'is_frozen')::boolean; exception when others then old_frozen := null; end;
  begin new_frozen := (case when tg_op='UPDATE' then (jn->>'is_frozen')::boolean end); exception when others then new_frozen := null; end;

  freeze_until := coalesce(
    nullif((case when tg_op='UPDATE' then jn->>'freeze_until' end), ''),
    nullif((case when tg_op='UPDATE' then jn->>'frozen_until' end), ''),
    nullif((case when tg_op='UPDATE' then jn->>'freeze_end' end), '')
  );

  if tg_op = 'DELETE' then
    action := 'deleted';
  else
    -- Frozen if bool flips to true OR status becomes frozen/paused OR freeze_until set/changed
    if (new_frozen is true and (old_frozen is distinct from new_frozen))
       or (new_status in ('frozen','paused') and old_status is distinct from new_status)
       or (freeze_until is not null and coalesce(jo->>'freeze_until','') is distinct from freeze_until)
    then
      action := 'frozen';
    elsif (new_frozen is false and (old_frozen is distinct from new_frozen))
          or (old_status in ('frozen','paused') and new_status not in ('frozen','paused') and new_status <> '')
    then
      action := 'unfrozen';
    else
      action := 'updated';
    end if;
  end if;

  -- Compose title/body
  if action = 'frozen' then
    title := 'Subscription frozen';
    body := 'Your subscription has been frozen.'
      || (case when freeze_until is not null then ' Freeze ends on ' || freeze_until || '.' else '' end);
  elsif action = 'unfrozen' then
    title := 'Subscription resumed';
    body := 'Your subscription is active again.';
  elsif action = 'deleted' then
    title := 'Subscription removed';
    body := 'Your subscription has been removed. If this is a mistake, please contact reception.';
  else
    title := 'Subscription updated';
    body := 'Your subscription has been updated.'
      || (case when plan_label is not null then ' Plan: ' || plan_label || '.' else '' end)
      || (case when start_label is not null then ' Start: ' || start_label || '.' else '' end)
      || (case when end_label is not null then ' Valid until: ' || end_label || '.' else '' end);
  end if;

  -- Insert notification (keep kind stable to avoid breaking guard_notifications_kind)
  insert into public.notifications (user_id, member_id, title, body, kind, created_by, is_read)
  values (v_user_id, v_member_id, title, body, 'subscription', v_actor_id, false);

  if tg_op = 'UPDATE' then
    return new;
  else
    return old;
  end if;
end;
$$;

drop trigger if exists trg_notify_subscription_update on public.subscriptions;
create trigger trg_notify_subscription_update
after update on public.subscriptions
for each row
execute function public.notify_subscription_update_delete();

drop trigger if exists trg_notify_subscription_delete on public.subscriptions;
create trigger trg_notify_subscription_delete
after delete on public.subscriptions
for each row
execute function public.notify_subscription_update_delete();

commit;
