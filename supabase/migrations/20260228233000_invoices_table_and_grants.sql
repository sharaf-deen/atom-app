-- Create invoices table (if missing) and ensure it's exposed to PostgREST.
-- This migration is idempotent and compatible with both legacy schemas (member_id TEXT)
-- and the newer schema (member_id UUID referencing profiles.user_id).

do $$
begin
  if not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'invoices'
      and c.relkind = 'r'
  ) then
    execute $sql$
      create table public.invoices (
        id uuid not null default gen_random_uuid(),
        member_id text not null,
        subscription_id uuid null,
        invoice_number text not null,
        amount integer not null default 0,
        currency text not null default 'EGP',
        paid_at timestamptz not null default now(),
        pdf_path text not null,
        snapshot jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now(),
        created_by uuid null,
        constraint invoices_pkey primary key (id)
      )
    $sql$;
  end if;
end $$;

-- Ensure expected columns exist (for older/manual schemas)
alter table public.invoices
  add column if not exists member_id text;

alter table public.invoices
  add column if not exists subscription_id uuid;

alter table public.invoices
  add column if not exists invoice_number text;

alter table public.invoices
  add column if not exists amount integer;

alter table public.invoices
  add column if not exists currency text;

alter table public.invoices
  add column if not exists paid_at timestamptz;

alter table public.invoices
  add column if not exists pdf_path text;

alter table public.invoices
  add column if not exists snapshot jsonb;

alter table public.invoices
  add column if not exists created_at timestamptz;

alter table public.invoices
  add column if not exists created_by uuid;

-- Indexes / constraints
create unique index if not exists invoices_invoice_number_key on public.invoices (invoice_number);
create index if not exists invoices_member_id_idx on public.invoices (member_id);
create index if not exists invoices_paid_at_idx on public.invoices (paid_at desc);
create index if not exists invoices_subscription_id_idx on public.invoices (subscription_id);

-- FK (best-effort)
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='subscriptions') then
    begin
      alter table public.invoices
        add constraint invoices_subscription_id_fkey
        foreign key (subscription_id) references public.subscriptions (id)
        on delete set null;
    exception when duplicate_object then
      null;
    end;
  end if;
exception when undefined_table then
  null;
end $$;

do $$
begin
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='profiles') then
    begin
      alter table public.invoices
        add constraint invoices_created_by_fkey
        foreign key (created_by) references public.profiles (user_id)
        on delete set null;
    exception when duplicate_object then
      null;
    end;
  end if;
exception when undefined_table then
  null;
end $$;

-- RLS
alter table public.invoices enable row level security;

-- Grants (important so PostgREST exposes /rest/v1/invoices in schema cache)
grant select on table public.invoices to anon, authenticated;
grant all on table public.invoices to service_role;

-- Policies:
-- We support 2 schemas:
--   A) legacy: invoices.member_id is TEXT (often member code)
--   B) new:    invoices.member_id is UUID (profiles.user_id)
-- We choose the policy conditionally based on the column type.

do $$
declare
  col_type text;
begin
  select data_type into col_type
  from information_schema.columns
  where table_schema='public' and table_name='invoices' and column_name='member_id';

  -- Drop existing policies first (safe)
  execute 'drop policy if exists invoices_select_own on public.invoices';
  execute 'drop policy if exists invoices_select_staff on public.invoices';

  -- Own invoices policy
  if col_type = 'uuid' then
    execute $pol$
      create policy invoices_select_own
      on public.invoices
      for select
      to authenticated
      using (member_id = auth.uid())
    $pol$;
  else
    -- legacy text schema: match by profiles.member_id (text)
    execute $pol$
      create policy invoices_select_own
      on public.invoices
      for select
      to authenticated
      using (
        exists (
          select 1
          from public.profiles p
          where p.user_id = auth.uid()
            and p.member_id is not null
            and p.member_id = invoices.member_id
        )
      )
    $pol$;
  end if;

  -- Staff read policy (always allowed for staff)
  execute $pol$
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
    )
  $pol$;
end $$;

notify pgrst, 'reload schema';
