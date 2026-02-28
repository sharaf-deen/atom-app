-- Fix invoices.member_id type to UUID (profiles.user_id) so RPC search_invoices works.
-- Robust/idempotent: safe after fresh resets and safe on existing schemas.
-- Key detail: drop policies first (they can block ALTER TYPE due to dependency).

do $$
declare
  col_type text;
begin
  -- If invoices table doesn't exist, do nothing.
  if not exists (
    select 1
    from information_schema.tables
    where table_schema = 'public' and table_name = 'invoices'
  ) then
    return;
  end if;

  -- Drop policies that may depend on member_id type (avoid ALTER TYPE dependency issues)
  begin
    execute 'drop policy if exists invoices_select_own on public.invoices';
    execute 'drop policy if exists invoices_select_staff on public.invoices';
  exception when undefined_object then
    null;
  end;

  select data_type into col_type
  from information_schema.columns
  where table_schema='public' and table_name='invoices' and column_name='member_id';

  -- Convert text/varchar -> uuid if needed (expects stored values are UUID strings).
  if col_type in ('text', 'character varying') then
    begin
      execute $sql$
        alter table public.invoices
          alter column member_id type uuid
          using nullif(member_id::text, '')::uuid
      $sql$;
    exception when invalid_text_representation then
      raise exception 'invoices.member_id contains non-uuid values; cannot cast to uuid';
    end;
  end if;
end $$;

-- Best-effort: enforce NOT NULL
do $$
begin
  begin
    alter table public.invoices alter column member_id set not null;
  exception when undefined_column then
    null;
  end;
end $$;

-- FK to profiles.user_id (best-effort)
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema='public' and table_name='profiles'
  ) then
    begin
      alter table public.invoices
        add constraint invoices_member_id_fkey
        foreign key (member_id) references public.profiles (user_id)
        on delete cascade;
    exception when duplicate_object then
      null;
    end;
  end if;
exception when undefined_table then
  null;
end $$;

-- RLS + policies (member_id is UUID now)
alter table public.invoices enable row level security;

create policy invoices_select_own
on public.invoices
for select
to authenticated
using (member_id = auth.uid());

create policy invoices_select_staff
on public.invoices
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.user_id = auth.uid()
      and p.role in ('admin','super_admin','reception','coach','assistant_coach')
  )
);

-- Grants so PostgREST exposes the table
grant select on table public.invoices to anon, authenticated;
grant all on table public.invoices to service_role;

notify pgrst, 'reload schema';
