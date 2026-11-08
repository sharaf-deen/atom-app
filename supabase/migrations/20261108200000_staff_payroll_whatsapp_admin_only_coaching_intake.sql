-- Staff Payroll · Super Admin-only WhatsApp monthly coaching intake.
-- Coaches send their actual class totals outside ATOM; Super Admin records and reviews.
-- Existing declarations are preserved. No automatic monthly task or salary is created.
CREATE OR REPLACE FUNCTION public.staff_payroll_admin_record_coaching_month_v1(
 p_staff_user_id uuid,p_month_start date,p_payroll_task_id uuid,
 p_declared_sessions integer,p_declared_hours numeric,p_note text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth AS $func$
DECLARE
 v_actor uuid:=auth.uid();v_role text;v_declaration_id uuid;
BEGIN
 IF v_actor IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
 SELECT role::text INTO v_role FROM public.profiles WHERE user_id=v_actor;
 IF v_role IS DISTINCT FROM 'super_admin' THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF p_staff_user_id IS NULL
 OR NOT EXISTS(SELECT 1 FROM public.staff_payroll_staff_profiles sp
               WHERE sp.staff_user_id=p_staff_user_id AND sp.employment_status='active')
 OR EXISTS(SELECT 1 FROM public.staff_payroll_account_links links
           WHERE links.linked_user_id=p_staff_user_id)
 THEN RAISE EXCEPTION 'INVALID_CANONICAL_STAFF'; END IF;
 IF p_month_start IS NULL OR p_month_start<>date_trunc('month',p_month_start)::date
 OR p_month_start>date_trunc('month',(now() at time zone 'Africa/Cairo'))::date
 OR p_month_start<(date_trunc('month',(now() at time zone 'Africa/Cairo'))::date-interval '13 months')::date
 THEN RAISE EXCEPTION 'INVALID_MONTH'; END IF;
 IF p_declared_sessions IS NULL OR p_declared_sessions NOT BETWEEN 1 AND 250
 OR p_declared_hours IS NULL OR p_declared_hours<=0 OR p_declared_hours>500
 OR p_declared_hours<>round(p_declared_hours,2)
 OR char_length(coalesce(p_note,''))>1500
 THEN RAISE EXCEPTION 'INVALID_DECLARATION'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.staff_tasks WHERE id=p_payroll_task_id
               AND unit='class' AND is_active)
 THEN RAISE EXCEPTION 'INVALID_PAYROLL_TASK'; END IF;
 IF EXISTS(SELECT 1 FROM public.staff_payroll_monthly_snapshots
           WHERE month_start=p_month_start AND status='approved')
 THEN RAISE EXCEPTION 'STAFF_PAYROLL_MONTH_LOCKED'; END IF;
 -- Never overwrite an already approved declaration or its associated task.
 INSERT INTO public.staff_payroll_coaching_monthly_declarations
 (month_start,staff_user_id,submitted_by,payroll_task_id,declared_sessions,declared_hours,coach_note)
 VALUES(p_month_start,p_staff_user_id,v_actor,p_payroll_task_id,
        p_declared_sessions,p_declared_hours,coalesce(btrim(p_note),''))
 ON CONFLICT(month_start,staff_user_id,payroll_task_id) DO UPDATE
 SET declared_sessions=excluded.declared_sessions,declared_hours=excluded.declared_hours,
 coach_note=excluded.coach_note,submitted_by=excluded.submitted_by,status='submitted',
 review_note=NULL,reviewed_by=NULL,reviewed_at=NULL,monthly_task_log_id=NULL,updated_at=now()
 WHERE staff_payroll_coaching_monthly_declarations.status<>'approved'
 RETURNING id INTO v_declaration_id;
 IF v_declaration_id IS NULL THEN RAISE EXCEPTION 'APPROVED_DECLARATION_LOCKED'; END IF;
 INSERT INTO public.audit_logs(actor_user_id,target_user_id,action,action_details)
 VALUES(v_actor,p_staff_user_id,'payroll_coaching_whatsapp_admin_recorded',
 jsonb_build_object('declaration_id',v_declaration_id,'month_start',p_month_start,
 'task_id',p_payroll_task_id,'declared_sessions',p_declared_sessions,
 'declared_hours',p_declared_hours,'intake_source','whatsapp_message',
 'note',left(coalesce(p_note,''),250)));
 RETURN jsonb_build_object('ok',true,'declaration_id',v_declaration_id,'status','submitted');
END
$func$;

-- Remove the original coach self-service entry point (the business owner enters all figures).
REVOKE ALL ON FUNCTION public.staff_payroll_submit_coaching_month_v1(date,uuid,integer,numeric,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.staff_payroll_admin_record_coaching_month_v1(uuid,date,uuid,integer,numeric,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.staff_payroll_admin_record_coaching_month_v1(uuid,date,uuid,integer,numeric,text) TO authenticated;

COMMENT ON FUNCTION public.staff_payroll_admin_record_coaching_month_v1(uuid,date,uuid,integer,numeric,text)
 IS 'Super Admin-only transcription of coaching totals received by WhatsApp; does not approve any payroll task.';
