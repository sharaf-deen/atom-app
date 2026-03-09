-- Enable pg_cron if available
create extension if not exists pg_cron;

-- Make sure the refresh function exists before scheduling
create or replace function public.ensure_members_activity_mv_refresh_job()
returns void
language plpgsql
security definer
as $$
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
    '60 seconds',
    $$select public.refresh_members_with_activity_mv();$$
  );
end;
$$;

select public.ensure_members_activity_mv_refresh_job();

drop function if exists public.ensure_members_activity_mv_refresh_job();
