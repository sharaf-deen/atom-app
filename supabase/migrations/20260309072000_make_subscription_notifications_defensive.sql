begin;

create or replace function public.notify_subscription_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member uuid;
  v_actor uuid;
  v_plan text;
  v_start text;
  v_end text;
  v_amount text;
  v_recipient_profile_exists boolean;
  v_recipient_auth_exists boolean;
  v_actor_profile_exists boolean;
begin
  v_member := new.member_id;
  if v_member is null then
    return new;
  end if;

  select exists (
    select 1
    from public.profiles p
    where p.user_id = v_member
  ) into v_recipient_profile_exists;

  if not v_recipient_profile_exists then
    return new;
  end if;

  select exists (
    select 1
    from auth.users u
    where u.id = v_member
  ) into v_recipient_auth_exists;

  v_actor := auth.uid();
  if v_actor is not null then
    select exists (
      select 1
      from public.profiles p
      where p.user_id = v_actor
    ) into v_actor_profile_exists;

    if not v_actor_profile_exists then
      v_actor := null;
    end if;
  end if;

  v_plan := coalesce(nullif(new.plan,''), nullif(new.subscription_type,''), 'Subscription');
  v_start := coalesce(to_char(new.start_date, 'YYYY-MM-DD'), '');
  v_end := coalesce(to_char(new.end_date, 'YYYY-MM-DD'), '');
  v_amount := case when new.amount is null then '' else trim(to_char(new.amount, 'FM999999990.00')) end;

  insert into public.notifications (member_id, user_id, title, body, kind, created_by)
  values (
    v_member,
    case when v_recipient_auth_exists then v_member else null end,
    'Membership created',
    trim(both from concat(
      'Your membership has been created',
      case when v_plan <> '' then concat(' (', v_plan, ')') else '' end,
      case when v_start <> '' then concat('. Start: ', v_start) else '' end,
      case when v_end <> '' then concat('. End: ', v_end) else '' end,
      case when v_amount <> '' then concat('. Amount: ', v_amount, ' EGP') else '' end
    )),
    'billing',
    v_actor
  );

  return new;
end;
$$;

create or replace function public.notify_subscription_update_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member uuid;
  v_actor uuid;

  old_status text;
  new_status text;

  old_frozen date;
  new_frozen date;

  changes text := '';
  v_title text := 'Membership updated';
  v_body text := '';

  v_recipient_profile_exists boolean;
  v_recipient_auth_exists boolean;
  v_actor_profile_exists boolean;
begin
  v_actor := auth.uid();
  if v_actor is not null then
    select exists (
      select 1
      from public.profiles p
      where p.user_id = v_actor
    ) into v_actor_profile_exists;

    if not v_actor_profile_exists then
      v_actor := null;
    end if;
  end if;

  if tg_op = 'DELETE' then
    v_member := old.member_id;
    if v_member is null then
      return old;
    end if;

    select exists (
      select 1
      from public.profiles p
      where p.user_id = v_member
    ) into v_recipient_profile_exists;

    if not v_recipient_profile_exists then
      return old;
    end if;

    select exists (
      select 1
      from auth.users u
      where u.id = v_member
    ) into v_recipient_auth_exists;

    insert into public.notifications (member_id, user_id, title, body, kind, created_by)
    values (
      v_member,
      case when v_recipient_auth_exists then v_member else null end,
      'Membership deleted',
      'Your membership has been deleted.',
      'billing',
      v_actor
    );

    return old;
  end if;

  v_member := coalesce(new.member_id, old.member_id);
  if v_member is null then
    return new;
  end if;

  select exists (
    select 1
    from public.profiles p
    where p.user_id = v_member
  ) into v_recipient_profile_exists;

  if not v_recipient_profile_exists then
    return new;
  end if;

  select exists (
    select 1
    from auth.users u
    where u.id = v_member
  ) into v_recipient_auth_exists;

  old_status := coalesce(old.status,'');
  new_status := coalesce(new.status,'');

  old_frozen := old.frozen_until;
  new_frozen := new.frozen_until;

  if old_status <> new_status and lower(new_status) = 'frozen' then
    v_title := 'Membership frozen';
    v_body := case
      when new_frozen is not null then
        concat('Your membership has been frozen until ', to_char(new_frozen, 'YYYY-MM-DD'), '.')
      else
        'Your membership has been frozen.'
    end;

  elsif (old_status <> new_status and lower(old_status) = 'frozen' and lower(new_status) <> 'frozen')
        or (old_frozen is not null and new_frozen is null) then
    v_title := 'Membership resumed';
    v_body := 'Your membership has been resumed.';

  elsif (old_frozen is distinct from new_frozen) and new_frozen is not null then
    v_title := 'Membership freeze updated';
    v_body := concat('Your freeze date has been updated until ', to_char(new_frozen, 'YYYY-MM-DD'), '.');

  else
    if coalesce(old.plan,'') <> coalesce(new.plan,'') then
      changes := changes || concat('Plan: ', coalesce(old.plan,'-'), ' → ', coalesce(new.plan,'-'), ' | ');
    end if;

    if coalesce(old.subscription_type,'') <> coalesce(new.subscription_type,'') then
      changes := changes || concat('Type: ', coalesce(old.subscription_type,'-'), ' → ', coalesce(new.subscription_type,'-'), ' | ');
    end if;

    if old.start_date is distinct from new.start_date then
      changes := changes || concat('Start: ', coalesce(to_char(old.start_date,'YYYY-MM-DD'),'-'),
                                  ' → ', coalesce(to_char(new.start_date,'YYYY-MM-DD'),'-'), ' | ');
    end if;

    if old.end_date is distinct from new.end_date then
      changes := changes || concat('End: ', coalesce(to_char(old.end_date,'YYYY-MM-DD'),'-'),
                                  ' → ', coalesce(to_char(new.end_date,'YYYY-MM-DD'),'-'), ' | ');
    end if;

    if old.amount is distinct from new.amount then
      changes := changes || concat(
        'Amount: ',
        coalesce(trim(to_char(old.amount,'FM999999990.00')),'-'),
        ' → ',
        coalesce(trim(to_char(new.amount,'FM999999990.00')),'-'),
        ' | '
      );
    end if;

    if old_status <> new_status then
      changes := changes || concat('Status: ', coalesce(old.status,'-'), ' → ', coalesce(new.status,'-'), ' | ');
    end if;

    changes := regexp_replace(changes, '\s\|\s$', '');
    v_body := case
      when changes = '' then 'Your membership has been updated.'
      else concat('Your membership has been updated. ', changes)
    end;
  end if;

  insert into public.notifications (member_id, user_id, title, body, kind, created_by)
  values (
    v_member,
    case when v_recipient_auth_exists then v_member else null end,
    v_title,
    v_body,
    'billing',
    v_actor
  );

  return new;
end;
$$;

commit;
