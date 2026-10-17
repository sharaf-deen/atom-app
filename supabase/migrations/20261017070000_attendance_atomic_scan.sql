-- Functional 1C.4B: atomic member scan. Staff-session scans remain in existing API path.
-- No historical attendance rows are altered by this migration.
BEGIN;

CREATE OR REPLACE FUNCTION public.atom_atomic_member_scan(
  p_member_id uuid,
  p_actor_id uuid,
  p_device_tag text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Africa/Cairo')::date;
  v_role text;
  v_att public.attendance%ROWTYPE;
  v_sub public.subscriptions%ROWTYPE;
  v_expire date;
  v_remaining integer;
  v_frozen boolean;
  v_valid boolean := false;
  v_status text := 'expired';
  v_msg text := 'No active subscription';
  v_from_sessions boolean := false;
  v_sub_id uuid := null;
  v_details jsonb := '{}'::jsonb;
BEGIN
  -- Service role only. Do not allow direct member or client-side invocation.
  SELECT role INTO v_role FROM public.profiles WHERE user_id = p_member_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'SCAN_MEMBER_NOT_FOUND'; END IF;

  -- The pg advisory xact lock covers lookup, session deduction and attendance write.
  -- Use a single member lock to serialize even across day boundaries.
  PERFORM pg_advisory_xact_lock(hashtextextended('atom-member-scan:' || p_member_id::text, 0));

  -- Check EVERY row: a later invalid scan may coexist with an earlier valid scan.
  SELECT * INTO v_att
    FROM public.attendance
   WHERE member_id = p_member_id AND date = v_today AND valid IS TRUE
   ORDER BY scanned_at ASC, id ASC
   LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'valid', true,
      'member_id', p_member_id, 'subscription_id', v_att.subscription_id,
      'message', 'Already checked in today');
  END IF;

  -- Match existing lifetime access roles (excluding coach roles handled separately in API).
  IF v_role IN ('vip', 'champion') THEN
    v_valid := true;
    v_status := 'ok';
    v_msg := 'Always active access';
  ELSE
    -- Choose a usable unfrozen time plan before considering a frozen one.
    SELECT * INTO v_sub FROM public.subscriptions
     WHERE member_id = p_member_id AND subscription_type = 'time' AND status = 'active'
       AND start_date <= v_today AND end_date >= v_today
     ORDER BY CASE WHEN frozen_until IS NOT NULL
                        AND v_today < frozen_until
                        AND (frozen_from IS NULL OR v_today >= frozen_from)
                   THEN 1 ELSE 0 END,
              end_date DESC, id
     LIMIT 1 FOR UPDATE;

    IF FOUND THEN
      v_sub_id := v_sub.id;
      v_frozen := v_sub.frozen_until IS NOT NULL AND v_today < v_sub.frozen_until
        AND (v_sub.frozen_from IS NULL OR v_today >= v_sub.frozen_from);
      IF v_frozen THEN
        v_status := 'frozen';
        v_msg := 'Subscription is frozen';
        v_details := jsonb_build_object('frozen', true, 'frozen_until', v_sub.frozen_until,
           'freeze_days_remaining', greatest(0, v_sub.frozen_until - v_today));
      ELSE
        v_valid := true;
        v_status := 'ok';
        v_msg := 'Active subscription';
        v_details := jsonb_build_object('days_remaining', greatest(0, v_sub.end_date - v_today),
                                       'expires_on', v_sub.end_date);
      END IF;
    ELSE
      SELECT * INTO v_sub FROM public.subscriptions
       WHERE member_id = p_member_id AND subscription_type = 'sessions' AND status = 'active'
       ORDER BY paid_at DESC NULLS LAST, id
       LIMIT 1 FOR UPDATE;

      IF FOUND THEN
        v_sub_id := v_sub.id;
        v_from_sessions := true;
        v_remaining := greatest(coalesce(v_sub.sessions_total, 0) - coalesce(v_sub.sessions_used, 0), 0);
        IF v_remaining > 0 THEN
          UPDATE public.subscriptions SET sessions_used = coalesce(sessions_used, 0) + 1
           WHERE id = v_sub.id;
          v_valid := true;
          v_status := 'ok';
          v_msg := 'Sessions remaining: ' || (v_remaining - 1)::text;
        ELSE
          v_status := 'expired';
          v_msg := 'No sessions left';
          v_details := jsonb_build_object('expired_days', 0, 'expired_on', v_today);
        END IF;
      ELSE
        SELECT end_date INTO v_expire FROM public.subscriptions
         WHERE member_id = p_member_id ORDER BY end_date DESC NULLS LAST, id LIMIT 1;
        v_expire := coalesce(v_expire, v_today);
        v_details := jsonb_build_object('expired_days', greatest(0, v_today - v_expire),
                                       'expired_on', v_expire);
      END IF;
    END IF;
  END IF;

  -- Preserve past invalid attempt attribution in its row only when converting it
  -- into an accepted attendance; otherwise update the most recent rejected row.
  SELECT * INTO v_att FROM public.attendance
   WHERE member_id = p_member_id AND date = v_today AND valid IS NOT TRUE
   ORDER BY scanned_at DESC, id DESC LIMIT 1 FOR UPDATE;

  IF FOUND THEN
    UPDATE public.attendance SET
      scanned_at = now(), valid = v_valid, status = v_status,
      from_sessions = v_from_sessions, subscription_id = v_sub_id,
      scanned_by = p_actor_id, device_tag = left(p_device_tag, 64), source = 'kiosk'
    WHERE id = v_att.id;
  ELSE
    INSERT INTO public.attendance
      (member_id, date, scanned_at, valid, status, from_sessions,
       subscription_id, scanned_by, device_tag, source)
    VALUES
      (p_member_id, v_today, now(), v_valid, v_status, v_from_sessions,
       v_sub_id, p_actor_id, left(p_device_tag, 64), 'kiosk');
  END IF;

  RETURN jsonb_build_object('ok', true, 'valid', v_valid,
       'member_id', p_member_id, 'subscription_id', v_sub_id, 'message', v_msg)
       || v_details;
END;
$$;

REVOKE ALL ON FUNCTION public.atom_atomic_member_scan(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.atom_atomic_member_scan(uuid, uuid, text) TO service_role;
COMMIT;
