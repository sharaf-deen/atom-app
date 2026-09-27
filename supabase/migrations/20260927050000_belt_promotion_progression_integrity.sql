-- Belt Promotions 2C — Progression Integrity & Single Promotion Path
-- Protects rank progression from direct profile edits and makes both official
-- promotion workflows transactional: Promotion Desk and Belt Promotion Events.

begin;

create or replace function public.update_athlete_profile_non_rank(
  p_member_user_id uuid,
  p_program_level text,
  p_specialty text,
  p_reference_coach_user_id uuid,
  p_notes text,
  p_actor_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target_role text;
  v_previous_program_level text;
  v_current_stripes integer := 0;
  v_profile_exists boolean := false;
begin
  if p_actor_user_id is null or not exists (
    select 1
    from public.profiles p
    where p.user_id = p_actor_user_id
      and p.role in ('head_coach', 'super_admin')
  ) then
    raise exception 'athlete_profile_update_forbidden';
  end if;

  select p.role::text
  into v_target_role
  from public.profiles p
  where p.user_id = p_member_user_id
  for update;

  if not found or v_target_role not in ('member', 'champion', 'vip', 'assistant_coach', 'coach') then
    raise exception 'athlete_profile_member_not_found';
  end if;

  if p_program_level is not null
     and p_program_level not in ('beginner', 'intermediate', 'advanced', 'competitor') then
    raise exception 'athlete_profile_invalid_program_level';
  end if;

  if p_specialty is not null
     and p_specialty not in ('kimono_only', 'nogi_only', 'both') then
    raise exception 'athlete_profile_invalid_specialty';
  end if;

  if p_reference_coach_user_id is not null and not exists (
    select 1
    from public.profiles coach
    where coach.user_id = p_reference_coach_user_id
      and coach.role in ('coach', 'assistant_coach', 'head_coach')
  ) then
    raise exception 'athlete_profile_invalid_reference_coach';
  end if;

  select tp.program_level, coalesce(tp.stripes, 0)
  into v_previous_program_level, v_current_stripes
  from public.member_training_profiles tp
  where tp.member_user_id = p_member_user_id
  for update;

  v_profile_exists := found;

  if v_profile_exists then
    update public.member_training_profiles
    set
      program_level = p_program_level,
      specialty = p_specialty,
      reference_coach_user_id = p_reference_coach_user_id,
      notes = nullif(trim(coalesce(p_notes, '')), ''),
      updated_by = p_actor_user_id
    where member_user_id = p_member_user_id;
  else
    insert into public.member_training_profiles (
      member_user_id,
      program_level,
      stripes,
      specialty,
      reference_coach_user_id,
      notes,
      updated_by
    )
    values (
      p_member_user_id,
      p_program_level,
      0,
      p_specialty,
      p_reference_coach_user_id,
      nullif(trim(coalesce(p_notes, '')), ''),
      p_actor_user_id
    );

    v_previous_program_level := null;
    v_current_stripes := 0;
  end if;

  if v_previous_program_level is distinct from p_program_level then
    insert into public.member_athlete_progress_events (
      id,
      member_user_id,
      event_type,
      effective_date,
      previous_program_level,
      next_program_level,
      previous_stripes,
      next_stripes,
      notes,
      created_by
    )
    values (
      gen_random_uuid(),
      p_member_user_id,
      'program_change',
      (now() at time zone 'Africa/Cairo')::date,
      v_previous_program_level,
      p_program_level,
      v_current_stripes,
      v_current_stripes,
      'Athlete profile · Program level change',
      p_actor_user_id
    );
  end if;
end;
$$;

revoke all on function public.update_athlete_profile_non_rank(uuid, text, text, uuid, text, uuid)
from public, anon, authenticated;
grant execute on function public.update_athlete_profile_non_rank(uuid, text, text, uuid, text, uuid)
to service_role;

create or replace function public.move_athlete_program(
  p_member_user_id uuid,
  p_next_program_level text,
  p_effective_date date,
  p_notes text,
  p_actor_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target_role text;
  v_previous_program_level text;
  v_current_stripes integer := 0;
  v_event_id uuid := gen_random_uuid();
begin
  if p_actor_user_id is null or not exists (
    select 1
    from public.profiles p
    where p.user_id = p_actor_user_id
      and p.role in ('head_coach', 'super_admin')
  ) then
    raise exception 'program_move_forbidden';
  end if;

  select p.role::text
  into v_target_role
  from public.profiles p
  where p.user_id = p_member_user_id
  for update;

  if not found or v_target_role not in ('member', 'champion', 'vip', 'assistant_coach', 'coach') then
    raise exception 'program_move_member_not_found';
  end if;

  if p_next_program_level is null
     or p_next_program_level not in ('beginner', 'intermediate', 'advanced', 'competitor') then
    raise exception 'program_move_invalid_level';
  end if;

  if p_effective_date is null
     or p_effective_date > (now() at time zone 'Africa/Cairo')::date then
    raise exception 'program_move_invalid_date';
  end if;

  select tp.program_level, coalesce(tp.stripes, 0)
  into v_previous_program_level, v_current_stripes
  from public.member_training_profiles tp
  where tp.member_user_id = p_member_user_id
  for update;

  if found then
    if v_previous_program_level is not distinct from p_next_program_level then
      return null;
    end if;

    update public.member_training_profiles
    set
      program_level = p_next_program_level,
      updated_by = p_actor_user_id
    where member_user_id = p_member_user_id;
  else
    v_previous_program_level := null;
    v_current_stripes := 0;

    insert into public.member_training_profiles (
      member_user_id,
      program_level,
      stripes,
      updated_by
    )
    values (
      p_member_user_id,
      p_next_program_level,
      0,
      p_actor_user_id
    );
  end if;

  insert into public.member_athlete_progress_events (
    id,
    member_user_id,
    event_type,
    effective_date,
    previous_program_level,
    next_program_level,
    previous_stripes,
    next_stripes,
    notes,
    created_by
  )
  values (
    v_event_id,
    p_member_user_id,
    'program_change',
    p_effective_date,
    v_previous_program_level,
    p_next_program_level,
    v_current_stripes,
    v_current_stripes,
    nullif(trim(coalesce(p_notes, '')), ''),
    p_actor_user_id
  );

  return v_event_id;
end;
$$;

revoke all on function public.move_athlete_program(uuid, text, date, text, uuid)
from public, anon, authenticated;
grant execute on function public.move_athlete_program(uuid, text, date, text, uuid)
to service_role;

create or replace function public.apply_promotion_desk_promotion(
  p_member_user_id uuid,
  p_promotion_type text,
  p_promoted_at date,
  p_next_stripes integer,
  p_new_belt text,
  p_note text,
  p_expected_previous_belt text,
  p_expected_previous_stripes integer,
  p_actor_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target_role text;
  v_program_level text;
  v_current_stripes integer := 0;
  v_current_belt text;
  v_new_belt text;
  v_event_note text;
  v_progress_event_id uuid := gen_random_uuid();
begin
  if p_actor_user_id is null or not exists (
    select 1
    from public.profiles p
    where p.user_id = p_actor_user_id
      and p.role in ('head_coach', 'super_admin')
  ) then
    raise exception 'promotion_forbidden';
  end if;

  select p.role::text
  into v_target_role
  from public.profiles p
  where p.user_id = p_member_user_id
  for update;

  if not found or v_target_role not in ('member', 'champion', 'vip', 'assistant_coach', 'coach') then
    raise exception 'promotion_member_not_found';
  end if;

  if p_promoted_at is null then
    raise exception 'promotion_invalid_date';
  end if;

  if p_promoted_at > (now() at time zone 'Africa/Cairo')::date then
    raise exception 'promotion_future_date';
  end if;

  if p_promotion_type not in ('stripe', 'belt') then
    raise exception 'promotion_invalid_type';
  end if;

  select tp.program_level, coalesce(tp.stripes, 0)
  into v_program_level, v_current_stripes
  from public.member_training_profiles tp
  where tp.member_user_id = p_member_user_id
  for update;

  if not found then
    insert into public.member_training_profiles (
      member_user_id,
      program_level,
      stripes,
      updated_by
    )
    values (
      p_member_user_id,
      null,
      0,
      p_actor_user_id
    );

    v_program_level := null;
    v_current_stripes := 0;
  end if;

  select lower(trim(bp.belt_code))
  into v_current_belt
  from public.member_belt_promotions bp
  where bp.member_user_id = p_member_user_id
  order by bp.promoted_at desc, bp.created_at desc
  limit 1;

  if v_current_belt is null and v_current_stripes > 0 then
    v_current_belt := 'white';
  end if;

  if v_current_stripes <> coalesce(p_expected_previous_stripes, 0) then
    raise exception 'promotion_state_changed';
  end if;

  if lower(coalesce(v_current_belt, '')) <> lower(coalesce(nullif(trim(p_expected_previous_belt), ''), '')) then
    raise exception 'promotion_state_changed';
  end if;

  v_event_note := 'Promotion Desk · ' || p_promoted_at::text;
  if nullif(trim(coalesce(p_note, '')), '') is not null then
    v_event_note := v_event_note || ' — ' || left(trim(p_note), 1000);
  end if;

  if p_promotion_type = 'stripe' then
    if p_next_stripes is null or p_next_stripes < 1 or p_next_stripes > 4 then
      raise exception 'promotion_invalid_stripes';
    end if;

    if p_next_stripes <= v_current_stripes then
      raise exception 'promotion_stripe_not_higher';
    end if;

    update public.member_training_profiles
    set
      stripes = p_next_stripes,
      updated_by = p_actor_user_id
    where member_user_id = p_member_user_id;

    insert into public.member_athlete_progress_events (
      id,
      member_user_id,
      event_type,
      effective_date,
      previous_program_level,
      next_program_level,
      previous_stripes,
      next_stripes,
      notes,
      created_by
    )
    values (
      v_progress_event_id,
      p_member_user_id,
      'stripe_award',
      p_promoted_at,
      v_program_level,
      v_program_level,
      v_current_stripes,
      p_next_stripes,
      v_event_note,
      p_actor_user_id
    );
  else
    v_new_belt := lower(trim(coalesce(p_new_belt, '')));

    if v_new_belt not in ('white', 'grey', 'yellow', 'orange', 'green', 'blue', 'purple', 'brown', 'black') then
      raise exception 'promotion_invalid_belt';
    end if;

    if v_current_belt is not null and v_new_belt = v_current_belt then
      raise exception 'promotion_state_changed';
    end if;

    if exists (
      select 1
      from public.member_belt_promotions bp
      where bp.member_user_id = p_member_user_id
        and lower(trim(bp.belt_code)) = v_new_belt
        and bp.promoted_at = p_promoted_at
    ) then
      raise exception 'promotion_duplicate_belt';
    end if;

    insert into public.member_belt_promotions (
      id,
      member_user_id,
      belt_code,
      promoted_at,
      notes,
      created_by,
      updated_by
    )
    values (
      gen_random_uuid(),
      p_member_user_id,
      v_new_belt,
      p_promoted_at,
      v_event_note,
      p_actor_user_id,
      p_actor_user_id
    );

    update public.member_training_profiles
    set
      stripes = 0,
      updated_by = p_actor_user_id
    where member_user_id = p_member_user_id;

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
      v_progress_event_id,
      p_member_user_id,
      'belt_promotion',
      p_promoted_at,
      v_program_level,
      v_program_level,
      v_current_belt,
      v_new_belt,
      v_current_stripes,
      0,
      v_event_note,
      p_actor_user_id
    );
  end if;

  return v_progress_event_id;
end;
$$;

revoke all on function public.apply_promotion_desk_promotion(uuid, text, date, integer, text, text, text, integer, uuid)
from public, anon, authenticated;
grant execute on function public.apply_promotion_desk_promotion(uuid, text, date, integer, text, text, text, integer, uuid)
to service_role;

create or replace function public.apply_belt_promotion_event_results(
  p_event_id uuid,
  p_close_event boolean,
  p_actor_user_id uuid
)
returns table (
  applied_count integer,
  stripe_count integer,
  belt_count integer,
  note_count integer,
  run_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_title text;
  v_event_date date;
  v_candidate public.belt_promotion_event_candidates%rowtype;
  v_target_role text;
  v_program_level text;
  v_current_stripes integer;
  v_specialty text;
  v_reference_coach_user_id uuid;
  v_training_notes text;
  v_current_belt text;
  v_expected_belt text;
  v_next_stripes integer;
  v_new_belt text;
  v_event_note text;
  v_applied_count integer := 0;
  v_stripe_count integer := 0;
  v_belt_count integer := 0;
  v_note_count integer := 0;
  v_run_id uuid := gen_random_uuid();
begin
  if p_actor_user_id is null or not exists (
    select 1
    from public.profiles p
    where p.user_id = p_actor_user_id
      and p.role in ('head_coach', 'super_admin')
  ) then
    raise exception 'belt_event_apply_forbidden';
  end if;

  select e.title, e.event_date
  into v_event_title, v_event_date
  from public.belt_promotion_events e
  where e.id = p_event_id
  for update;

  if not found then
    raise exception 'belt_event_not_found';
  end if;

  if v_event_date > (now() at time zone 'Africa/Cairo')::date then
    raise exception 'belt_event_future_date';
  end if;

  for v_candidate in
    select c.*
    from public.belt_promotion_event_candidates c
    where c.event_id = p_event_id
      and c.final_decision = 'confirmed'
      and c.results_applied_at is null
    order by c.sort_order asc, c.created_at asc
    for update
  loop
    select p.role::text
    into v_target_role
    from public.profiles p
    where p.user_id = v_candidate.member_user_id
    for update;

    if not found or v_target_role not in ('member', 'champion', 'vip', 'assistant_coach', 'coach') then
      raise exception 'belt_event_member_not_found';
    end if;

    if not (
      v_candidate.proposed_decision = 'stripe'
      or (v_candidate.proposed_decision = 'belt' and v_candidate.proposed_belt is not null)
    ) then
      insert into public.member_athlete_progress_events (
        id,
        member_user_id,
        event_type,
        effective_date,
        notes,
        created_by
      )
      values (
        gen_random_uuid(),
        v_candidate.member_user_id,
        'note',
        v_event_date,
        v_event_title || ' · ' || v_event_date::text || ' — confirmed with no promotion' ||
          case
            when nullif(trim(coalesce(v_candidate.head_coach_note, '')), '') is not null
              then ' — ' || left(trim(v_candidate.head_coach_note), 2000)
            else ''
          end,
        p_actor_user_id
      );

      update public.belt_promotion_event_candidates
      set
        results_applied_at = timezone('utc', now()),
        results_applied_by = p_actor_user_id
      where id = v_candidate.id
        and event_id = p_event_id;

      v_note_count := v_note_count + 1;
      v_applied_count := v_applied_count + 1;
      continue;
    end if;

    v_program_level := null;
    v_current_stripes := 0;
    v_specialty := null;
    v_reference_coach_user_id := null;
    v_training_notes := null;

    select
      tp.program_level,
      coalesce(tp.stripes, 0),
      tp.specialty,
      tp.reference_coach_user_id,
      tp.notes
    into
      v_program_level,
      v_current_stripes,
      v_specialty,
      v_reference_coach_user_id,
      v_training_notes
    from public.member_training_profiles tp
    where tp.member_user_id = v_candidate.member_user_id
    for update;

    if not found then
      insert into public.member_training_profiles (
        member_user_id,
        program_level,
        stripes,
        specialty,
        reference_coach_user_id,
        notes,
        updated_by
      )
      values (
        v_candidate.member_user_id,
        null,
        0,
        null,
        v_candidate.reference_coach_user_id,
        nullif(trim(coalesce(v_candidate.head_coach_note, '')), ''),
        p_actor_user_id
      );

      v_current_stripes := 0;
      v_reference_coach_user_id := v_candidate.reference_coach_user_id;
      v_training_notes := nullif(trim(coalesce(v_candidate.head_coach_note, '')), '');
    end if;

    v_current_belt := null;
    select lower(trim(bp.belt_code))
    into v_current_belt
    from public.member_belt_promotions bp
    where bp.member_user_id = v_candidate.member_user_id
    order by bp.promoted_at desc, bp.created_at desc
    limit 1;

    if v_current_belt is null and v_current_stripes > 0 then
      v_current_belt := 'white';
    end if;

    v_expected_belt := lower(nullif(trim(coalesce(v_candidate.current_belt, '')), ''));
    if v_expected_belt is null and coalesce(v_candidate.current_stripes, 0) > 0 then
      v_expected_belt := 'white';
    end if;

    if v_current_stripes <> coalesce(v_candidate.current_stripes, 0)
       or lower(coalesce(v_current_belt, '')) <> lower(coalesce(v_expected_belt, '')) then
      raise exception 'belt_event_progression_state_changed';
    end if;

    if v_candidate.reference_coach_user_id is not null and not exists (
      select 1
      from public.profiles coach
      where coach.user_id = v_candidate.reference_coach_user_id
        and coach.role in ('coach', 'assistant_coach', 'head_coach')
    ) then
      raise exception 'belt_event_invalid_reference_coach';
    end if;

    v_event_note := v_event_title || ' · ' || v_event_date::text;
    if nullif(trim(coalesce(v_candidate.head_coach_note, '')), '') is not null then
      v_event_note := v_event_note || ' — ' || left(trim(v_candidate.head_coach_note), 2000);
    end if;

    if v_candidate.proposed_decision = 'stripe' then
      v_next_stripes := v_candidate.proposed_stripes;

      if v_next_stripes is null or v_next_stripes < 1 or v_next_stripes > 4 then
        raise exception 'belt_event_invalid_stripes';
      end if;

      if v_next_stripes <= v_current_stripes then
        raise exception 'belt_event_stripe_not_higher';
      end if;

      update public.member_training_profiles
      set
        stripes = v_next_stripes,
        reference_coach_user_id = coalesce(v_candidate.reference_coach_user_id, v_reference_coach_user_id),
        notes = coalesce(v_training_notes, nullif(trim(coalesce(v_candidate.head_coach_note, '')), '')),
        updated_by = p_actor_user_id
      where member_user_id = v_candidate.member_user_id;

      insert into public.member_athlete_progress_events (
        id,
        member_user_id,
        event_type,
        effective_date,
        previous_program_level,
        next_program_level,
        previous_stripes,
        next_stripes,
        notes,
        created_by
      )
      values (
        gen_random_uuid(),
        v_candidate.member_user_id,
        'stripe_award',
        v_event_date,
        v_program_level,
        v_program_level,
        v_current_stripes,
        v_next_stripes,
        v_event_note,
        p_actor_user_id
      );

      v_stripe_count := v_stripe_count + 1;

    elsif v_candidate.proposed_decision = 'belt' and v_candidate.proposed_belt is not null then
      v_new_belt := lower(trim(v_candidate.proposed_belt));

      if v_new_belt not in ('white', 'grey', 'yellow', 'orange', 'green', 'blue', 'purple', 'brown', 'black') then
        raise exception 'belt_event_invalid_belt';
      end if;

      if v_current_belt is not null and v_new_belt = v_current_belt then
        raise exception 'belt_event_progression_state_changed';
      end if;

      if exists (
        select 1
        from public.member_belt_promotions bp
        where bp.member_user_id = v_candidate.member_user_id
          and lower(trim(bp.belt_code)) = v_new_belt
          and bp.promoted_at = v_event_date
      ) then
        raise exception 'belt_event_duplicate_belt';
      end if;

      insert into public.member_belt_promotions (
        id,
        member_user_id,
        belt_code,
        promoted_at,
        notes,
        created_by,
        updated_by
      )
      values (
        gen_random_uuid(),
        v_candidate.member_user_id,
        v_new_belt,
        v_event_date,
        v_event_note,
        p_actor_user_id,
        p_actor_user_id
      );

      update public.member_training_profiles
      set
        stripes = 0,
        reference_coach_user_id = coalesce(v_candidate.reference_coach_user_id, v_reference_coach_user_id),
        notes = coalesce(v_training_notes, nullif(trim(coalesce(v_candidate.head_coach_note, '')), '')),
        updated_by = p_actor_user_id
      where member_user_id = v_candidate.member_user_id;

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
        v_candidate.member_user_id,
        'belt_promotion',
        v_event_date,
        v_program_level,
        v_program_level,
        v_current_belt,
        v_new_belt,
        v_current_stripes,
        0,
        v_event_note,
        p_actor_user_id
      );

      v_belt_count := v_belt_count + 1;
    end if;

    update public.belt_promotion_event_candidates
    set
      results_applied_at = timezone('utc', now()),
      results_applied_by = p_actor_user_id
    where id = v_candidate.id
      and event_id = p_event_id;

    v_applied_count := v_applied_count + 1;
  end loop;

  if v_applied_count = 0 then
    return query select 0, 0, 0, 0, null::uuid;
    return;
  end if;

  insert into public.belt_promotion_event_apply_runs (
    id,
    event_id,
    applied_count,
    stripe_count,
    belt_count,
    note_count,
    closed_event,
    applied_by,
    notes
  )
  values (
    v_run_id,
    p_event_id,
    v_applied_count,
    v_stripe_count,
    v_belt_count,
    v_note_count,
    coalesce(p_close_event, false),
    p_actor_user_id,
    v_event_title || ' apply run'
  );

  if coalesce(p_close_event, false) then
    update public.belt_promotion_events
    set status = 'closed'
    where id = p_event_id;
  end if;

  return query
  select v_applied_count, v_stripe_count, v_belt_count, v_note_count, v_run_id;
end;
$$;

revoke all on function public.apply_belt_promotion_event_results(uuid, boolean, uuid)
from public, anon, authenticated;
grant execute on function public.apply_belt_promotion_event_results(uuid, boolean, uuid)
to service_role;

commit;
