-- Private Coaching UX Lot 6B — Member session requests
-- Adds a lightweight request / counter-proposal workflow without consuming a token
-- until a confirmed booking is created through the validated Lot 6A quick-book engine.

begin;

create table if not exists public.private_coaching_session_requests (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles(user_id) on delete cascade,
  coach_id uuid not null references public.profiles(user_id) on delete restrict,
  requested_date date not null,
  requested_start_time time without time zone not null,
  requested_end_time time without time zone not null,
  member_note text null,
  status text not null default 'pending',
  proposed_date date null,
  proposed_start_time time without time zone null,
  proposed_end_time time without time zone null,
  coach_note text null,
  booking_id uuid null unique references public.private_coaching_bookings(id) on delete set null,
  confirmed_at timestamptz null,
  confirmed_by uuid null references public.profiles(user_id) on delete set null,
  declined_at timestamptz null,
  declined_by uuid null references public.profiles(user_id) on delete set null,
  decline_reason text null,
  cancelled_at timestamptz null,
  cancelled_by uuid null references public.profiles(user_id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  created_by uuid null references public.profiles(user_id) on delete set null,
  updated_by uuid null references public.profiles(user_id) on delete set null,
  constraint private_coaching_session_requests_status_check
    check (status in ('pending', 'coach_proposed', 'confirmed', 'declined', 'cancelled')),
  constraint private_coaching_session_requests_requested_time_check
    check (requested_end_time > requested_start_time),
  constraint private_coaching_session_requests_proposed_time_check
    check (
      (proposed_date is null and proposed_start_time is null and proposed_end_time is null)
      or (
        proposed_date is not null
        and proposed_start_time is not null
        and proposed_end_time is not null
        and proposed_end_time > proposed_start_time
      )
    ),
  constraint private_coaching_session_requests_member_note_length_check
    check (member_note is null or char_length(member_note) <= 500),
  constraint private_coaching_session_requests_coach_note_length_check
    check (coach_note is null or char_length(coach_note) <= 500),
  constraint private_coaching_session_requests_decline_reason_length_check
    check (decline_reason is null or char_length(decline_reason) <= 500),
  constraint private_coaching_session_requests_proposal_state_check
    check (
      status <> 'coach_proposed'
      or (proposed_date is not null and proposed_start_time is not null and proposed_end_time is not null)
    ),
  constraint private_coaching_session_requests_confirmed_state_check
    check (
      status <> 'confirmed'
      or (booking_id is not null and confirmed_at is not null and confirmed_by is not null)
    ),
  constraint private_coaching_session_requests_declined_state_check
    check (
      status <> 'declined'
      or (declined_at is not null and declined_by is not null and decline_reason is not null)
    ),
  constraint private_coaching_session_requests_cancelled_state_check
    check (
      status <> 'cancelled'
      or (cancelled_at is not null and cancelled_by is not null)
    )
);

create index if not exists idx_private_coaching_session_requests_member_created
  on public.private_coaching_session_requests(member_id, created_at desc);

create index if not exists idx_private_coaching_session_requests_coach_status_created
  on public.private_coaching_session_requests(coach_id, status, created_at desc);

create unique index if not exists uq_private_coaching_session_requests_active_member_coach
  on public.private_coaching_session_requests(member_id, coach_id)
  where status in ('pending', 'coach_proposed');

drop trigger if exists trg_private_coaching_session_requests_updated_at on public.private_coaching_session_requests;
create trigger trg_private_coaching_session_requests_updated_at
before update on public.private_coaching_session_requests
for each row execute function public.set_updated_at();

alter table public.private_coaching_session_requests enable row level security;

-- Session requests are intentionally API-only. The server validates the signed-in user
-- and uses the service-role client; no direct authenticated table writes are needed.
revoke all on table public.private_coaching_session_requests from anon, authenticated;
grant select, insert, update, delete on table public.private_coaching_session_requests to service_role;

create or replace function public.private_coaching_propose_session_time(
  p_request_id uuid,
  p_actor_id uuid,
  p_slot_date date,
  p_start_time time without time zone,
  p_end_time time without time zone,
  p_note text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_role text;
  v_request public.private_coaching_session_requests%rowtype;
begin
  select p.role
  into v_actor_role
  from public.profiles p
  where p.user_id = p_actor_id;

  if coalesce(v_actor_role, '') not in ('head_coach', 'super_admin') then
    raise exception 'PRIVATE_COACHING_SESSION_REQUEST_FORBIDDEN';
  end if;

  select r.*
  into v_request
  from public.private_coaching_session_requests r
  where r.id = p_request_id
  for update;

  if not found then
    raise exception 'PRIVATE_COACHING_SESSION_REQUEST_NOT_FOUND';
  end if;

  if v_actor_role = 'head_coach' and v_request.coach_id <> p_actor_id then
    raise exception 'PRIVATE_COACHING_SESSION_REQUEST_FORBIDDEN';
  end if;

  if v_request.status not in ('pending', 'coach_proposed') then
    raise exception 'PRIVATE_COACHING_SESSION_REQUEST_NOT_ACTIONABLE';
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

  update public.private_coaching_session_requests r
  set status = 'coach_proposed',
      proposed_date = p_slot_date,
      proposed_start_time = p_start_time,
      proposed_end_time = p_end_time,
      coach_note = nullif(btrim(coalesce(p_note, '')), ''),
      updated_by = p_actor_id
  where r.id = v_request.id;

  return v_request.id;
end;
$$;

create or replace function public.private_coaching_decline_session_request(
  p_request_id uuid,
  p_actor_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_role text;
  v_request public.private_coaching_session_requests%rowtype;
  v_reason text;
begin
  v_reason := btrim(coalesce(p_reason, ''));

  if char_length(v_reason) < 3 or char_length(v_reason) > 500 then
    raise exception 'PRIVATE_COACHING_DECLINE_REASON_REQUIRED';
  end if;

  select p.role
  into v_actor_role
  from public.profiles p
  where p.user_id = p_actor_id;

  if coalesce(v_actor_role, '') not in ('head_coach', 'super_admin') then
    raise exception 'PRIVATE_COACHING_SESSION_REQUEST_FORBIDDEN';
  end if;

  select r.*
  into v_request
  from public.private_coaching_session_requests r
  where r.id = p_request_id
  for update;

  if not found then
    raise exception 'PRIVATE_COACHING_SESSION_REQUEST_NOT_FOUND';
  end if;

  if v_actor_role = 'head_coach' and v_request.coach_id <> p_actor_id then
    raise exception 'PRIVATE_COACHING_SESSION_REQUEST_FORBIDDEN';
  end if;

  if v_request.status not in ('pending', 'coach_proposed') then
    raise exception 'PRIVATE_COACHING_SESSION_REQUEST_NOT_ACTIONABLE';
  end if;

  update public.private_coaching_session_requests r
  set status = 'declined',
      declined_at = timezone('utc', now()),
      declined_by = p_actor_id,
      decline_reason = v_reason,
      updated_by = p_actor_id
  where r.id = v_request.id;

  return v_request.id;
end;
$$;

create or replace function public.private_coaching_cancel_session_request(
  p_request_id uuid,
  p_actor_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.private_coaching_session_requests%rowtype;
begin
  select r.*
  into v_request
  from public.private_coaching_session_requests r
  where r.id = p_request_id
  for update;

  if not found then
    raise exception 'PRIVATE_COACHING_SESSION_REQUEST_NOT_FOUND';
  end if;

  if v_request.member_id <> p_actor_id then
    raise exception 'PRIVATE_COACHING_SESSION_REQUEST_FORBIDDEN';
  end if;

  if v_request.status not in ('pending', 'coach_proposed') then
    raise exception 'PRIVATE_COACHING_SESSION_REQUEST_NOT_ACTIONABLE';
  end if;

  update public.private_coaching_session_requests r
  set status = 'cancelled',
      cancelled_at = timezone('utc', now()),
      cancelled_by = p_actor_id,
      updated_by = p_actor_id
  where r.id = v_request.id;

  return v_request.id;
end;
$$;

create or replace function public.private_coaching_confirm_session_request(
  p_request_id uuid,
  p_actor_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_role text;
  v_request public.private_coaching_session_requests%rowtype;
  v_slot_date date;
  v_start_time time without time zone;
  v_end_time time without time zone;
  v_booking_actor uuid;
  v_booking_note text;
  v_booking_id uuid;
begin
  select p.role
  into v_actor_role
  from public.profiles p
  where p.user_id = p_actor_id;

  select r.*
  into v_request
  from public.private_coaching_session_requests r
  where r.id = p_request_id
  for update;

  if not found then
    raise exception 'PRIVATE_COACHING_SESSION_REQUEST_NOT_FOUND';
  end if;

  if v_request.status = 'pending' then
    if coalesce(v_actor_role, '') not in ('head_coach', 'super_admin') then
      raise exception 'PRIVATE_COACHING_SESSION_REQUEST_FORBIDDEN';
    end if;
    if v_actor_role = 'head_coach' and v_request.coach_id <> p_actor_id then
      raise exception 'PRIVATE_COACHING_SESSION_REQUEST_FORBIDDEN';
    end if;

    v_slot_date := v_request.requested_date;
    v_start_time := v_request.requested_start_time;
    v_end_time := v_request.requested_end_time;
    v_booking_actor := p_actor_id;
  elsif v_request.status = 'coach_proposed' then
    if v_request.member_id <> p_actor_id then
      raise exception 'PRIVATE_COACHING_SESSION_REQUEST_FORBIDDEN';
    end if;

    v_slot_date := v_request.proposed_date;
    v_start_time := v_request.proposed_start_time;
    v_end_time := v_request.proposed_end_time;
    -- The coach proposed this time, so create the final booking under the coach
    -- while retaining the member acceptance in confirmed_by below.
    v_booking_actor := v_request.coach_id;
  else
    raise exception 'PRIVATE_COACHING_SESSION_REQUEST_NOT_ACTIONABLE';
  end if;

  if v_slot_date is null or v_start_time is null or v_end_time is null then
    raise exception 'PRIVATE_COACHING_SESSION_REQUEST_INVALID_TIME';
  end if;

  v_booking_note := nullif(
    left(
      concat_ws(
        ' · ',
        nullif(btrim(coalesce(v_request.member_note, '')), ''),
        nullif(btrim(coalesce(v_request.coach_note, '')), '')
      ),
      500
    ),
    ''
  );

  select public.private_coaching_quick_book(
    v_request.member_id,
    v_request.coach_id,
    v_slot_date,
    v_start_time,
    v_end_time,
    v_booking_note,
    v_booking_actor
  )
  into v_booking_id;

  update public.private_coaching_session_requests r
  set status = 'confirmed',
      booking_id = v_booking_id,
      confirmed_at = timezone('utc', now()),
      confirmed_by = p_actor_id,
      updated_by = p_actor_id
  where r.id = v_request.id;

  return v_booking_id;
end;
$$;

revoke all on function public.private_coaching_propose_session_time(uuid, uuid, date, time without time zone, time without time zone, text) from public;
grant execute on function public.private_coaching_propose_session_time(uuid, uuid, date, time without time zone, time without time zone, text) to service_role;

revoke all on function public.private_coaching_decline_session_request(uuid, uuid, text) from public;
grant execute on function public.private_coaching_decline_session_request(uuid, uuid, text) to service_role;

revoke all on function public.private_coaching_cancel_session_request(uuid, uuid) from public;
grant execute on function public.private_coaching_cancel_session_request(uuid, uuid) to service_role;

revoke all on function public.private_coaching_confirm_session_request(uuid, uuid) from public;
grant execute on function public.private_coaching_confirm_session_request(uuid, uuid) to service_role;

commit;
