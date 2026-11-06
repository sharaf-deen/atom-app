-- Security Hardening 1F.13: pin legacy function search paths on Staging.
-- Applied to Supabase Staging as migration 20261106210839.
-- Preserve function definitions and ACLs, including RLS role-predicate helpers.
-- pg_catalog first; pg_temp last to avoid temporary-object shadowing.
DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proconfig IS NULL
      AND p.proname IN (
        'normalize_payment_method','coach_curriculum_level_rank',
        'atom_active_by_type_today','atom_active_members','atom_active_members_today',
        'atom_dropin_with_credits','atom_dropin_with_credits_today',
        'atom_expiring_in_7_days','atom_expiring_in_7_days_from_today',
        'atom_todays_checkins','atom_todays_checkins_today','generate_member_id',
        'f_store_order_adjust_stock','guard_notifications_kind',
        'is_admin','is_admin_or_super_admin','is_ops','is_super_admin',
        'notifications_fill_member_id','set_created_by','set_updated_at',
        'tg_soi_set_owner_uid','tg_store_orders_updated_at','tg_store_products_updated_at',
        'members_activity_stats','set_membership_refunds_updated_at',
        'prospects_before_write','prospect_normalize_email',
        'prospect_normalize_phone','prospect_normalize_name'
      )
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = pg_catalog, public, auth, extensions, pg_temp', f.signature);
  END LOOP;
END $$;
