-- Private Coaching UX Lot 6A — Quick direct booking
-- Allows Head Coach / Super Admin to create a booking directly after agreeing
-- with a member, without requiring a manually pre-created availability slot.
-- Existing passes, tokens, booking cancellation, completion and slot booking remain unchanged.

begin;

create or replace function public.private_coaching_quick_book(
  p_member_id uuid,
  p_coach_id uuid,
  p_slot_date date,
  p_start_time time without time zone,
  p_end_time time without time zone,
  p_note text,
  p_actor_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_role text;
  v_member_role text;
  v_coach_role text;
  v_pass public.private_coaching_passes%rowtype;
  v_slot_id uuid;
  v_slot_note text;
  v_booking_id uuid;
  v_next_used integer;
begin
  select p.role
  into v_actor_role
  from public.profiles p
  where p.user_id = p_actor_id;

  if coalesce(v_actor_role, '') not in ('head_coach', 'super_admin') then
    raise exception 'PRIVATE_COACHING_FORBIDDEN';
  end if;

  if v_actor_role = 'head_coach' and p_coach_id <> p_actor_id then
    raise exception 'PRIVATE_COACHING_FORBIDDEN';
  end if;

  select p.role
  into v_member_role
  from public.profiles p
  where p.user_id = p_member_id;

  if not found then
    raise exception 'PRIVATE_COACHING_MEMBER_NOT_FOUND';
  end if;

  if coalesce(v_member_role, '') not in ('member', 'champion', 'vip') then
    raise exception 'PRIVATE_COACHING_MEMBER_NOT_FOUND';
  end if;

  select p.role
  into v_coach_role
  from public.profiles p
  where p.user_id = p_coach_id;

  if not found then
    raise exception 'PRIVATE_COACHING_HEAD_COACH_NOT_FOUND';
  end if;

  if coalesce(v_coach_role, '') <> 'head_coach' then
    raise exception 'PRIVATE_COACHING_HEAD_COACH_NOT_FOUND';
  end if;

  if p_slot_date < current_date then
    raise exception 'PRIVATE_COACHING_SLOT_IN_PAST';
  end if;

  if p_end_time <= p_start_time then
    raise exception 'PRIVATE_COACHING_INVALID_TIME_RANGE';
  end if;

  if char_length(coalesce(p_note, '')) > 500 then
    raise exception 'PRIVATE_COACHING_NOTE_TOO_LONG';
  end if;

  -- Serialize quick-book attempts for the same coach/member on the same date.
  perform pg_advisory_xact_lock(hashtext('private_coaching_coach:' || p_coach_id::text || ':' || p_slot_date::text));
  perform pg_advisory_xact_lock(hashtext('private_coaching_member:' || p_member_id::text || ':' || p_slot_date::text));

  if exists (
    select 1
    from public.private_coaching_bookings b
    where b.coach_id = p_coach_id
      and b.slot_date = p_slot_date
      and b.status = 'booked'
      and b.start_time < p_end_time
      and b.end_time > p_start_time
  ) then
    raise exception 'PRIVATE_COACHING_COACH_CONFLICT';
  end if;

  if exists (
    select 1
    from public.private_coaching_bookings b
    where b.member_id = p_member_id
      and b.slot_date = p_slot_date
      and b.status = 'booked'
      and b.start_time < p_end_time
      and b.end_time > p_start_time
  ) then
    raise exception 'PRIVATE_COACHING_MEMBER_CONFLICT';
  end if;

  -- If an exact normal availability slot already exists, reuse it instead of
  -- creating a duplicate internal slot.
  select s.id, s.note
  into v_slot_id, v_slot_note
  from public.private_coaching_slots s
  where s.coach_id = p_coach_id
    and s.slot_date = p_slot_date
    and s.start_time = p_start_time
    and s.end_time = p_end_time
    and s.status = 'available'
    and (
      coalesce(s.is_backdated, false) = false
      or s.assigned_member_id = p_member_id
    )
  order by s.created_at asc
  limit 1
  for update;

  if v_slot_id is null and exists (
    select 1
    from public.private_coaching_slots s
    where s.coach_id = p_coach_id
      and s.slot_date = p_slot_date
      and s.status = 'available'
      and s.start_time < p_end_time
      and s.end_time > p_start_time
  ) then
    raise exception 'PRIVATE_COACHING_AVAILABILITY_CONFLICT';
  end if;

  select pass.*
  into v_pass
  from public.private_coaching_passes pass
  where pass.member_id = p_member_id
    and pass.coach_id = p_coach_id
    and pass.status = 'active'
    and pass.remaining_sessions > 0
  order by pass.activated_at asc, pass.created_at asc
  limit 1
  for update;

  if not found then
    raise exception 'PRIVATE_COACHING_NO_TOKENS';
  end if;

  if v_slot_id is null then
    insert into public.private_coaching_slots (
      coach_id,
      slot_date,
      start_time,
      end_time,
      status,
      note,
      created_by,
      updated_by
    ) values (
      p_coach_id,
      p_slot_date,
      p_start_time,
      p_end_time,
      'booked',
      nullif(btrim(coalesce(p_note, '')), ''),
      p_actor_id,
      p_actor_id
    )
    returning id, note into v_slot_id, v_slot_note;
  else
    update public.private_coaching_slots s
    set status = 'booked',
        updated_by = p_actor_id
    where s.id = v_slot_id;
  end if;

  v_next_used := coalesce(v_pass.used_sessions, 0) + 1;

  update public.private_coaching_passes pass
  set used_sessions = v_next_used,
      status = case
        when v_next_used >= pass.total_sessions then 'depleted'
        else 'active'
      end,
      updated_by = p_actor_id
  where pass.id = v_pass.id;

  insert into public.private_coaching_bookings (
    pass_id,
    slot_id,
    member_id,
    coach_id,
    slot_date,
    start_time,
    end_time,
    status,
    note,
    booked_at,
    created_by,
    updated_by
  ) values (
    v_pass.id,
    v_slot_id,
    p_member_id,
    p_coach_id,
    p_slot_date,
    p_start_time,
    p_end_time,
    'booked',
    coalesce(nullif(btrim(coalesce(p_note, '')), ''), v_slot_note),
    timezone('utc', now()),
    p_actor_id,
    p_actor_id
  )
  returning id into v_booking_id;

  return v_booking_id;
end;
$$;

revoke all on function public.private_coaching_quick_book(
  uuid,
  uuid,
  date,
  time without time zone,
  time without time zone,
  text,
  uuid
) from public;

grant execute on function public.private_coaching_quick_book(
  uuid,
  uuid,
  date,
  time without time zone,
  time without time zone,
  text,
  uuid
) to service_role;

commit;
