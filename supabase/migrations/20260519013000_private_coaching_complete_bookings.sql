begin;

create or replace function public.private_coaching_complete_booking_by_coach(
  p_booking_id uuid,
  p_actor_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_role text;
  v_booking public.private_coaching_bookings%rowtype;
begin
  select role into v_actor_role
  from public.profiles
  where user_id = p_actor_id;

  if coalesce(v_actor_role, '') not in ('head_coach', 'super_admin') then
    raise exception 'PRIVATE_COACHING_FORBIDDEN';
  end if;

  select * into v_booking
  from public.private_coaching_bookings
  where id = p_booking_id
  for update;

  if not found then
    raise exception 'PRIVATE_COACHING_BOOKING_NOT_FOUND';
  end if;

  if v_actor_role = 'head_coach' and v_booking.coach_id <> p_actor_id then
    raise exception 'PRIVATE_COACHING_FORBIDDEN';
  end if;

  if v_booking.status <> 'booked' then
    return v_booking.id;
  end if;

  update public.private_coaching_bookings
  set status = 'completed',
      completed_at = timezone('utc', now()),
      updated_by = p_actor_id
  where id = v_booking.id;

  update public.private_coaching_slots
  set updated_by = p_actor_id
  where id = v_booking.slot_id;

  return v_booking.id;
end;
$$;

revoke all on function public.private_coaching_complete_booking_by_coach(uuid, uuid) from public;
grant execute on function public.private_coaching_complete_booking_by_coach(uuid, uuid) to service_role;

commit;
