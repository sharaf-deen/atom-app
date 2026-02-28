-- Fix invoices.member_id type to UUID (it must reference profiles.user_id) to match app code + RPC search_invoices.
-- Safe/idempotent: can be run multiple times.

do $$
declare
  col_type text;
begin
  select data_type into col_type
  from information_schema.columns
  where table_schema='public' and table_name='invoices' and column_name='member_id';

  if col_type is null then
    -- nothing to do (table missing or different schema)
    return;
  end if;

  -- Convert text/varchar -> uuid if needed (expects stored values are UUID strings).
  if col_type in ('text', 'character varying') then
    begin
      alter table public.invoices
        alter column member_id type uuid
        using nullif(member_id::text, '')::uuid;
    exception when invalid_text_representation then
      raise exception 'invoices.member_id contains non-uuid values; cannot cast to uuid';
    end;
  end if;
end $$;

-- Ensure NOT NULL (best-effort)
do $$
begin
  begin
    alter table public.invoices alter column member_id set not null;
  exception when undefined_column then
    null;
  end;
end $$;

-- FK to profiles (best-effort)
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='profiles') then
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

-- Fix policies (member_id is UUID now)
alter table public.invoices enable row level security;

drop policy if exists invoices_select_own on public.invoices;
create policy invoices_select_own
on public.invoices
for select
to authenticated
using (member_id = auth.uid());

drop policy if exists invoices_select_staff on public.invoices;
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
