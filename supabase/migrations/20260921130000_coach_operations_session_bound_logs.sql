-- Coach Operations Lot 1G — session-bound Training Logs and safe test cleanup.
-- Existing manual logs remain readable history. New logs must reference a dated session.

begin;

create or replace function public.enforce_coach_training_log_session_link()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' and new.training_session_id is null then
    raise exception 'SESSION_LINK_REQUIRED'
      using errcode = '23514',
            detail = 'Every new Training Log must be linked to a dated scheduled session.';
  end if;

  if tg_op = 'UPDATE' then
    if old.training_session_id is null then
      raise exception 'LEGACY_LOG_READ_ONLY'
        using errcode = '23514',
              detail = 'Manual legacy Training Logs are preserved as read-only history.';
    end if;

    if new.training_session_id is null then
      raise exception 'SESSION_LINK_REQUIRED'
        using errcode = '23514',
              detail = 'A dated-session link cannot be removed from a Training Log.';
    end if;

    if new.training_session_id is distinct from old.training_session_id then
      raise exception 'SESSION_LINK_IMMUTABLE'
        using errcode = '23514',
              detail = 'A Training Log cannot be moved to another dated session.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists coach_training_session_logs_session_link_guard
  on public.coach_training_session_logs;
create trigger coach_training_session_logs_session_link_guard
before insert or update
on public.coach_training_session_logs
for each row
execute function public.enforce_coach_training_log_session_link();

create or replace function public.coach_training_program_delete_impact(
  p_program_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
  v_exists boolean := false;
  v_total_logs bigint := 0;
  v_manual_draft_logs bigint := 0;
  v_completed_logs bigint := 0;
  v_linked_logs bigint := 0;
  v_session_assignments bigint := 0;
  v_incident_links bigint := 0;
  v_payroll_links bigint := 0;
  v_deletable boolean := false;
begin
  select p.role::text
    into v_role
  from public.profiles p
  where p.user_id = auth.uid();

  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHENTICATED');
  end if;

  if coalesce(v_role, '') <> 'super_admin' then
    return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;

  select exists(select 1 from public.coach_training_programs where id = p_program_id)
    into v_exists;
  if not v_exists then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;

  select
    count(*),
    count(*) filter (where status = 'draft' and training_session_id is null),
    count(*) filter (where status = 'completed'),
    count(*) filter (where training_session_id is not null)
  into v_total_logs, v_manual_draft_logs, v_completed_logs, v_linked_logs
  from public.coach_training_session_logs
  where program_id = p_program_id;

  select count(*) into v_session_assignments
  from public.schedule_session_training_program_assignments
  where program_id = p_program_id;

  select count(*) into v_incident_links
  from public.coach_member_incidents i
  where i.training_log_id in (
    select l.id from public.coach_training_session_logs l where l.program_id = p_program_id
  );

  select count(*) into v_payroll_links
  from public.staff_payroll_coaching_import_items p
  where p.training_log_id in (
    select l.id from public.coach_training_session_logs l where l.program_id = p_program_id
  );

  v_deletable :=
    v_completed_logs = 0
    and v_linked_logs = 0
    and v_session_assignments = 0
    and v_incident_links = 0
    and v_payroll_links = 0
    and v_total_logs = v_manual_draft_logs;

  return jsonb_build_object(
    'ok', true,
    'program_id', p_program_id,
    'deletable', v_deletable,
    'total_logs', v_total_logs,
    'manual_draft_logs', v_manual_draft_logs,
    'completed_logs', v_completed_logs,
    'linked_logs', v_linked_logs,
    'session_assignments', v_session_assignments,
    'incident_links', v_incident_links,
    'payroll_links', v_payroll_links
  );
end;
$$;

create or replace function public.coach_delete_training_program_if_unused(
  p_program_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
  v_total_logs bigint := 0;
  v_manual_draft_logs bigint := 0;
  v_completed_logs bigint := 0;
  v_linked_logs bigint := 0;
  v_count bigint := 0;
  v_deleted_drafts integer := 0;
  v_deleted integer := 0;
begin
  select p.role::text
    into v_role
  from public.profiles p
  where p.user_id = auth.uid();

  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHENTICATED');
  end if;

  if coalesce(v_role, '') <> 'super_admin' then
    return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;

  perform 1
  from public.coach_training_programs
  where id = p_program_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;

  select
    count(*),
    count(*) filter (where status = 'draft' and training_session_id is null),
    count(*) filter (where status = 'completed'),
    count(*) filter (where training_session_id is not null)
  into v_total_logs, v_manual_draft_logs, v_completed_logs, v_linked_logs
  from public.coach_training_session_logs
  where program_id = p_program_id;

  if v_completed_logs > 0 or v_linked_logs > 0 or v_total_logs <> v_manual_draft_logs then
    return jsonb_build_object(
      'ok', false,
      'error', 'USED_IN_REAL_TRAINING_HISTORY',
      'count', greatest(v_completed_logs, v_linked_logs),
      'details', 'This program has a completed or dated-session Training Log. Archive it instead.'
    );
  end if;

  select count(*) into v_count
  from public.schedule_session_training_program_assignments
  where program_id = p_program_id;
  if v_count > 0 then
    return jsonb_build_object(
      'ok', false,
      'error', 'ASSIGNED_TO_SCHEDULE_SESSION',
      'count', v_count,
      'details', 'This program has already been assigned to a scheduled session. Archive it instead.'
    );
  end if;

  select count(*) into v_count
  from public.coach_member_incidents i
  where i.training_log_id in (
    select l.id from public.coach_training_session_logs l where l.program_id = p_program_id
  );
  if v_count > 0 then
    return jsonb_build_object(
      'ok', false,
      'error', 'TRAINING_LOG_HAS_INCIDENTS',
      'count', v_count,
      'details', 'A Training Log from this program is linked to a member incident. Archive the program instead.'
    );
  end if;

  select count(*) into v_count
  from public.staff_payroll_coaching_import_items p
  where p.training_log_id in (
    select l.id from public.coach_training_session_logs l where l.program_id = p_program_id
  );
  if v_count > 0 then
    return jsonb_build_object(
      'ok', false,
      'error', 'TRAINING_LOG_USED_IN_PAYROLL',
      'count', v_count,
      'details', 'A Training Log from this program is used as payroll evidence. Archive the program instead.'
    );
  end if;

  begin
    delete from public.coach_training_session_logs
    where program_id = p_program_id
      and status = 'draft'
      and training_session_id is null;
    get diagnostics v_deleted_drafts = row_count;

    delete from public.coach_training_programs where id = p_program_id;
    get diagnostics v_deleted = row_count;
  exception when foreign_key_violation then
    return jsonb_build_object(
      'ok', false,
      'error', 'IN_USE',
      'details', 'This program is still referenced and cannot be deleted. Archive it instead.'
    );
  end;

  if v_deleted <> 1 then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;

  return jsonb_build_object(
    'ok', true,
    'id', p_program_id,
    'deleted_manual_draft_logs', v_deleted_drafts
  );
end;
$$;

revoke all on function public.coach_training_program_delete_impact(uuid) from public;
revoke all on function public.coach_delete_training_program_if_unused(uuid) from public;
grant execute on function public.coach_training_program_delete_impact(uuid) to authenticated;
grant execute on function public.coach_delete_training_program_if_unused(uuid) to authenticated;

comment on function public.coach_training_program_delete_impact(uuid)
  is 'Super Admin only: previews real-history blockers and removable manual draft logs before deleting a test program.';
comment on function public.coach_delete_training_program_if_unused(uuid)
  is 'Super Admin only: deletes an unused program and its unlinked draft test logs while preserving every real session record.';

commit;
