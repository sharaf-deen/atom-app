-- Member Consent 1A.1 — Liability Waiver Activation
-- Legal review completed: activate ATOM Liability Waiver v1.0
-- and require it for all new member registrations.

begin;

update public.legal_document_versions
set status = 'active',
    is_required = true,
    effective_from = coalesce(effective_from, '2026-09-30T00:00:00+03:00'::timestamptz),
    updated_at = now()
where document_key = 'liability_waiver'
  and version_label = '1.0';

-- Safety check: v1.0 must now be the unique active liability waiver.
do $$
declare
  v_active_count integer;
begin
  select count(*)
  into v_active_count
  from public.legal_document_versions
  where document_key = 'liability_waiver'
    and status = 'active';

  if v_active_count <> 1 then
    raise exception 'LIABILITY_WAIVER_ACTIVE_VERSION_INTEGRITY_ERROR';
  end if;
end;
$$;

commit;
