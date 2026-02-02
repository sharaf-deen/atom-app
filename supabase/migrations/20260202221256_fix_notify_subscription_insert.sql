begin;

create or replace function public.notify_subscription_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  j jsonb := to_jsonb(new);

  v_user_id uuid;
  v_member_id text;

  v_title text;
  v_body  text;
  v_kind  text := 'subscription';

  v_has_member_id boolean := false;
  v_has_body boolean := false;
  v_has_message boolean := false;
  v_sql text;
begin
  -- Try to read potential recipient identifiers without referencing missing columns
  -- 1) user_id (if exists)
  begin
    v_user_id := nullif(j->>'user_id','')::uuid;
  exception when others then
    v_user_id := null;
  end;

  -- 2) common fallbacks (safe even if keys absent)
  if v_user_id is null then
    begin
      v_user_id := nullif(j->>'member_user_id','')::uuid;
    exception when others then
      v_user_id := null;
    end;
  end if;

  if v_user_id is null then
    begin
      v_user_id := nullif(j->>'profile_id','')::uuid;
    exception when others then
      v_user_id := null;
    end;
  end if;

  -- member_id (ATOM-xxxxxx) if present
  v_member_id := nullif(j->>'member_id','');

  -- If we have user_id, try to compute member_id
  if v_member_id is null and v_user_id is not null then
    select p.member_id into v_member_id
    from public.profiles p
    where p.user_id = v_user_id
    limit 1;
  end if;

  -- If we don't have user_id but have member_id, resolve user_id from profiles
  if v_user_id is null and v_member_id is not null then
    select p.user_id into v_user_id
    from public.profiles p
    where p.member_id = v_member_id
    limit 1;
  end if;

  -- If still no recipient, do nothing
  if v_user_id is null then
    return new;
  end if;

  v_title := 'Subscription';
  v_body  := 'Your subscription has been created/updated.';

  -- Detect column variants on notifications table (body vs message, member_id optional)
  select exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='notifications' and column_name='member_id'
  ) into v_has_member_id;

  select exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='notifications' and column_name='body'
  ) into v_has_body;

  select exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='notifications' and column_name='message'
  ) into v_has_message;

  -- Build a safe INSERT depending on columns present
  v_sql := 'insert into public.notifications (user_id';

  if v_has_member_id then
    v_sql := v_sql || ', member_id';
  end if;

  v_sql := v_sql || ', title';

  if v_has_body then
    v_sql := v_sql || ', body';
  elsif v_has_message then
    v_sql := v_sql || ', message';
  end if;

  v_sql := v_sql || ', kind';

  -- is_read column is common; include only if it exists
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='notifications' and column_name='is_read'
  ) then
    v_sql := v_sql || ', is_read';
  end if;

  v_sql := v_sql || ') values ($1';

  if v_has_member_id then
    v_sql := v_sql || ', $2';
  end if;

  -- title always
  if v_has_member_id then
    v_sql := v_sql || ', $3';
  else
    v_sql := v_sql || ', $2';
  end if;

  -- body/message if present
  if v_has_body or v_has_message then
    if v_has_member_id then
      v_sql := v_sql || ', $4';
    else
      v_sql := v_sql || ', $3';
    end if;
  end if;

  -- kind
  if v_has_body or v_has_message then
    if v_has_member_id then
      v_sql := v_sql || ', $5';
    else
      v_sql := v_sql || ', $4';
    end if;
  else
    if v_has_member_id then
      v_sql := v_sql || ', $4';
    else
      v_sql := v_sql || ', $3';
    end if;
  end if;

  -- is_read if present
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='notifications' and column_name='is_read'
  ) then
    v_sql := v_sql || ', false';
  end if;

  v_sql := v_sql || ');';

  -- Execute with the right parameter ordering
  if v_has_member_id and (v_has_body or v_has_message) then
    execute v_sql using v_user_id, v_member_id, v_title, v_body, v_kind;
  elsif v_has_member_id and not (v_has_body or v_has_message) then
    execute v_sql using v_user_id, v_member_id, v_title, v_kind;
  elsif (not v_has_member_id) and (v_has_body or v_has_message) then
    execute v_sql using v_user_id, v_title, v_body, v_kind;
  else
    execute v_sql using v_user_id, v_title, v_kind;
  end if;

  return new;
end;
$$;

-- Recreate trigger to ensure it uses latest function
drop trigger if exists trg_notify_subscription_insert on public.subscriptions;
create trigger trg_notify_subscription_insert
  after insert on public.subscriptions
  for each row
  execute function public.notify_subscription_insert();

commit;
