-- Staff Payroll: one consolidated functional release.
-- Preserve historical assignments, manual overrides, and secondary-account identity.
-- No October financial writes; function definitions only.
CREATE OR REPLACE FUNCTION public.apply_mapped_training_program_to_session_internal(p_session_id uuid, p_program_id uuid, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_actor uuid := coalesce(p_actor, auth.uid());
  v_session_date date;
  v_session_status text;
  v_template_id uuid;
  v_program_title text;
  v_program_group text;
  v_program_start date;
  v_program_end date;
  v_program_status text;
  v_responsible uuid;
  v_current_assignment_id uuid;
  v_current_program_id uuid;
  v_has_non_program_staff boolean := false;
  v_team_inherited boolean := false;
begin
  select s.session_date, s.status, s.class_template_id
    into v_session_date, v_session_status, v_template_id
  from public.schedule_training_sessions s
  where s.id = p_session_id;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'SESSION_NOT_FOUND');
  end if;

  if v_session_status <> 'scheduled' then
    return jsonb_build_object('ok', true, 'changed', false, 'reason', 'SESSION_NOT_SCHEDULED');
  end if;

  select
    pr.title,
    pr.target_group,
    pr.start_date,
    pr.end_date,
    pr.status,
    pr.responsible_coach_user_id
    into
      v_program_title,
      v_program_group,
      v_program_start,
      v_program_end,
      v_program_status,
      v_responsible
  from public.coach_training_programs pr
  where pr.id = p_program_id;

  if not found or v_program_status <> 'published' then
    return jsonb_build_object('ok', true, 'changed', false, 'reason', 'PROGRAM_NOT_PUBLISHED');
  end if;

  if v_responsible is null then
    raise exception 'PROGRAM_RESPONSIBLE_COACH_REQUIRED';
  end if;

  if v_session_date < v_program_start or v_session_date > v_program_end then
    return jsonb_build_object('ok', true, 'changed', false, 'reason', 'SESSION_OUTSIDE_PROGRAM_PERIOD');
  end if;

  if not exists (
    select 1
    from public.coach_training_program_class_templates m
    where m.program_id = p_program_id
      and m.class_template_id = v_template_id
      and m.is_active
  ) then
    return jsonb_build_object('ok', true, 'changed', false, 'reason', 'TEMPLATE_NOT_MAPPED');
  end if;

  if exists (
    select 1
    from public.coach_training_session_logs l
    where l.training_session_id = p_session_id
  ) then
    return jsonb_build_object('ok', true, 'changed', false, 'reason', 'SESSION_HAS_TRAINING_LOG');
  end if;

  select a.id, a.program_id
    into v_current_assignment_id, v_current_program_id
  from public.schedule_session_training_program_assignments a
  where a.training_session_id = p_session_id
    and a.is_active
  limit 1;

  if v_current_assignment_id is not null and v_current_program_id <> p_program_id then
    return jsonb_build_object(
      'ok', true,
      'changed', false,
      'conflict', true,
      'reason', 'SESSION_ALREADY_HAS_OTHER_PROGRAM',
      'program_id', v_current_program_id
    );
  end if;

  if v_current_assignment_id is not null and v_current_program_id = p_program_id then
    update public.schedule_session_training_program_assignments
    set
      program_title_snapshot = v_program_title,
      target_group_snapshot = v_program_group,
      program_start_date_snapshot = v_program_start,
      program_end_date_snapshot = v_program_end,
      updated_at = now()
    where id = v_current_assignment_id;

    -- Only forward-looking, unmodified programme-owned/default assignments are refreshed.
    -- Never rewrite historical attendance, explicit session overrides, training logs, or payroll evidence.
    if v_session_date >= ((now() at time zone 'Africa/Cairo')::date)
       and not exists (
         select 1 from public.schedule_session_coach_assignments a
         where a.training_session_id = p_session_id and a.is_active
           and (a.assignment_source not in ('program','schedule_default')
                or (a.assignment_source = 'program' and a.source_program_id is distinct from p_program_id))
       )
       and not exists (
         select 1 from public.staff_payroll_coaching_import_items i
         where i.training_session_id = p_session_id and i.status = 'active'
       )
       and exists (
         select 1 from public.schedule_session_coach_assignments a
         where a.training_session_id = p_session_id and a.is_active
           and (
             a.assignment_source = 'schedule_default'
             or (a.assignment_role = 'primary_coach' and a.staff_user_id is distinct from v_responsible)
             or (a.assignment_role = 'assistant_coach' and not exists (
               select 1 from public.coach_training_programs pr
               where pr.id = p_program_id
                 and a.staff_user_id in (pr.assistant_coach_1_user_id,pr.assistant_coach_2_user_id)
             ))
           )
       )
    then
      perform public.apply_training_program_team_to_session(p_session_id,p_program_id,v_actor);
      return jsonb_build_object('ok',true,'changed',true,'program_id',p_program_id,'reason','TEAM_RESYNCED');
    end if;

    return jsonb_build_object(
      'ok', true,
      'changed', false,
      'program_id', p_program_id,
      'reason', 'ALREADY_LINKED'
    );
  end if;

  insert into public.schedule_session_training_program_assignments (
    training_session_id,
    program_id,
    program_title_snapshot,
    target_group_snapshot,
    program_start_date_snapshot,
    program_end_date_snapshot,
    assigned_by
  ) values (
    p_session_id,
    p_program_id,
    v_program_title,
    v_program_group,
    v_program_start,
    v_program_end,
    v_actor
  );

  select exists (
    select 1
    from public.schedule_session_coach_assignments a
    where a.training_session_id = p_session_id
      and a.is_active
      and a.assignment_source not in ('program','schedule_default')
  ) into v_has_non_program_staff;

  if not v_has_non_program_staff and v_session_date >= ((now() at time zone 'Africa/Cairo')::date)
     and not exists (
       select 1 from public.staff_payroll_coaching_import_items i
       where i.training_session_id = p_session_id and i.status='active'
     ) then
    perform public.apply_training_program_team_to_session(p_session_id, p_program_id, v_actor);
    v_team_inherited := true;
  end if;

  return jsonb_build_object(
    'ok', true,
    'changed', true,
    'program_id', p_program_id,
    'team_inherited', v_team_inherited,
    'manual_staff_preserved', v_has_non_program_staff
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.staff_payroll_import_coaching_sessions(p_month_start date, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_actor uuid := auth.uid();
  v_actor_role text;
  v_snapshot_status text;
  v_item jsonb;
  v_session_id uuid;
  v_staff_user_id uuid;
  v_payroll_staff_user_id uuid;
  v_duration numeric(6,2);
  v_session record;
  v_assignment record;
  v_mapping record;
  v_task record;
  v_area_name text;
  v_staff_name text;
  v_qr_id uuid;
  v_training_log_id uuid;
  v_confirmation_id uuid;
  v_evidence text;
  v_derived_duration numeric(6,2);
  v_duration_source text;
  v_log record;
  v_import_id uuid;
  v_imported integer := 0;
  v_log_ids uuid[] := '{}'::uuid[];
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

  if p_month_start is null or p_month_start <> date_trunc('month', p_month_start)::date then
    raise exception 'INVALID_MONTH';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'NO_IMPORT_ITEMS';
  end if;

  select s.status into v_snapshot_status
  from public.staff_payroll_monthly_snapshots s
  where s.month_start = p_month_start;

  if v_snapshot_status = 'approved' then
    raise exception 'STAFF_PAYROLL_MONTH_LOCKED';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    begin
      v_session_id := nullif(v_item->>'session_id', '')::uuid;
      v_staff_user_id := nullif(v_item->>'staff_user_id', '')::uuid;
      v_duration := round((v_item->>'duration_hours')::numeric, 2);
    exception when others then
      raise exception 'INVALID_IMPORT_ITEM';
    end;

    if v_session_id is null or v_staff_user_id is null or v_duration is null
       or v_duration <= 0 or v_duration > 12 then
      raise exception 'INVALID_IMPORT_ITEM';
    end if;

    select s.* into v_session
    from public.schedule_training_sessions s
    where s.id = v_session_id
      and s.session_date >= p_month_start
      and s.session_date < (p_month_start + interval '1 month')::date
      and s.status <> 'cancelled'
    for share;

    if not found then
      raise exception 'SESSION_NOT_ELIGIBLE';
    end if;

    select a.* into v_assignment
    from public.schedule_session_coach_assignments a
    where a.training_session_id = v_session_id
      and a.staff_user_id = v_staff_user_id
      and a.is_active
    limit 1;

    if not found then
      raise exception 'ACTIVE_ASSIGNMENT_REQUIRED';
    end if;

    select m.*, t.id as task_exists into v_mapping
    from public.staff_payroll_coaching_template_mappings m
    join public.staff_tasks t on t.id = m.payroll_task_id
    where m.class_template_id = v_session.class_template_id
      and m.is_active
      and t.is_active
      and t.unit = 'class'
    limit 1;

    if not found then
      raise exception 'PAYROLL_MAPPING_REQUIRED';
    end if;

    select t.id, t.area_id, t.name, t.unit, t.importance_level, t.importance_multiplier
      into v_task
    from public.staff_tasks t
    where t.id = v_mapping.payroll_task_id
      and t.is_active
      and t.unit = 'class';

    if not found then
      raise exception 'PAYROLL_TASK_NOT_ELIGIBLE';
    end if;

    select a.name into v_area_name
    from public.staff_task_areas a
    where a.id = v_task.area_id;

    if v_area_name is null then
      raise exception 'PAYROLL_TASK_AREA_NOT_FOUND';
    end if;

    select coalesce(
      nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
      nullif(btrim(p.email), ''),
      left(p.user_id::text, 8)
    ) into v_staff_name
    from public.profiles p
    where p.user_id = v_staff_user_id;

    if v_staff_name is null then
      v_staff_name := v_assignment.staff_name_snapshot;
    end if;

    select q.id into v_qr_id
    from public.coach_staff_attendance q
    where q.training_session_id = v_session_id
      and q.staff_user_id = v_staff_user_id
      and q.session_match_status = 'matched'
    order by q.checked_in_at asc
    limit 1;

    select l.id into v_training_log_id
    from public.coach_training_session_logs l
    where l.training_session_id = v_session_id
      and l.coach_user_id = v_staff_user_id
      and l.status = 'completed'
    order by l.completed_at asc nulls last, l.created_at asc
    limit 1;

    select c.id into v_confirmation_id
    from public.staff_payroll_coaching_confirmations c
    where c.training_session_id = v_session_id
      and c.staff_user_id = v_staff_user_id
      and c.month_start = p_month_start
      and c.revoked_at is null
    order by c.confirmed_at desc
    limit 1;

    if v_qr_id is not null and v_training_log_id is not null then
      v_evidence := 'qr_and_completed_log';
      v_confirmation_id := null;
    elsif v_qr_id is not null then
      v_evidence := 'qr';
      v_training_log_id := null;
      v_confirmation_id := null;
    elsif v_training_log_id is not null then
      v_evidence := 'completed_log';
      v_qr_id := null;
      v_confirmation_id := null;
    elsif v_confirmation_id is not null then
      v_evidence := 'manual_confirmation';
      v_qr_id := null;
      v_training_log_id := null;
    else
      raise exception 'COACHING_EVIDENCE_REQUIRED';
    end if;

    if exists (
      select 1 from public.staff_payroll_coaching_import_items i
      where i.training_session_id = v_session_id
        and i.staff_user_id = v_staff_user_id
        and i.status = 'active'
    ) then
      raise exception 'COACHING_SESSION_ALREADY_IMPORTED';
    end if;

    if v_session.end_time is not null then
      v_derived_duration := round((extract(epoch from (v_session.end_time - v_session.start_time)) / 3600.0)::numeric, 2);
      v_duration_source := 'session_end';
    elsif v_mapping.default_duration_hours is not null then
      v_derived_duration := round(v_mapping.default_duration_hours::numeric, 2);
      v_duration_source := 'mapping_default';
    else
      v_derived_duration := null;
      v_duration_source := 'override';
    end if;

    if v_derived_duration is null or abs(v_duration - v_derived_duration) > 0.01 then
      v_duration_source := 'override';
    end if;

    -- The session retains its actual teaching coach. Monthly payroll uses the
    -- canonical staff account, never the secondary account used for attendance.
    select coalesce(
      (select link.staff_user_id from public.staff_payroll_account_links link
       where link.linked_user_id = v_staff_user_id),v_staff_user_id
    ) into v_payroll_staff_user_id;

    select l.* into v_log
    from public.staff_monthly_task_logs l
    where l.month_start = p_month_start
      and l.staff_user_id = v_payroll_staff_user_id
      and l.task_id = v_task.id
      and l.voided_at is null
    for update;

    if found and v_log.source <> 'schedule' then
      raise exception 'MANUAL_MONTHLY_TASK_CONFLICT';
    end if;

    if not found then
      insert into public.staff_monthly_task_logs (
        month_start,
        staff_user_id,
        task_id,
        area_id_snapshot,
        task_name_snapshot,
        area_name_snapshot,
        unit_snapshot,
        importance_level_snapshot,
        importance_multiplier_snapshot,
        work_quantity,
        actual_hours,
        note,
        source,
        created_by,
        updated_by
      ) values (
        p_month_start,
        v_payroll_staff_user_id,
        v_task.id,
        v_task.area_id,
        v_task.name,
        v_area_name,
        v_task.unit,
        v_task.importance_level,
        v_task.importance_multiplier,
        1,
        v_duration,
        'Generated from confirmed Structured Schedule coaching sessions.',
        'schedule',
        v_actor,
        v_actor
      )
      returning * into v_log;
    end if;

    insert into public.staff_payroll_coaching_import_items (
      month_start,
      training_session_id,
      class_template_id,
      staff_user_id,
      payroll_task_id,
      monthly_task_log_id,
      session_date_snapshot,
      session_name_snapshot,
      session_start_time_snapshot,
      session_end_time_snapshot,
      staff_name_snapshot,
      assignment_role_snapshot,
      task_name_snapshot,
      evidence_type,
      qr_attendance_id,
      training_log_id,
      manual_confirmation_id,
      duration_hours,
      duration_source,
      imported_by
    ) values (
      p_month_start,
      v_session_id,
      v_session.class_template_id,
      v_staff_user_id,
      v_task.id,
      v_log.id,
      v_session.session_date,
      v_session.name_snapshot,
      v_session.start_time,
      v_session.end_time,
      v_staff_name,
      v_assignment.assignment_role,
      v_task.name,
      v_evidence,
      v_qr_id,
      v_training_log_id,
      v_confirmation_id,
      v_duration,
      v_duration_source,
      v_actor
    )
    returning id into v_import_id;

    update public.staff_monthly_task_logs l
    set work_quantity = x.qty,
        actual_hours = x.hours,
        note = 'Schedule import · ' || x.qty::text || ' confirmed coaching session' || case when x.qty = 1 then '' else 's' end || '.',
        source = 'schedule',
        updated_by = v_actor
    from (
      select count(*)::numeric as qty, round(sum(i.duration_hours), 2) as hours
      from public.staff_payroll_coaching_import_items i
      where i.monthly_task_log_id = v_log.id
        and i.status = 'active'
    ) x
    where l.id = v_log.id;

    v_imported := v_imported + 1;
    if not (v_log.id = any(v_log_ids)) then
      v_log_ids := array_append(v_log_ids, v_log.id);
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'imported_count', v_imported,
    'monthly_task_log_ids', to_jsonb(v_log_ids)
  );
end;
$function$
;
