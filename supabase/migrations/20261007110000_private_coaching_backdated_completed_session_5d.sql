-- Private Coaching 5D — Backdated Completed Session Entry
-- Records a real private session that already happened but was never booked in ATOM.
-- Supports optional token consumption and optional closure of the member's open
-- session request for the same coach. The new booking is created directly completed.

begin;

alter table public.private_coaching_bookings
  alter column pass_id drop not null;

alter table public.private_coaching_bookings
  add column if not exists is_backdated_entry boolean not null default false,
  add column if not exists backdated_reason text null,
  add column if not exists token_consumed boolean not null default true;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'private_coaching_bookings_backdated_reason_check'
      and conrelid = 'public.private_coaching_bookings'::regclass
  ) then
    alter table public.private_coaching_bookings
      add constraint private_coaching_bookings_backdated_reason_check
      check (
        is_backdated_entry = false
        or char_length(btrim(coalesce(backdated_reason, ''))) between 3 and 500
      );
  end if;
end $$;

create index if not exists idx_private_coaching_bookings_backdated_entry
  on public.private_coaching_bookings (is_backdated_entry, slot_date desc)
  where is_backdated_entry = true;

create or replace function public.private_coaching_record_backdated_completed(
  p_member_id uuid,
  p_coach_id uuid,
  p_slot_date date,
  p_start_time time without time zone,
  p_end_time time without time zone,
  p_note text,
  p_reason text,
  p_consume_token boolean,
  p_close_open_request boolean,
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
  v_pass_id uuid;
  v_slot_id uuid;
  v_booking_id uuid;
  v_next_used integer;
  v_reason text;
  v_note text;
begin
  v_reason := btrim(coalesce(p_reason, ''));
  v_note := nullif(btrim(coalesce(p_note, '')), '');

  select p.role::text into v_actor_role
  from public.profiles p
  where p.user_id = p_actor_id;

  if coalesce(v_actor_role, '') not in ('head_coach', 'super_admin') then
    raise exception 'PRIVATE_COACHING_FORBIDDEN';
  end if;

  if v_actor_role = 'head_coach' and p_coach_id <> p_actor_id then
    raise exception 'PRIVATE_COACHING_FORBIDDEN';
  end if;

  select p.role::text into v_member_role
  from public.profiles p
  where p.user_id = p_member_id;

  if coalesce(v_member_role, '') not in ('member', 'champion', 'vip') then
    raise exception 'PRIVATE_COACHING_MEMBER_NOT_FOUND';
  end if;

  select p.role::text into v_coach_role
  from public.profiles p
  where p.user_id = p_coach_id;

  if coalesce(v_coach_role, '') <> 'head_coach' then
    raise exception 'PRIVATE_COACHING_HEAD_COACH_NOT_FOUND';
  end if;

  if p_slot_date > current_date then
    raise exception 'PRIVATE_COACHING_BACKDATED_FUTURE_DATE';
  end if;

  if p_end_time <= p_start_time then
    raise exception 'PRIVATE_COACHING_INVALID_TIME_RANGE';
  end if;

  if char_length(coalesce(v_note, '')) > 500 then
    raise exception 'PRIVATE_COACHING_NOTE_TOO_LONG';
  end if;

  if char_length(v_reason) < 3 or char_length(v_reason) > 500 then
    raise exception 'PRIVATE_COACHING_BACKDATED_REASON_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(hashtext('private_coaching_backdated_coach:' || p_coach_id::text || ':' || p_slot_date::text));
  perform pg_advisory_xact_lock(hashtext('private_coaching_backdated_member:' || p_member_id::text || ':' || p_slot_date::text));

  if exists (
    select 1 from public.private_coaching_bookings b
    where b.coach_id = p_coach_id
      and b.slot_date = p_slot_date
      and b.status in ('booked', 'completed')
      and b.start_time < p_end_time
      and b.end_time > p_start_time
  ) then
    raise exception 'PRIVATE_COACHING_COACH_CONFLICT';
  end if;

  if exists (
    select 1 from public.private_coaching_bookings b
    where b.member_id = p_member_id
      and b.slot_date = p_slot_date
      and b.status in ('booked', 'completed')
      and b.start_time < p_end_time
      and b.end_time > p_start_time
  ) then
    raise exception 'PRIVATE_COACHING_MEMBER_CONFLICT';
  end if;

  v_pass_id := null;

  if coalesce(p_consume_token, true) then
    select pass.* into v_pass
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

    v_pass_id := v_pass.id;
    v_next_used := coalesce(v_pass.used_sessions, 0) + 1;

    update public.private_coaching_passes pass
    set used_sessions = v_next_used,
        status = case when v_next_used >= pass.total_sessions then 'depleted' else 'active' end,
        updated_by = p_actor_id
    where pass.id = v_pass.id;
  end if;

  insert into public.private_coaching_slots (
    coach_id, slot_date, start_time, end_time, status, note,
    is_backdated, assigned_member_id, backdated_reason, created_by, updated_by
  ) values (
    p_coach_id, p_slot_date, p_start_time, p_end_time, 'booked', v_note,
    true, p_member_id, v_reason, p_actor_id, p_actor_id
  ) returning id into v_slot_id;

  insert into public.private_coaching_bookings (
    pass_id, slot_id, member_id, coach_id, slot_date, start_time, end_time,
    status, note, booked_at, completed_at, is_backdated_entry,
    backdated_reason, token_consumed, created_by, updated_by
  ) values (
    v_pass_id, v_slot_id, p_member_id, p_coach_id, p_slot_date, p_start_time, p_end_time,
    'completed', v_note, timezone('utc', now()), timezone('utc', now()), true,
    v_reason, coalesce(p_consume_token, true), p_actor_id, p_actor_id
  ) returning id into v_booking_id;

  if coalesce(p_close_open_request, false) then
    update public.private_coaching_session_requests r
    set status = 'cancelled',
        cancelled_at = timezone('utc', now()),
        cancelled_by = p_actor_id,
        updated_by = p_actor_id
    where r.member_id = p_member_id
      and r.coach_id = p_coach_id
      and r.status in ('pending', 'coach_proposed');
  end if;

  return v_booking_id;
end;
$$;

revoke all on function public.private_coaching_record_backdated_completed(
  uuid, uuid, date, time without time zone, time without time zone,
  text, text, boolean, boolean, uuid
) from public;

grant execute on function public.private_coaching_record_backdated_completed(
  uuid, uuid, date, time without time zone, time without time zone,
  text, text, boolean, boolean, uuid
) to service_role;

comment on column public.private_coaching_bookings.is_backdated_entry is
  'True when the booking was created retrospectively after the real session had already happened.';
comment on column public.private_coaching_bookings.backdated_reason is
  'Audit reason for a retrospectively recorded completed private session.';
comment on column public.private_coaching_bookings.token_consumed is
  'Whether this booking consumed a private coaching pass token. Backdated corrections may intentionally be recorded without consuming a token.';

commit;
