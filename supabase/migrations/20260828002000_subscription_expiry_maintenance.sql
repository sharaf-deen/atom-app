-- Subscription expiry maintenance hotfix
-- Keeps stored subscription.status aligned with date-based expiry across the app.
-- Reuses the existing public.expire_subscriptions() function; no membership/refund schema changes.

create extension if not exists pg_cron;

do $do$
declare
  existing_job_id bigint;
begin
  if to_regprocedure('public.expire_subscriptions()') is null then
    raise exception 'public.expire_subscriptions() does not exist';
  end if;

  -- Immediately repair stale active subscriptions whose expiry condition is already met.
  perform public.expire_subscriptions();

  select jobid
    into existing_job_id
  from cron.job
  where jobname = 'expire-subscriptions-hourly'
  limit 1;

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  -- Date-based statuses should not remain stale for days/weeks.
  -- Hourly is intentionally lightweight and keeps date-only subscriptions consistent.
  perform cron.schedule(
    'expire-subscriptions-hourly',
    '7 * * * *',
    $job$select public.expire_subscriptions();$job$
  );
end
$do$;
