-- Same single functional lot: compatibility hardening for queued historical DB workflows.
-- Reapply fail-closed submitted coach / reviewer role checks independently of initial migration version.
CREATE OR REPLACE FUNCTION public.staff_payroll_submit_coaching_month_v1(
 p_month_start date,p_payroll_task_id uuid,p_declared_sessions integer,p_declared_hours numeric,p_note text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth AS $func$
DECLARE
 v_actor uuid:=auth.uid(); v_role text; v_staff uuid; v_id uuid;
BEGIN
 IF v_actor IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
 SELECT role::text INTO v_role FROM public.profiles WHERE user_id=v_actor;
 IF v_role IS NULL OR v_role NOT IN ('coach','assistant_coach','head_coach','super_admin') THEN
   RAISE EXCEPTION 'NOT_COACH'; END IF;
 IF p_month_start IS NULL OR p_month_start<>date_trunc('month',p_month_start)::date
 OR p_month_start > date_trunc('month',(now() at time zone 'Africa/Cairo'))::date
 OR p_month_start < date_trunc('month',(now() at time zone 'Africa/Cairo'))::date-interval '13 months'
 THEN RAISE EXCEPTION 'INVALID_MONTH'; END IF;
 IF p_declared_sessions IS NULL OR p_declared_sessions NOT BETWEEN 1 AND 250
 OR p_declared_hours IS NULL OR p_declared_hours<=0 OR p_declared_hours>500
 OR abs(p_declared_hours-round(p_declared_hours,2))>0
 OR char_length(coalesce(p_note,''))>1500 THEN RAISE EXCEPTION 'INVALID_DECLARATION'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.staff_tasks t WHERE t.id=p_payroll_task_id
 AND t.unit='class' AND t.is_active) THEN RAISE EXCEPTION 'INVALID_PAYROLL_TASK'; END IF;
 SELECT coalesce((SELECT l.staff_user_id FROM public.staff_payroll_account_links l
 WHERE l.linked_user_id=v_actor),v_actor) INTO v_staff;
 IF NOT EXISTS(SELECT 1 FROM public.staff_payroll_staff_profiles p WHERE p.staff_user_id=v_staff
 AND p.employment_status='active')
 THEN RAISE EXCEPTION 'NO_ACTIVE_PAYROLL_STAFF_PROFILE'; END IF;
 IF EXISTS(SELECT 1 FROM public.staff_payroll_monthly_snapshots s
 WHERE s.month_start=p_month_start AND s.status='approved')
 THEN RAISE EXCEPTION 'STAFF_PAYROLL_MONTH_LOCKED'; END IF;
 INSERT INTO public.staff_payroll_coaching_monthly_declarations
 (month_start,staff_user_id,submitted_by,payroll_task_id,declared_sessions,declared_hours,coach_note)
 VALUES(p_month_start,v_staff,v_actor,p_payroll_task_id,p_declared_sessions,p_declared_hours,coalesce(btrim(p_note),''))
 ON CONFLICT(month_start,staff_user_id,payroll_task_id) DO UPDATE
 SET declared_sessions=excluded.declared_sessions,declared_hours=excluded.declared_hours,
 coach_note=excluded.coach_note,submitted_by=excluded.submitted_by,
 status='submitted',review_note=NULL,reviewed_by=NULL,reviewed_at=NULL,
 monthly_task_log_id=NULL,updated_at=now()
 WHERE staff_payroll_coaching_monthly_declarations.status<>'approved'
 RETURNING id INTO v_id;
 IF v_id IS NULL THEN RAISE EXCEPTION 'APPROVED_DECLARATION_LOCKED'; END IF;
 INSERT INTO public.audit_logs(actor_user_id,target_user_id,action,action_details)
 VALUES(v_actor,v_staff,'payroll_coaching_month_submitted',
 jsonb_build_object('declaration_id',v_id,'month_start',p_month_start,
 'task_id',p_payroll_task_id,'declared_sessions',p_declared_sessions,'declared_hours',p_declared_hours));
 RETURN jsonb_build_object('ok',true,'declaration_id',v_id,'status','submitted');
END
$func$;

CREATE OR REPLACE FUNCTION public.staff_payroll_review_coaching_month_v1(
 p_declaration_id uuid,p_decision text,p_reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth AS $func$
DECLARE
 v_actor uuid:=auth.uid(); v_role text; v_row record; v_task record;
 v_log_id uuid; v_area_name text;
BEGIN
 IF v_actor IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
 SELECT role::text INTO v_role FROM public.profiles WHERE user_id=v_actor;
 IF v_role IS DISTINCT FROM 'super_admin' THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF p_decision IS NULL OR p_decision NOT IN ('approve','reject') OR char_length(btrim(coalesce(p_reason,'')))<10
 OR char_length(p_reason)>1500 THEN RAISE EXCEPTION 'REVIEW_REASON_REQUIRED'; END IF;
 SELECT * INTO v_row FROM public.staff_payroll_coaching_monthly_declarations
 WHERE id=p_declaration_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'DECLARATION_NOT_FOUND'; END IF;
 IF v_row.status<>'submitted' THEN RAISE EXCEPTION 'DECLARATION_ALREADY_REVIEWED'; END IF;
 IF EXISTS(SELECT 1 FROM public.staff_payroll_monthly_snapshots s
 WHERE s.month_start=v_row.month_start AND s.status='approved')
 THEN RAISE EXCEPTION 'STAFF_PAYROLL_MONTH_LOCKED'; END IF;
 IF p_decision='approve' THEN
   IF NOT EXISTS(SELECT 1 FROM public.staff_payroll_staff_profiles sp
   WHERE sp.staff_user_id=v_row.staff_user_id AND sp.employment_status='active'
   AND sp.primary_role <> 'assistant_coach')
   THEN RAISE EXCEPTION 'NOT_ELIGIBLE_PAID_STAFF'; END IF;
   IF EXISTS(SELECT 1 FROM public.staff_monthly_task_logs l
   WHERE l.month_start=v_row.month_start AND l.staff_user_id=v_row.staff_user_id
     AND l.task_id=v_row.payroll_task_id AND l.voided_at IS NULL)
   THEN RAISE EXCEPTION 'MONTHLY_TASK_CONFLICT'; END IF;
   SELECT * INTO v_task FROM public.staff_tasks WHERE id=v_row.payroll_task_id
   AND unit='class' AND is_active;
   IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_PAYROLL_TASK'; END IF;
   SELECT name INTO v_area_name FROM public.staff_task_areas WHERE id=v_task.area_id;
   INSERT INTO public.staff_monthly_task_logs
   (month_start,staff_user_id,task_id,area_id_snapshot,task_name_snapshot,
    area_name_snapshot,unit_snapshot,importance_level_snapshot,importance_multiplier_snapshot,
    work_quantity,actual_hours,note,source,created_by,updated_by)
   VALUES(v_row.month_start,v_row.staff_user_id,v_row.payroll_task_id,v_task.area_id,v_task.name,
    v_area_name,v_task.unit,v_task.importance_level,v_task.importance_multiplier,
    v_row.declared_sessions,v_row.declared_hours,
    'Approved monthly coaching declaration '||v_row.id::text||' · '||left(btrim(p_reason),200),
    'imported',v_actor,v_actor)
   RETURNING id INTO v_log_id;
 END IF;
 UPDATE public.staff_payroll_coaching_monthly_declarations
 SET status=CASE WHEN p_decision='approve' THEN 'approved' ELSE 'rejected' END,
 review_note=btrim(p_reason),reviewed_by=v_actor,reviewed_at=now(),updated_at=now(),
 monthly_task_log_id=v_log_id WHERE id=p_declaration_id;
 INSERT INTO public.audit_logs(actor_user_id,target_user_id,action,action_details)
 VALUES(v_actor,v_row.staff_user_id,'payroll_coaching_month_'||p_decision,
 jsonb_build_object('declaration_id',p_declaration_id,'month_start',v_row.month_start,
 'task_id',v_row.payroll_task_id,'sessions',v_row.declared_sessions,
 'hours',v_row.declared_hours,'monthly_task_log_id',v_log_id,'reason',p_reason));
 RETURN jsonb_build_object('ok',true,'status',CASE WHEN p_decision='approve' THEN 'approved' ELSE 'rejected' END,'monthly_task_log_id',v_log_id);
END
$func$;
