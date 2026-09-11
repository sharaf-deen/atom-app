-- Coach Operations hotfix — Guarded Permanent Delete
-- Keeps archive as the normal lifecycle action while allowing Super Admin to
-- permanently remove unused test data without damaging historical references.

begin;

create or replace function public.coach_delete_curriculum_item_if_unused(
  p_entity text,
  p_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
  v_exists boolean := false;
  v_count bigint := 0;
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

  if p_entity not in ('type', 'block', 'technique', 'situation') then
    return jsonb_build_object('ok', false, 'error', 'INVALID_ENTITY');
  end if;

  if p_entity = 'type' then
    select exists(select 1 from public.coach_curriculum_types where id = p_id) into v_exists;
    if not v_exists then
      return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
    end if;

    select count(*) into v_count
    from public.coach_curriculum_blocks
    where type_id = p_id;
    if v_count > 0 then
      return jsonb_build_object(
        'ok', false,
        'error', 'HAS_CHILD_BLOCKS',
        'count', v_count,
        'details', 'Delete the technical blocks under this type first.'
      );
    end if;

    begin
      delete from public.coach_curriculum_types where id = p_id;
      get diagnostics v_deleted = row_count;
    exception when foreign_key_violation then
      return jsonb_build_object('ok', false, 'error', 'IN_USE', 'details', 'This technical type is still referenced and cannot be deleted. Archive it instead.');
    end;

  elsif p_entity = 'block' then
    select exists(select 1 from public.coach_curriculum_blocks where id = p_id) into v_exists;
    if not v_exists then
      return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
    end if;

    select count(*) into v_count
    from public.coach_curriculum_techniques
    where block_id = p_id;
    if v_count > 0 then
      return jsonb_build_object(
        'ok', false,
        'error', 'HAS_CHILD_TECHNIQUES',
        'count', v_count,
        'details', 'Delete the techniques under this block first.'
      );
    end if;

    select count(*) into v_count
    from public.coach_training_program_items
    where block_id = p_id;
    if v_count > 0 then
      return jsonb_build_object(
        'ok', false,
        'error', 'USED_IN_TRAINING_PROGRAM',
        'count', v_count,
        'details', 'This block is already used in a training program. Archive it instead.'
      );
    end if;

    select count(*) into v_count
    from public.coach_training_session_log_items
    where block_id = p_id;
    if v_count > 0 then
      return jsonb_build_object(
        'ok', false,
        'error', 'USED_IN_SESSION_LOG',
        'count', v_count,
        'details', 'This block is already present in training-session history. Archive it instead.'
      );
    end if;

    begin
      delete from public.coach_curriculum_blocks where id = p_id;
      get diagnostics v_deleted = row_count;
    exception when foreign_key_violation then
      return jsonb_build_object('ok', false, 'error', 'IN_USE', 'details', 'This block is still referenced and cannot be deleted. Archive it instead.');
    end;

  elsif p_entity = 'technique' then
    select exists(select 1 from public.coach_curriculum_techniques where id = p_id) into v_exists;
    if not v_exists then
      return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
    end if;

    select count(*) into v_count
    from public.coach_curriculum_situations
    where technique_id = p_id;
    if v_count > 0 then
      return jsonb_build_object(
        'ok', false,
        'error', 'HAS_CHILD_SITUATIONS',
        'count', v_count,
        'details', 'Delete the situations under this technique first.'
      );
    end if;

    select count(*) into v_count
    from public.coach_training_program_items
    where technique_id = p_id;
    if v_count > 0 then
      return jsonb_build_object(
        'ok', false,
        'error', 'USED_IN_TRAINING_PROGRAM',
        'count', v_count,
        'details', 'This technique is already used in a training program. Archive it instead.'
      );
    end if;

    select count(*) into v_count
    from public.coach_training_session_log_items
    where technique_id = p_id;
    if v_count > 0 then
      return jsonb_build_object(
        'ok', false,
        'error', 'USED_IN_SESSION_LOG',
        'count', v_count,
        'details', 'This technique is already present in training-session history. Archive it instead.'
      );
    end if;

    begin
      delete from public.coach_curriculum_techniques where id = p_id;
      get diagnostics v_deleted = row_count;
    exception when foreign_key_violation then
      return jsonb_build_object('ok', false, 'error', 'IN_USE', 'details', 'This technique is still referenced and cannot be deleted. Archive it instead.');
    end;

  else
    select exists(select 1 from public.coach_curriculum_situations where id = p_id) into v_exists;
    if not v_exists then
      return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
    end if;

    select count(*) into v_count
    from public.coach_training_program_items
    where situation_id = p_id;
    if v_count > 0 then
      return jsonb_build_object(
        'ok', false,
        'error', 'USED_IN_TRAINING_PROGRAM',
        'count', v_count,
        'details', 'This situation is already used in a training program. Archive it instead.'
      );
    end if;

    select count(*) into v_count
    from public.coach_training_session_log_items
    where situation_id = p_id;
    if v_count > 0 then
      return jsonb_build_object(
        'ok', false,
        'error', 'USED_IN_SESSION_LOG',
        'count', v_count,
        'details', 'This situation is already present in training-session history. Archive it instead.'
      );
    end if;

    begin
      delete from public.coach_curriculum_situations where id = p_id;
      get diagnostics v_deleted = row_count;
    exception when foreign_key_violation then
      return jsonb_build_object('ok', false, 'error', 'IN_USE', 'details', 'This situation is still referenced and cannot be deleted. Archive it instead.');
    end;
  end if;

  if v_deleted <> 1 then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;

  return jsonb_build_object('ok', true, 'entity', p_entity, 'id', p_id);
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
  v_exists boolean := false;
  v_count bigint := 0;
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

  select exists(select 1 from public.coach_training_programs where id = p_program_id)
    into v_exists;
  if not v_exists then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;

  select count(*) into v_count
  from public.coach_training_session_logs
  where program_id = p_program_id;
  if v_count > 0 then
    return jsonb_build_object(
      'ok', false,
      'error', 'USED_IN_TRAINING_LOG',
      'count', v_count,
      'details', 'This program already has training-session history. Archive it instead.'
    );
  end if;

  -- Any assignment, including a removed/inactive historical assignment, means the
  -- program has been used operationally and must remain available for history.
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

  begin
    -- coach_training_program_items are intentionally removed by their existing
    -- ON DELETE CASCADE because they are planning children of the unused program.
    delete from public.coach_training_programs where id = p_program_id;
    get diagnostics v_deleted = row_count;
  exception when foreign_key_violation then
    return jsonb_build_object('ok', false, 'error', 'IN_USE', 'details', 'This program is still referenced and cannot be deleted. Archive it instead.');
  end;

  if v_deleted <> 1 then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;

  return jsonb_build_object('ok', true, 'id', p_program_id);
end;
$$;

revoke all on function public.coach_delete_curriculum_item_if_unused(text, uuid) from public;
revoke all on function public.coach_delete_training_program_if_unused(uuid) from public;
grant execute on function public.coach_delete_curriculum_item_if_unused(text, uuid) to authenticated;
grant execute on function public.coach_delete_training_program_if_unused(uuid) to authenticated;

comment on function public.coach_delete_curriculum_item_if_unused(text, uuid)
  is 'Super Admin only: permanently deletes an unused curriculum test item after dependency checks.';
comment on function public.coach_delete_training_program_if_unused(uuid)
  is 'Super Admin only: permanently deletes an unused training program after history and schedule-assignment checks.';

commit;
