-- Ensure invoices.amount is NUMERIC to match RPC search_invoices() return type.
-- Idempotent and safe for resets.

do $$
declare
  col_type text;
begin
  if not exists (
    select 1
    from information_schema.tables
    where table_schema='public' and table_name='invoices'
  ) then
    return;
  end if;

  select data_type into col_type
  from information_schema.columns
  where table_schema='public' and table_name='invoices' and column_name='amount';

  if col_type is null then
    return;
  end if;

  if col_type in ('integer', 'bigint', 'smallint') then
    execute $sql$
      alter table public.invoices
        alter column amount type numeric
        using amount::numeric
    $sql$;
  end if;
end $$;

-- Best-effort: keep default
do $$
begin
  begin
    alter table public.invoices alter column amount set default 0;
  exception when undefined_column then
    null;
  end;
end $$;
