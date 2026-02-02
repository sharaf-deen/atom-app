-- Fix: notifications visible to members + subscription-created notification
-- This migration:
-- 1) Ensures RLS policies allow members to read/update/delete their own notifications.
-- 2) Ensures staff can insert notifications when needed.
-- 3) Replaces notify_subscription_insert() to insert a notification for the subscribed member.
-- 4) Recreates the trigger on public.subscriptions to use the fixed function.

begin;

-- -----------------------------
-- 1) Notifications RLS policies
-- -----------------------------
alter table if exists public.notifications enable row level security;

-- Drop only the policies we manage (idempotent)
drop policy if exists notifications_select_own on public.notifications;
drop policy if exists notifications_update_own on public.notifications;
drop policy if exists notifications_delete_own on public.notifications;
drop policy if exists notifications_insert_staff on public.notifications;

-- Members can read their own notifications; staff can read all (via public.is_staff)
create policy notifications_select_own
  on public.notifications
  as permissive
  for select
  to authenticated
  using (
    user_id = auth.uid()
    or public.is_staff(auth.uid())
  );

-- Members can update their own (e.g., mark read); staff can update all
create policy notifications_update_own
  on public.notifications
  as permissive
  for update
  to authenticated
  using (
    user_id = auth.uid()
    or public.is_staff(auth.uid())
  )
  with check (
    user_id = auth.uid()
    or public.is_staff(auth.uid())
  );

-- Members can delete their own; staff can delete all
create policy notifications_delete_own
  on public.notifications
  as permissive
  for delete
  to authenticated
  using (
    user_id = auth.uid()
    or public.is_staff(auth.uid())
  );

-- Allow staff to insert notifications manually (optional)
create policy notifications_insert_staff
  on public.notifications
  as permissive
  for insert
  to authenticated
  with check (
    public.is_staff(auth.uid())
  );

-- ------------------------------------------
-- 2) Subscription notification trigger (fix)
-- ------------------------------------------
create or replace function public.notify_subscription_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_member_id text;
  v_title text;
  v_body text;
  v_kind text := 'subscription';
  v_has_member_id boolean := false;
  v_has_body boolean := false;
  v_has_message boolean := false;
  v_sql text;
begin
  -- Recipient user
  v_user_id := new.user_id;

  -- Compute member_id (if available)
  if new.member_id is not null then
    v_member_id := new.member_id;
  elsif v_user_id is not null then
    select p.member_id into v_member_id
    from public.profiles p
    where p.user_id = v_user_id;
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

-- Recreate trigger to ensure it's using the latest function definition
drop trigger if exists trg_notify_subscription_insert on public.subscriptions;
create trigger trg_notify_subscription_insert
  after insert on public.subscriptions
  for each row
  execute function public.notify_subscription_insert();

commit;
