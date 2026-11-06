-- Security Hardening 1F: Store financial/inventory admin RPCs are server-only.
-- Both functions are SECURITY DEFINER and accept mutable business data without
-- their own caller-role validation. Preserve explicit service_role grant.
REVOKE EXECUTE ON FUNCTION
  public.admin_apply_store_sale_update(uuid, text, integer, text, text),
  public.admin_complete_store_preorder_as_sale(uuid, text, uuid)
FROM PUBLIC, anon, authenticated;
