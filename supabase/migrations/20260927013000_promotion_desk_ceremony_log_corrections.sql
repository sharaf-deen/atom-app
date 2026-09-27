-- Belt Promotions 2A — Promotion Desk Ceremony Log & Safe Same-Day Corrections
-- Adds an immutable correction audit table and a transactional undo RPC.
-- Existing promotion history is not rewritten. A correction is a compensating action.

begin;

create table if not exists public.promotion_desk_corrections (
  id uuid primary key default gen_random_uuid(),
  progress_event_id uuid not null unique
    references public.member_athlete_progress_events(id) on delete restrict,
  member_user_id uuid not null
    references public.profiles(user_id) on delete cascade,
  original_event_type text not null
    check (original_event_type in ('stripe_award', 'belt_promotion')),
  original_effective_date date not null,
  original_payload jsonb not null default '{}'::jsonb,
  reason text not null check (char_length(trim(reason)) between 3 and 1000),
  corrected_at timestamptz not null default timezone('utc', now()),
  corrected_by uuid null
    references public.profiles(user_id) on delete set null
);

create index if not exists idx_promotion_desk_corrections_member_date
  on public.promotion_desk_corrections(member_user_id, original_effective_date desc, corrected_at desc);

alter table public.promotion_desk_corrections enable row level security;

revoke all on table public.promotion_desk_corrections from anon, authenticated;
grant select, insert on table public.promotion_desk_corrections to service_role;

create or replace function public.undo_promotion_desk_event(
  p_progress_event_id uuid,
  p_reason text,
  p_actor_user_id uuid
)
returns table (
  member_user_id uuid,
  original_event_type text,
  effective_date date
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.member_athlete_progress_events%rowtype;
  v_current_stripes integer;
  v_target_belt_id uuid;
  v_latest_belt_id uuid;
begin
  if p_actor_user_id is null or not exists (
    select 1
    from public.profiles p
    where p.user_id = p_actor_user_id
      and p.role in ('head_coach', 'super_admin')
  ) then
    raise exception 'promotion_correction_forbidden';
  end if;

  if char_length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'promotion_correction_reason_required';
  end if;

  select *
  into v_event
  from public.member_athlete_progress_events e
  where e.id = p_progress_event_id
  for update;

  if not found then
    raise exception 'promotion_event_not_found';
  end if;

  if v_event.event_type not in ('stripe_award', 'belt_promotion')
     or coalesce(v_event.notes, '') not like 'Promotion Desk · %' then
    raise exception 'promotion_event_not_from_desk';
  end if;

  if exists (
    select 1
    from public.promotion_desk_corrections c
    where c.progress_event_id = v_event.id
  ) then
    raise exception 'promotion_event_already_corrected';
  end if;

  -- Only the latest still-active Promotion Desk promotion for a member/date can be undone.
  if exists (
    select 1
    from public.member_athlete_progress_events later
    where later.member_user_id = v_event.member_user_id
      and later.effective_date = v_event.effective_date
      and later.event_type in ('stripe_award', 'belt_promotion')
      and coalesce(later.notes, '') like 'Promotion Desk · %'
      and later.created_at > v_event.created_at
      and not exists (
        select 1
        from public.promotion_desk_corrections later_correction
        where later_correction.progress_event_id = later.id
      )
  ) then
    raise exception 'promotion_event_has_later_promotion';
  end if;

  select tp.stripes
  into v_current_stripes
  from public.member_training_profiles tp
  where tp.member_user_id = v_event.member_user_id
  for update;

  if not found then
    raise exception 'promotion_current_state_missing';
  end if;

  if v_event.event_type = 'stripe_award' then
    if coalesce(v_current_stripes, 0) <> coalesce(v_event.next_stripes, 0) then
      raise exception 'promotion_current_state_changed';
    end if;

    update public.member_training_profiles
    set
      stripes = greatest(0, least(4, coalesce(v_event.previous_stripes, 0))),
      updated_by = p_actor_user_id
    where member_user_id = v_event.member_user_id;

  elsif v_event.event_type = 'belt_promotion' then
    -- Locate the exact belt row created by the Promotion Desk action.
    select bp.id
    into v_target_belt_id
    from public.member_belt_promotions bp
    where bp.member_user_id = v_event.member_user_id
      and bp.belt_code = v_event.next_belt_code
      and bp.promoted_at = v_event.effective_date
      and coalesce(bp.notes, '') = coalesce(v_event.notes, '')
    order by bp.created_at desc
    limit 1
    for update;

    if not found then
      raise exception 'promotion_belt_record_not_found';
    end if;

    -- Do not remove an older belt if another newer belt is already current.
    select bp.id
    into v_latest_belt_id
    from public.member_belt_promotions bp
    where bp.member_user_id = v_event.member_user_id
    order by bp.promoted_at desc, bp.created_at desc
    limit 1;

    if v_latest_belt_id is distinct from v_target_belt_id then
      raise exception 'promotion_current_state_changed';
    end if;

    if coalesce(v_current_stripes, 0) <> coalesce(v_event.next_stripes, 0) then
      raise exception 'promotion_current_state_changed';
    end if;

    delete from public.member_belt_promotions
    where id = v_target_belt_id;

    update public.member_training_profiles
    set
      stripes = greatest(0, least(4, coalesce(v_event.previous_stripes, 0))),
      updated_by = p_actor_user_id
    where member_user_id = v_event.member_user_id;
  end if;

  insert into public.promotion_desk_corrections (
    progress_event_id,
    member_user_id,
    original_event_type,
    original_effective_date,
    original_payload,
    reason,
    corrected_by
  )
  values (
    v_event.id,
    v_event.member_user_id,
    v_event.event_type,
    v_event.effective_date,
    jsonb_build_object(
      'previous_program_level', v_event.previous_program_level,
      'next_program_level', v_event.next_program_level,
      'previous_belt_code', v_event.previous_belt_code,
      'next_belt_code', v_event.next_belt_code,
      'previous_stripes', v_event.previous_stripes,
      'next_stripes', v_event.next_stripes,
      'notes', v_event.notes,
      'created_at', v_event.created_at,
      'created_by', v_event.created_by
    ),
    trim(p_reason),
    p_actor_user_id
  );

  -- Keep the athlete progression timeline auditable without deleting the original event.
  insert into public.member_athlete_progress_events (
    id,
    member_user_id,
    event_type,
    effective_date,
    previous_program_level,
    next_program_level,
    previous_belt_code,
    next_belt_code,
    previous_stripes,
    next_stripes,
    notes,
    created_by
  )
  values (
    gen_random_uuid(),
    v_event.member_user_id,
    'note',
    v_event.effective_date,
    v_event.next_program_level,
    v_event.previous_program_level,
    v_event.next_belt_code,
    v_event.previous_belt_code,
    v_event.next_stripes,
    v_event.previous_stripes,
    'Promotion Desk correction · Reverted event ' || v_event.id::text || ' · Reason: ' || trim(p_reason),
    p_actor_user_id
  );

  return query
  select v_event.member_user_id, v_event.event_type, v_event.effective_date;
end;
$$;

revoke all on function public.undo_promotion_desk_event(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.undo_promotion_desk_event(uuid, text, uuid) to service_role;

commit;
