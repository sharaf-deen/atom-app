-- Final consolidated Security Release Gate: RLS policies that rely on authenticated
-- identity helpers must not be evaluated under the anon role. Staging migration 20261107090351.
-- Policy predicates, actions and with_check expressions are preserved; only TO roles change.
DO $$
DECLARE pol record;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname='public'
      AND 'public'=ANY(roles)
      AND (coalesce(qual,'') || coalesce(with_check,'')) ~
          'is_super_admin|is_payment_validation_approver|is_staff|is_ops|is_family_guardian_of'
  LOOP
    EXECUTE format('ALTER POLICY %I ON %I.%I TO authenticated',pol.policyname,pol.schemaname,pol.tablename);
  END LOOP;
END $$;
