-- Staff Payroll 2E — QR Evidence Reconciliation
-- Lets Super Admin safely attach an unlinked or ambiguous staff QR scan to an
-- assigned dated session. The result becomes factual QR evidence for Payroll.
-- No punctuality label, absence inference, score or sanction is introduced.

begin;

create table if not exists public.staff_payroll_qr_reconciliations (
  id uuid primary key default gen_random_uuid(),
  attendance_id uuid not null
    references public.coach_staff_attendance(id) on delete restrict,
  month_start date not null,
  staff_user_id uuid not null
    references public.profiles(user_id) on delete restrict,
  training_session_id uuid not null
    references public.schedule_training_sessions(id) on delete restrict,
  assignment_role_snapshot text not null,
  previous_match_status text not null,
  previous_candidate_count smallint not null,
  session_date_snapshot date not null,
  session_name_snapshot text not null,
  session_start_time_snapshot time without time zone not null,
  session_end_time_snapshot time without time zone null,
  session_mat_snapshot text null,
  checked_in_at_snapshot timestamptz not null,
  arrival_delta_minutes integer not null,
  reason text not null,
  reconciled_at timestamptz not null default now(),
  reconciled_by uuid not null
    references public.profiles(user_id) on delete restrict,
  constraint staff_payroll_qr_reconciliation_month_chk
    check (month_start = date_trunc('month', month_start)::date),
  constraint staff_payroll_qr_reconciliation_role_chk
    check (assignment_role_snapshot in ('primary_coach','assistant_coach')),
  constraint staff_payroll_qr_reconciliation_previous_status_chk
    check (previous_match_status in ('unlinked','ambiguous')),
  constraint staff_payroll_qr_reconciliation_candidate_count_chk
    check (previous_candidate_count between 0 and 20),
  constraint staff_payroll_qr_reconciliation_reason_chk
    check (char_length(btrim(reason)) between 3 and 500)
);

create unique index if not exists staff_payroll_qr_reconciliation_attendance_uq
  on public.staff_payroll_qr_reconciliations(attendance_id);

create index if not exists staff_payroll_qr_reconciliation_month_idx
  on public.staff_payroll_qr_reconciliations(month_start, staff_user_id, reconciled_at desc);

create index if not exists staff_payroll_qr_reconciliation_session_idx
  on public.staff_payroll_qr_reconciliations(training_session_id, staff_user_id);

comment on table public.staff_payroll_qr_reconciliations is
  'Immutable audit trail for Staff Payroll manual reconciliation of unlinked or ambiguous staff QR attendance to an assigned dated session.';

alter table public.staff_payroll_qr_reconciliations enable row level security;

drop policy if exists staff_payroll_qr_reconciliations_select_admin
  on public.staff_payroll_qr_reconciliations;
create policy staff_payroll_qr_reconciliations_select_admin
on public.staff_payroll_qr_reconciliations
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.user_id = auth.uid()
      and p.role::text in ('admin','super_admin')
  )
);

create or replace function public.staff_payroll_qr_reconciliation_immutable()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  raise exception 'STAFF_PAYROLL_QR_RECONCILIATION_IMMUTABLE';
end;
$$;

drop trigger if exists staff_payroll_qr_reconciliation_immutable_trg
  on public.staff_payroll_qr_reconciliations;
create trigger staff_payroll_qr_reconciliation_immutable_trg
before update or delete on public.staff_payroll_qr_reconciliations
for each row execute function public.staff_payroll_qr_reconciliation_immutable();

create or replace function public.staff_payroll_reconcile_qr_attendance(
  p_attendance_id uuid,
  p_training_session_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_role text;
  v_attendance record;
  v_session record;
  v_assignment record;
  v_month_start date;
  v_snapshot_status text;
  v_existing_qr_id uuid;
  v_reconciliation_id uuid;
  v_delta_minutes integer;
begin
  if v_actor is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;

  select p.role::text into v_actor_role
  from public.profiles p
  where p.user_id = v_actor;

  if v_actor_role is distinct from 'super_admin' then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  if p_attendance_id is null or p_training_session_id is null then
    raise exception 'INVALID_QR_RECONCILIATION_TARGET';
  end if;

  if nullif(btrim(coalesce(p_reason, '')), '') is null
     or char_length(btrim(p_reason)) < 3
     or char_length(btrim(p_reason)) > 500 then
    raise exception 'QR_RECONCILIATION_REASON_REQUIRED';
  end if;

  select q.* into v_attendance
  from public.coach_staff_attendance q
  where q.id = p_attendance_id
  for update;

  if not found then
    raise exception 'QR_ATTENDANCE_NOT_FOUND';
  end if;

  if v_attendance.session_match_status not in ('unlinked','ambiguous')
     or v_attendance.training_session_id is not null then
    raise exception 'QR_ATTENDANCE_NOT_RECONCILABLE';
  end if;

  v_month_start := date_trunc('month', v_attendance.attendance_date)::date;

  select s.status into v_snapshot_status
  from public.staff_payroll_monthly_snapshots s
  where s.month_start = v_month_start;

  if v_snapshot_status = 'approved' then
    raise exception 'STAFF_PAYROLL_MONTH_LOCKED';
  end if;

  select s.* into v_session
  from public.schedule_training_sessions s
  where s.id = p_training_session_id
    and s.session_date = v_attendance.attendance_date
    and s.status <> 'cancelled'
  for share;

  if not found then
    raise exception 'SESSION_NOT_ELIGIBLE';
  end if;

  select a.* into v_assignment
  from public.schedule_session_coach_assignments a
  where a.training_session_id = p_training_session_id
    and a.staff_user_id = v_attendance.staff_user_id
    and a.is_active
  limit 1;

  if not found then
    raise exception 'ACTIVE_ASSIGNMENT_REQUIRED';
  end if;

  select q.id into v_existing_qr_id
  from public.coach_staff_attendance q
  where q.staff_user_id = v_attendance.staff_user_id
    and q.training_session_id = p_training_session_id
    and q.id <> p_attendance_id
  limit 1;

  if v_existing_qr_id is not null then
    raise exception 'SESSION_QR_EVIDENCE_ALREADY_EXISTS';
  end if;

  if exists (
    select 1
    from public.staff_payroll_coaching_import_items i
    where i.training_session_id = p_training_session_id
      and i.staff_user_id = v_attendance.staff_user_id
      and i.status = 'active'
  ) then
    raise exception 'COACHING_SESSION_ALREADY_IMPORTED';
  end if;

  v_delta_minutes := round(
    extract(
      epoch from (
        (v_attendance.checked_in_at at time zone 'Africa/Cairo')::time
        - v_session.start_time
      )
    ) / 60.0
  )::integer;

  insert into public.staff_payroll_qr_reconciliations (
    attendance_id,
    month_start,
    staff_user_id,
    training_session_id,
    assignment_role_snapshot,
    previous_match_status,
    previous_candidate_count,
    session_date_snapshot,
    session_name_snapshot,
    session_start_time_snapshot,
    session_end_time_snapshot,
    session_mat_snapshot,
    checked_in_at_snapshot,
    arrival_delta_minutes,
    reason,
    reconciled_by
  ) values (
    v_attendance.id,
    v_month_start,
    v_attendance.staff_user_id,
    v_session.id,
    v_assignment.assignment_role,
    v_attendance.session_match_status,
    v_attendance.session_match_candidate_count,
    v_session.session_date,
    v_session.name_snapshot,
    v_session.start_time,
    v_session.end_time,
    v_session.mat_snapshot,
    v_attendance.checked_in_at,
    v_delta_minutes,
    btrim(p_reason),
    v_actor
  )
  returning id into v_reconciliation_id;

  update public.coach_staff_attendance
  set training_session_id = v_session.id,
      session_match_status = 'matched',
      session_match_candidate_count = greatest(v_attendance.session_match_candidate_count, 1),
      assignment_role_snapshot = v_assignment.assignment_role,
      session_name_snapshot = v_session.name_snapshot,
      session_start_time_snapshot = v_session.start_time,
      session_end_time_snapshot = v_session.end_time,
      session_mat_snapshot = v_session.mat_snapshot,
      arrival_delta_minutes = v_delta_minutes
  where id = v_attendance.id;

  return jsonb_build_object(
    'ok', true,
    'reconciliation_id', v_reconciliation_id,
    'attendance_id', v_attendance.id,
    'training_session_id', v_session.id,
    'month_start', v_month_start,
    'arrival_delta_minutes', v_delta_minutes
  );
exception
  when unique_violation then
    raise exception 'QR_ATTENDANCE_ALREADY_RECONCILED';
end;
$$;

revoke all on function public.staff_payroll_reconcile_qr_attendance(uuid, uuid, text)
  from public;
grant execute on function public.staff_payroll_reconcile_qr_attendance(uuid, uuid, text)
  to authenticated;

grant select on public.staff_payroll_qr_reconciliations to authenticated;

commit;
