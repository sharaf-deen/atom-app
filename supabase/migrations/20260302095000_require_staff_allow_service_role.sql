-- Allow service_role to pass staff gate for guarded RPCs.
-- This is required because service_role JWT often has no user id (auth.uid() = null),
-- but server-side routes and CI smoke tests use the service role key.
--
-- Staff users (authenticated) are still enforced via profiles.role.

create or replace function public.require_staff()
returns void
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
begin
  -- Server-side / service role calls are allowed.
  if auth.role() = 'service_role' then
    return;
  end if;

  if auth.uid() is null then
    raise exception 'unauthorized';
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.user_id = auth.uid()
      and p.role = any (array['reception','admin','super_admin'])
  ) then
    raise exception 'forbidden';
  end if;
end;
$$;

revoke execute on function public.require_staff() from public;
grant execute on function public.require_staff() to authenticated;
grant execute on function public.require_staff() to service_role;

notify pgrst, 'reload schema';
