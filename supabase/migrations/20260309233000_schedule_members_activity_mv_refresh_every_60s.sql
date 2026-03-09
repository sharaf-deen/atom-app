create extension if not exists pg_cron;

do $do$
declare
  existing_job_id bigint;
begin
  if to_regprocedure('public.refresh_members_with_activity_mv()') is null then
    raise exception 'public.refresh_members_with_activity_mv() does not exist';
  end if;

  select jobid
    into existing_job_id
  from cron.job
  where jobname = 'refresh-members-with-activity-mv-every-60s'
  limit 1;

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  perform cron.schedule(
    'refresh-members-with-activity-mv-every-60s',
    '* * * * *',
    $job$select public.refresh_members_with_activity_mv();$job$
  );
end
$do$;