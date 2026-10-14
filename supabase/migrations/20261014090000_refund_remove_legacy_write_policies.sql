-- Functional 1B.5A: remove historical authenticated refund write policies.
-- Retain the existing read policy for admin / super_admin.
do $$
begin
  execute 'drop policy if exists "admin insert membership_refunds" on public.membership_refunds';
  execute 'drop policy if exists "admin update membership_refunds" on public.membership_refunds';
end
$$;
