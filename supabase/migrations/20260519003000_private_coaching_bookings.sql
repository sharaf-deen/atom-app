begin;

alter table public.private_coaching_slots
  drop constraint if exists private_coaching_slots_status_check;

alter table public.private_coaching_slots
  add constraint private_coaching_slots_status_check
  check (status in ('available', 'booked', 'cancelled'));

create table if not exists public.private_coaching_bookings (
  id uuid primary key default gen_random_uuid(),
  pass_id uuid not null references public.private_coaching_passes(id) on delete restrict,
  slot_id uuid not null unique references public.private_coaching_slots(id) on delete restrict,
  member_id uuid not null references public.profiles(user_id) on delete cascade,
  coach_id uuid not null references public.profiles(user_id) on delete restrict,
  slot_date date not null,
  start_time time without time zone not null,
  end_time time without time zone not null,
  status text not null default 'booked' check (status in ('booked', 'completed', 'cancelled')),
  note text null,
  booked_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz null,
  cancelled_at timestamptz null,
  cancelled_by uuid null references public.profiles(user_id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  created_by uuid null references public.profiles(user_id) on delete set null,
  updated_by uuid null references public.profiles(user_id) on delete set null,
  constraint private_coaching_bookings_time_order_check check (end_time > start_time),
  constraint private_coaching_bookings_cancelled_state_check check (
    status <> 'cancelled' or (cancelled_at is not null and cancelled_by is not null)
  ),
  constraint private_coaching_bookings_completed_state_check check (
    status <> 'completed' or completed_at is not null
  )
);

create index if not exists idx_private_coaching_bookings_member_date
  on public.private_coaching_bookings(member_id, slot_date desc, start_time desc);

create index if not exists idx_private_coaching_bookings_coach_date
  on public.private_coaching_bookings(coach_id, slot_date desc, start_time desc);

create index if not exists idx_private_coaching_bookings_status_date
  on public.private_coaching_bookings(status, slot_date, start_time);

drop trigger if exists trg_private_coaching_bookings_updated_at on public.private_coaching_bookings;
create trigger trg_private_coaching_bookings_updated_at
before update on public.private_coaching_bookings
for each row execute function public.set_updated_at();

alter table public.private_coaching_bookings enable row level security;

drop policy if exists private_coaching_bookings_member_select_own on public.private_coaching_bookings;
create policy private_coaching_bookings_member_select_own
on public.private_coaching_bookings
for select
to authenticated
using (member_id = auth.uid());

drop policy if exists private_coaching_bookings_manager_select on public.private_coaching_bookings;
create policy private_coaching_bookings_manager_select
on public.private_coaching_bookings
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.user_id = auth.uid()
      and (
        p.role = 'super_admin'
        or (p.role = 'head_coach' and private_coaching_bookings.coach_id = auth.uid())
      )
  )
);

drop policy if exists private_coaching_bookings_super_admin_all on public.private_coaching_bookings;
create policy private_coaching_bookings_super_admin_all
on public.private_coaching_bookings
for all
to authenticated
using (public.is_super_admin(auth.uid()))
with check (public.is_super_admin(auth.uid()));

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
  v_member_role text;
  v_slot public.private_coaching_slots%rowtype;
  v_pass public.private_coaching_passes%rowtype;
  v_booking_id uuid;
begin
  select role into v_member_role
  from public.profiles
  where user_id = p_member_id;

  if coalesce(v_member_role, '') not in ('member', 'champion', 'vip') then
    raise exception 'PRIVATE_COACHING_FORBIDDEN';
  end if;

  select * into v_slot
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
    raise exception 'PRIVATE_COACHING_SLOT_IN_PAST';
  end if;

  select * into v_pass
  from public.private_coaching_passes
  where member_id = p_member_id
    and coach_id = v_slot.coach_id
    and status = 'active'
    and remaining_sessions > 0
  order by activated_at asc, created_at asc
  limit 1
  for update;

  if not found then
    raise exception 'PRIVATE_COACHING_NO_TOKENS';
  end if;

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
    created_by,
    updated_by
  ) values (
    v_pass.id,
    v_slot.id,
    p_member_id,
    v_slot.coach_id,
    v_slot.slot_date,
    v_slot.start_time,
    v_slot.end_time,
    'booked',
    v_slot.note,
    p_member_id,
    p_member_id
  )
  returning id into v_booking_id;

  update public.private_coaching_passes
  set used_sessions = used_sessions + 1,
      status = case when used_sessions + 1 >= total_sessions then 'depleted' else 'active' end,
      updated_by = p_member_id
  where id = v_pass.id;

  update public.private_coaching_slots
  set status = 'booked',
      updated_by = p_member_id
  where id = v_slot.id;

  return v_booking_id;
end;
$$;

create or replace function public.private_coaching_cancel_booking_by_coach(
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
  set status = 'cancelled',
      cancelled_at = timezone('utc', now()),
      cancelled_by = p_actor_id,
      updated_by = p_actor_id
  where id = v_booking.id;

  update public.private_coaching_slots
  set status = 'cancelled',
      cancelled_at = timezone('utc', now()),
      cancelled_by = p_actor_id,
      updated_by = p_actor_id
  where id = v_booking.slot_id;

  update public.private_coaching_passes
  set used_sessions = greatest(used_sessions - 1, 0),
      status = case when status <> 'cancelled' then 'active' else status end,
      updated_by = p_actor_id
  where id = v_booking.pass_id;

  return v_booking.id;
end;
$$;

revoke all on function public.private_coaching_book_slot(uuid, uuid) from public;
grant execute on function public.private_coaching_book_slot(uuid, uuid) to service_role;

revoke all on function public.private_coaching_cancel_booking_by_coach(uuid, uuid) from public;
grant execute on function public.private_coaching_cancel_booking_by_coach(uuid, uuid) to service_role;

revoke all on table public.private_coaching_bookings from anon, authenticated;
grant select, insert, update, delete on table public.private_coaching_bookings to authenticated;
grant select, insert, update, delete on table public.private_coaching_bookings to service_role;

commit;
