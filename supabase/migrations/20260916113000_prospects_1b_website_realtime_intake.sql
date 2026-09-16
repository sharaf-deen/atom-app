-- ATOM Prospects 1B — Website Real-Time Intake
-- Adds signed website webhook idempotency without exposing any public database write path.

begin;

alter table public.prospect_submissions
  add column if not exists website_event_id text null;

comment on column public.prospect_submissions.website_event_id is
  'Server-generated idempotency key supplied by the ATOM website webhook.';

do $$
begin
  alter table public.prospect_submissions
    add constraint prospect_submissions_website_event_id_length_chk
    check (website_event_id is null or length(website_event_id) between 1 and 160) not valid;
exception when duplicate_object then null;
end $$;
alter table public.prospect_submissions
  validate constraint prospect_submissions_website_event_id_length_chk;

create unique index if not exists prospect_submissions_website_event_uidx
  on public.prospect_submissions(website_event_id)
  where website_event_id is not null and btrim(website_event_id) <> '';

create or replace function public.import_website_prospect_submission(
  p_event_id text,
  p_full_name text,
  p_email text,
  p_phone text,
  p_source text,
  p_received_at timestamptz,
  p_requested_classes text[],
  p_submitted_level text,
  p_goals text[],
  p_message text,
  p_raw_payload jsonb
)
returns table(
  prospect_id_out uuid,
  submission_id_out uuid,
  created_prospect_out boolean,
  duplicate_event_out boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id text := nullif(btrim(coalesce(p_event_id, '')), '');
  v_existing_prospect_id uuid;
  v_existing_submission_id uuid;
  v_import record;
begin
  if v_event_id is null or length(v_event_id) > 160 then
    raise exception 'PROSPECT_EVENT_ID_REQUIRED' using errcode = '23514';
  end if;

  if p_source not in ('contact_us', 'visitor_information') then
    raise exception 'PROSPECT_SOURCE_INVALID' using errcode = '23514';
  end if;

  -- Serialize retries for the same event so two concurrent webhook deliveries
  -- cannot create duplicate submissions before the unique key is attached.
  perform pg_advisory_xact_lock(hashtextextended('atom-prospect:' || v_event_id, 0));

  select s.prospect_id, s.id
    into v_existing_prospect_id, v_existing_submission_id
  from public.prospect_submissions s
  where s.website_event_id = v_event_id
  limit 1;

  if found then
    return query
    select v_existing_prospect_id, v_existing_submission_id, false, true;
    return;
  end if;

  select *
    into v_import
  from public.import_prospect_submission(
    p_full_name,
    p_email,
    p_phone,
    p_source,
    'website_api',
    coalesce(p_received_at, now()),
    null,
    null,
    coalesce(p_requested_classes, '{}'::text[]),
    p_submitted_level,
    coalesce(p_goals, '{}'::text[]),
    p_message,
    coalesce(p_raw_payload, '{}'::jsonb),
    null
  );

  update public.prospect_submissions
  set website_event_id = v_event_id
  where id = v_import.submission_id_out;

  update public.prospect_activities
  set details = coalesce(details, '{}'::jsonb) || jsonb_build_object('website_event_id', v_event_id)
  where submission_id = v_import.submission_id_out
    and activity_type = 'submission';

  return query
  select
    v_import.prospect_id_out::uuid,
    v_import.submission_id_out::uuid,
    coalesce(v_import.created_prospect_out, false)::boolean,
    false;
end;
$$;

revoke all on function public.import_website_prospect_submission(
  text,text,text,text,text,timestamptz,text[],text,text[],text,jsonb
) from public, anon, authenticated;

grant execute on function public.import_website_prospect_submission(
  text,text,text,text,text,timestamptz,text[],text,text[],text,jsonb
) to service_role;

commit;
