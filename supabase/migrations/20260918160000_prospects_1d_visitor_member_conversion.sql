-- ATOM Prospects 1D — Visitor / Member Conversion
-- Adds durable Prospect -> Visitor / Member links while reusing validated Visitor,
-- Member, Auth and Family flows. No subscription logic is duplicated here.

begin;

alter table public.prospects
  add column if not exists linked_visitor_trial_id uuid null references public.visitor_trials(id) on delete set null;

alter table public.prospects
  add column if not exists linked_member_id uuid null references public.profiles(user_id) on delete set null;

alter table public.prospects
  add column if not exists converted_at timestamptz null;

alter table public.prospects
  add column if not exists converted_by uuid null references public.profiles(user_id) on delete set null;

create index if not exists prospects_linked_visitor_trial_idx
  on public.prospects(linked_visitor_trial_id)
  where linked_visitor_trial_id is not null;

create index if not exists prospects_linked_member_idx
  on public.prospects(linked_member_id)
  where linked_member_id is not null;

alter table public.prospect_activities
  drop constraint if exists prospect_activities_type_chk;

alter table public.prospect_activities
  add constraint prospect_activities_type_chk
  check (
    activity_type in (
      'submission','status_change','assignment','follow_up_scheduled',
      'note','whatsapp','call','email','joined','lost',
      'visitor_linked','member_linked'
    )
  ) not valid;

alter table public.prospect_activities validate constraint prospect_activities_type_chk;

create or replace function public.prospect_normalize_name(p_name text)
returns text
language sql
immutable
as $$
  select nullif(lower(regexp_replace(btrim(coalesce(p_name, '')), '[[:space:]]+', ' ', 'g')), '');
$$;

create or replace function public.prospect_convert_to_visitor(
  p_prospect_id uuid,
  p_first_name text,
  p_last_name text default null,
  p_trial_date date default ((now() at time zone 'Africa/Cairo')::date),
  p_notes text default null,
  p_actor_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_prospect public.prospects%rowtype;
  v_matches uuid[];
  v_visitor_id uuid;
  v_reused boolean := false;
  v_target_name text;
  v_existing_member_id uuid;
begin
  if p_prospect_id is null then raise exception 'INVALID_PROSPECT_ID'; end if;
  if nullif(btrim(coalesce(p_first_name, '')), '') is null then raise exception 'VISITOR_FIRST_NAME_REQUIRED'; end if;

  select * into v_prospect
  from public.prospects
  where id = p_prospect_id
  for update;

  if not found then raise exception 'PROSPECT_NOT_FOUND'; end if;

  if v_prospect.linked_visitor_trial_id is not null then
    return jsonb_build_object(
      'visitor_trial_id', v_prospect.linked_visitor_trial_id,
      'reused', true,
      'already_linked', true
    );
  end if;

  v_target_name := public.prospect_normalize_name(concat_ws(' ', p_first_name, nullif(btrim(coalesce(p_last_name, '')), '')));

  select array_agg(x.id order by x.created_at asc)
  into v_matches
  from (
    select distinct vt.id, vt.created_at
    from public.visitor_trials vt
    where
      (
        v_prospect.email_normalized is not null
        and public.prospect_normalize_email(vt.email) = v_prospect.email_normalized
      )
      or
      (
        v_prospect.phone_digits is not null
        and public.prospect_normalize_phone(vt.phone) = v_prospect.phone_digits
        and public.prospect_normalize_name(concat_ws(' ', vt.first_name, vt.last_name)) = v_target_name
      )
  ) x;

  if coalesce(cardinality(v_matches), 0) > 1 then
    raise exception 'PROSPECT_VISITOR_CONTACT_CONFLICT';
  end if;

  if coalesce(cardinality(v_matches), 0) = 1 then
    v_visitor_id := v_matches[1];
    v_reused := true;
  else
    insert into public.visitor_trials(
      first_name, last_name, phone, email, source_key, status, trial_date, notes, created_by, updated_by
    ) values (
      btrim(p_first_name),
      nullif(btrim(coalesce(p_last_name, '')), ''),
      v_prospect.phone,
      v_prospect.email,
      'website',
      'booked',
      coalesce(p_trial_date, ((now() at time zone 'Africa/Cairo')::date)),
      nullif(btrim(coalesce(p_notes, '')), ''),
      p_actor_user_id,
      p_actor_user_id
    ) returning id into v_visitor_id;
  end if;

  select linked_member_id into v_existing_member_id
  from public.visitor_trials
  where id = v_visitor_id;

  update public.prospects
  set
    linked_visitor_trial_id = v_visitor_id,
    status = case
      when status = 'joined' then status
      when v_existing_member_id is not null then status
      else 'trial_booked'
    end,
    updated_by = p_actor_user_id
  where id = p_prospect_id;

  if v_existing_member_id is not null then
    perform public.prospect_link_member(p_prospect_id, v_existing_member_id, p_actor_user_id);
  end if;

  insert into public.prospect_activities(
    prospect_id, activity_type, summary, details, actor_user_id, occurred_at
  ) values (
    p_prospect_id,
    'visitor_linked',
    case when v_reused then 'Existing Visitor linked to prospect' else 'Visitor created from prospect' end,
    jsonb_build_object('visitor_trial_id', v_visitor_id, 'reused', v_reused),
    p_actor_user_id,
    now()
  );

  return jsonb_build_object(
    'visitor_trial_id', v_visitor_id,
    'reused', v_reused,
    'already_linked', false
  );
end;
$$;

create or replace function public.prospect_link_member(
  p_prospect_id uuid,
  p_member_user_id uuid,
  p_actor_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_prospect public.prospects%rowtype;
  v_member public.profiles%rowtype;
  v_visitor_member_id uuid;
begin
  if p_prospect_id is null or p_member_user_id is null then raise exception 'INVALID_ID'; end if;

  select * into v_prospect
  from public.prospects
  where id = p_prospect_id
  for update;
  if not found then raise exception 'PROSPECT_NOT_FOUND'; end if;

  select * into v_member
  from public.profiles
  where user_id = p_member_user_id;
  if not found then raise exception 'MEMBER_NOT_FOUND'; end if;
  if v_member.role not in ('member','champion','vip','assistant_coach','coach','head_coach') then
    raise exception 'MEMBER_PROFILE_ROLE_NOT_ELIGIBLE';
  end if;

  if v_prospect.linked_member_id is not null and v_prospect.linked_member_id <> p_member_user_id then
    raise exception 'PROSPECT_ALREADY_LINKED_TO_DIFFERENT_MEMBER';
  end if;

  if v_prospect.linked_visitor_trial_id is not null then
    select linked_member_id into v_visitor_member_id
    from public.visitor_trials
    where id = v_prospect.linked_visitor_trial_id;

    if v_visitor_member_id is not null and v_visitor_member_id <> p_member_user_id then
      raise exception 'PROSPECT_VISITOR_MEMBER_CONFLICT';
    end if;
  end if;

  if v_prospect.linked_member_id is null then
    update public.prospects
    set
      linked_member_id = p_member_user_id,
      status = 'joined',
      converted_at = coalesce(converted_at, now()),
      converted_by = coalesce(converted_by, p_actor_user_id),
      updated_by = p_actor_user_id
    where id = p_prospect_id;

    insert into public.prospect_activities(
      prospect_id, activity_type, summary, details, actor_user_id, occurred_at
    ) values (
      p_prospect_id,
      'member_linked',
      'Member linked to prospect',
      jsonb_build_object('member_user_id', p_member_user_id, 'member_id', v_member.member_id),
      p_actor_user_id,
      now()
    );
  end if;

  return jsonb_build_object(
    'member_user_id', v_member.user_id,
    'member_id', v_member.member_id,
    'already_linked', v_prospect.linked_member_id = p_member_user_id
  );
end;
$$;

create or replace function public.prospect_link_existing_member(
  p_prospect_id uuid,
  p_actor_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_prospect public.prospects%rowtype;
  v_matches uuid[];
  v_result jsonb;
begin
  select * into v_prospect
  from public.prospects
  where id = p_prospect_id
  for update;
  if not found then raise exception 'PROSPECT_NOT_FOUND'; end if;

  if v_prospect.linked_member_id is not null then
    return public.prospect_link_member(p_prospect_id, v_prospect.linked_member_id, p_actor_user_id);
  end if;

  select array_agg(x.user_id order by x.created_at asc)
  into v_matches
  from (
    select distinct p.user_id, p.created_at
    from public.profiles p
    where p.role in ('member','champion','vip','assistant_coach','coach','head_coach')
      and (
        v_prospect.email_normalized is not null
        and public.prospect_normalize_email(p.email) = v_prospect.email_normalized
      )
      or
      (
        v_prospect.phone_digits is not null
        and public.prospect_normalize_phone(p.phone) = v_prospect.phone_digits
        and public.prospect_normalize_name(concat_ws(' ', p.first_name, p.last_name)) = public.prospect_normalize_name(v_prospect.full_name)
      )
  ) x;

  if coalesce(cardinality(v_matches), 0) > 1 then
    raise exception 'PROSPECT_MEMBER_CONTACT_CONFLICT';
  end if;

  if coalesce(cardinality(v_matches), 0) = 0 then
    return jsonb_build_object('matched', false, 'member_user_id', null);
  end if;

  v_result := public.prospect_link_member(p_prospect_id, v_matches[1], p_actor_user_id);
  return jsonb_build_object('matched', true) || v_result;
end;
$$;

create or replace function public.prospect_sync_from_visitor_member()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_conflict_count integer;
  v_member_id text;
begin
  if new.linked_member_id is null or new.linked_member_id is not distinct from old.linked_member_id then
    return new;
  end if;

  select count(*) into v_conflict_count
  from public.prospects p
  where p.linked_visitor_trial_id = new.id
    and p.linked_member_id is not null
    and p.linked_member_id <> new.linked_member_id;

  if v_conflict_count > 0 then
    raise exception 'PROSPECT_VISITOR_MEMBER_CONFLICT';
  end if;

  select member_id into v_member_id from public.profiles where user_id = new.linked_member_id;

  insert into public.prospect_activities(
    prospect_id, activity_type, summary, details, actor_user_id, occurred_at
  )
  select
    p.id,
    'member_linked',
    'Visitor conversion linked Member to prospect',
    jsonb_build_object('visitor_trial_id', new.id, 'member_user_id', new.linked_member_id, 'member_id', v_member_id),
    new.updated_by,
    now()
  from public.prospects p
  where p.linked_visitor_trial_id = new.id
    and p.linked_member_id is null;

  update public.prospects p
  set
    linked_member_id = new.linked_member_id,
    status = 'joined',
    converted_at = coalesce(p.converted_at, now()),
    converted_by = coalesce(p.converted_by, new.updated_by),
    updated_by = new.updated_by
  where p.linked_visitor_trial_id = new.id
    and (p.linked_member_id is null or p.linked_member_id = new.linked_member_id);

  return new;
end;
$$;

drop trigger if exists trg_prospect_sync_from_visitor_member on public.visitor_trials;
create trigger trg_prospect_sync_from_visitor_member
after update of linked_member_id on public.visitor_trials
for each row execute function public.prospect_sync_from_visitor_member();

revoke all on function public.prospect_convert_to_visitor(uuid, text, text, date, text, uuid) from public, anon, authenticated;
revoke all on function public.prospect_link_member(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.prospect_link_existing_member(uuid, uuid) from public, anon, authenticated;
grant execute on function public.prospect_convert_to_visitor(uuid, text, text, date, text, uuid) to service_role;
grant execute on function public.prospect_link_member(uuid, uuid, uuid) to service_role;
grant execute on function public.prospect_link_existing_member(uuid, uuid) to service_role;

commit;
