-- Security Hardening 1F.4: Store and Private Coaching privileged RPCs are server-only.
-- Staging applied version 20261106143841; all three protected API routes authenticate and authorize callers before service_role invocation.
REVOKE EXECUTE ON FUNCTION public.admin_apply_store_sale_update(uuid,text,integer,text,text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_complete_store_preorder_as_sale(uuid,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.private_coaching_confirm_payment(uuid,uuid) FROM PUBLIC, anon, authenticated;
