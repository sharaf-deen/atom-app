-- Runs only after local Supabase DB reset in GitHub Actions.
-- This file validates function installation and the default PUBLIC grant.
DO $$
BEGIN
  IF to_regprocedure(
    'public.correct_subscription_payment_method_v1(uuid,text,text,text,uuid)'
  ) IS NULL THEN
    RAISE EXCEPTION 'PAYMENT_METHOD_CORRECTION_FUNCTION_MISSING';
  END IF;

  IF has_function_privilege(
    'anon',
    'public.correct_subscription_payment_method_v1(uuid,text,text,text,uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'ANON_EXECUTE_PERMISSION_LEAK';
  END IF;

  IF has_function_privilege(
    'authenticated',
    'public.correct_subscription_payment_method_v1(uuid,text,text,text,uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'AUTHENTICATED_EXECUTE_PERMISSION_LEAK';
  END IF;

  IF NOT has_function_privilege(
    'service_role',
    'public.correct_subscription_payment_method_v1(uuid,text,text,text,uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'SERVICE_ROLE_EXECUTE_PERMISSION_MISSING';
  END IF;

  IF NOT has_table_privilege('authenticated','public.subscription_payment_method_corrections','SELECT') THEN
    RAISE EXCEPTION 'SUPER_ADMIN_AUDIT_READ_GRANT_MISSING';
  END IF;

  IF has_table_privilege('authenticated','public.subscription_payment_method_corrections','INSERT') THEN
    RAISE EXCEPTION 'UNPRIVILEGED_AUDIT_INSERT_GRANT_LEAK';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'subscription_payment_method_corrections'
      AND policyname = 'super admin read subscription payment method corrections'
  ) THEN
    RAISE EXCEPTION 'METHOD_CORRECTION_READ_POLICY_MISSING';
  END IF;
END;
$$;
SELECT 'METHOD_CORRECTION_LOCAL_SQL_INSTALL_PASS' AS result;
