-- Schedule a read-only, non-destructive gap inventory each day (03:00 UTC).
-- Never delete profiles or approve/reissue IDs from cron.
do $$
begin
  if to_regclass('cron.job') is null then
    raise notice 'pg_cron unavailable; audit can still run on opening the Super Admin recovery page';
  elsif not exists(select 1 from cron.job where jobname='atom-member-id-gap-audit-daily') then
    perform cron.schedule(
      'atom-member-id-gap-audit-daily',
      '0 3 * * *',
      'select public.member_id_gap_scan_system();'
    );
  end if;
end;
$$;
