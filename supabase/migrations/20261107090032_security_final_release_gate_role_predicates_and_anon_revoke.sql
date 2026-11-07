-- Final consolidated Security Release Gate — Staging migration 20261107090032.
-- Remove anonymous direct RPC access to role/guardian predicates used by RLS.
-- Keep authenticated EXECUTE for RLS policies, and service_role for backend workflows.
REVOKE EXECUTE ON FUNCTION public.is_family_guardian_of_family(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_family_guardian_of_member(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_ops(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_staff(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_super_admin(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_payment_validation_approver(uuid) FROM PUBLIC, anon;

-- Prevent ordinary authenticated users from enumerating another user's role.
-- Explicit service_role calls continue to resolve arbitrary subject IDs, which is
-- necessary for trusted payment validation and payroll workflows.
CREATE OR REPLACE FUNCTION public.is_ops(uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
 SELECT CASE
   WHEN auth.role() = 'anon' THEN false
   WHEN auth.role() = 'authenticated' AND uid IS DISTINCT FROM auth.uid() THEN false
   ELSE EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id=uid AND p.role IN ('reception','admin','super_admin'))
 END;
$fn$;

CREATE OR REPLACE FUNCTION public.is_staff(uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
 SELECT CASE
   WHEN auth.role() = 'anon' THEN false
   WHEN auth.role() = 'authenticated' AND uid IS DISTINCT FROM auth.uid() THEN false
   ELSE EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id=uid AND p.role IN ('reception','admin','super_admin'))
 END;
$fn$;

CREATE OR REPLACE FUNCTION public.is_super_admin(uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
 SELECT CASE
   WHEN auth.role() = 'anon' THEN false
   WHEN auth.role() = 'authenticated' AND uid IS DISTINCT FROM auth.uid() THEN false
   ELSE EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id=uid AND p.role = 'super_admin')
 END;
$fn$;

CREATE OR REPLACE FUNCTION public.is_payment_validation_approver(p_uid uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
 SELECT CASE
   WHEN auth.role() = 'anon' THEN false
   WHEN auth.role() = 'authenticated' AND p_uid IS DISTINCT FROM auth.uid() THEN false
   ELSE public.is_super_admin(p_uid)
 END;
$fn$;
