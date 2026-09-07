-- Structured Schedule Lot 2E — Staff QR → Scheduled Session Linking
-- Links factual coaching-staff QR attendance to the dated session the staff member is assigned to.
-- Member attendance remains untouched. No punctuality label, score, sanction, or absence inference is introduced.

begin;

alter table public.coach_staff_attendance
  add column if not exists training_session_id uuid null,
  add column if not exists session_match_status text not null default 'unlinked',
  add column if not exists session_match_candidate_count smallint not null default 0,
  add column if not exists assignment_role_snapshot text null,
  add column if not exists session_name_snapshot text null,
  add column if not exists session_start_time_snapshot time without time zone null,
  add column if not exists session_end_time_snapshot time without time zone null,
  add column if not exists session_mat_snapshot text null,
  add column if not exists arrival_delta_minutes integer null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'coach_staff_attendance_training_session_fk'
      and conrelid = 'public.coach_staff_attendance'::regclass
  ) then
    alter table public.coach_staff_attendance
      add constraint coach_staff_attendance_training_session_fk
      foreign key (training_session_id)
      references public.schedule_training_sessions(id)
      on delete restrict;
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'coach_staff_attendance_session_match_status_check'
      and conrelid = 'public.coach_staff_attendance'::regclass
  ) then
    alter table public.coach_staff_attendance
      add constraint coach_staff_attendance_session_match_status_check
      check (session_match_status in ('matched','unlinked','ambiguous'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'coach_staff_attendance_session_candidate_count_check'
      and conrelid = 'public.coach_staff_attendance'::regclass
  ) then
    alter table public.coach_staff_attendance
      add constraint coach_staff_attendance_session_candidate_count_check
      check (session_match_candidate_count between 0 and 20);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'coach_staff_attendance_assignment_role_snapshot_check'
      and conrelid = 'public.coach_staff_attendance'::regclass
  ) then
    alter table public.coach_staff_attendance
      add constraint coach_staff_attendance_assignment_role_snapshot_check
      check (assignment_role_snapshot is null or assignment_role_snapshot in ('primary_coach','assistant_coach'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'coach_staff_attendance_session_link_consistency_check'
      and conrelid = 'public.coach_staff_attendance'::regclass
  ) then
    alter table public.coach_staff_attendance
      add constraint coach_staff_attendance_session_link_consistency_check
      check (
        (
          session_match_status = 'matched'
          and training_session_id is not null
          and assignment_role_snapshot is not null
          and session_name_snapshot is not null
          and session_start_time_snapshot is not null
          and arrival_delta_minutes is not null
          and session_match_candidate_count >= 1
        )
        or
        (
          session_match_status in ('unlinked','ambiguous')
          and training_session_id is null
          and assignment_role_snapshot is null
          and session_name_snapshot is null
          and session_start_time_snapshot is null
          and session_end_time_snapshot is null
          and session_mat_snapshot is null
          and arrival_delta_minutes is null
        )
      );
  end if;
end
$$;

create unique index if not exists coach_staff_attendance_staff_session_uq
  on public.coach_staff_attendance (staff_user_id, training_session_id)
  where training_session_id is not null;

create index if not exists coach_staff_attendance_training_session_idx
  on public.coach_staff_attendance (training_session_id, checked_in_at desc)
  where training_session_id is not null;

create index if not exists coach_staff_attendance_match_status_date_idx
  on public.coach_staff_attendance (session_match_status, attendance_date desc, checked_in_at desc);

comment on column public.coach_staff_attendance.training_session_id is
  'Structured Schedule dated session matched to this staff QR check-in. Null when no safe automatic match was made.';

comment on column public.coach_staff_attendance.session_match_status is
  'Factual QR/session correlation state: matched, unlinked, or ambiguous. This is not a punctuality judgment.';

comment on column public.coach_staff_attendance.arrival_delta_minutes is
  'Signed local-clock difference in minutes: QR check-in time minus the scheduled session start. Negative means before start, positive means after start. No late/on-time label is inferred.';

comment on column public.coach_staff_attendance.session_match_candidate_count is
  'Number of assigned scheduled sessions inside the automatic matching window at scan time.';

commit;
