-- Private Coaching Lot 6D — Backdated slots for missed bookings
-- Adds controlled past-slot corrections assigned to one member only.

alter table if exists public.private_coaching_slots
  add column if not exists is_backdated boolean not null default false,
  add column if not exists assigned_member_id uuid null,
  add column if not exists backdated_reason text null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'private_coaching_slots_assigned_member_id_fkey'
      and conrelid = 'public.private_coaching_slots'::regclass
  ) then
    alter table public.private_coaching_slots
      add constraint private_coaching_slots_assigned_member_id_fkey
      foreign key (assigned_member_id)
      references public.profiles(user_id)
      on delete set null;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'private_coaching_slots_backdated_assignment_check'
      and conrelid = 'public.private_coaching_slots'::regclass
  ) then
    alter table public.private_coaching_slots
      add constraint private_coaching_slots_backdated_assignment_check
      check (
        is_backdated = false
        or assigned_member_id is not null
      );
  end if;
end $$;

create index if not exists private_coaching_slots_backdated_member_idx
  on public.private_coaching_slots (assigned_member_id, slot_date, start_time)
  where is_backdated = true;

create index if not exists private_coaching_slots_coach_date_status_idx
  on public.private_coaching_slots (coach_id, slot_date, start_time, status);

-- Replace booking RPC so regular past slots stay blocked, but backdated correction
-- slots assigned to the authenticated member can be booked and consume 1 token.
create or replace function public.private_coaching_book_slot(
  p_slot_id uuid,
  p_member_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot record;
  v_pass record;
  v_booking_id uuid;
  v_next_used integer;
begin
  select
    id,
    coach_id,
    slot_date,
    start_time,
    end_time,
    status,
    note,
    coalesce(is_backdated, false) as is_backdated,
    assigned_member_id,
    backdated_reason
  into v_slot
  from public.private_coaching_slots
  where id = p_slot_id
  for update;

  if not found then
    raise exception 'PRIVATE_COACHING_SLOT_NOT_FOUND';
  end if;

  if v_slot.status <> 'available' then
    raise exception 'PRIVATE_COACHING_SLOT_NOT_AVAILABLE';
  end if;

  if v_slot.slot_date < current_date then
    if v_slot.is_backdated is not true then
      raise exception 'PRIVATE_COACHING_SLOT_IN_PAST';
    end if;

    if v_slot.assigned_member_id is null or v_slot.assigned_member_id <> p_member_id then
      raise exception 'PRIVATE_COACHING_FORBIDDEN';
    end if;
  end if;

  if v_slot.is_backdated is true
     and v_slot.assigned_member_id is not null
     and v_slot.assigned_member_id <> p_member_id then
    raise exception 'PRIVATE_COACHING_FORBIDDEN';
  end if;

  select
    id,
    total_sessions,
    used_sessions,
    remaining_sessions,
    status
  into v_pass
  from public.private_coaching_passes
  where member_id = p_member_id
    and coach_id = v_slot.coach_id
    and status = 'active'
    and remaining_sessions > 0
  order by created_at asc
  limit 1
  for update;

  if not found then
    raise exception 'PRIVATE_COACHING_NO_TOKENS';
  end if;

  v_next_used := coalesce(v_pass.used_sessions, 0) + 1;

  update public.private_coaching_passes
  set
    used_sessions = v_next_used,
    status = case when v_next_used >= coalesce(total_sessions, 0) then 'depleted' else 'active' end
  where id = v_pass.id;

  update public.private_coaching_slots
  set
    status = 'booked',
    updated_at = now(),
    updated_by = p_member_id
  where id = v_slot.id;

  insert into public.private_coaching_bookings (
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
    v_slot.id,
    p_member_id,
    v_slot.coach_id,
    v_slot.slot_date,
    v_slot.start_time,
    v_slot.end_time,
    'booked',
    coalesce(v_slot.backdated_reason, v_slot.note),
    now(),
    p_member_id,
    p_member_id
  )
  returning id into v_booking_id;

  return v_booking_id;
end;
$$;

grant execute on function public.private_coaching_book_slot(uuid, uuid) to authenticated;
