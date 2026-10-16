-- Functional 1C.3D - Website intake contact-level race protection
-- Prevent distinct event IDs with overlapping normalized contact details from
-- simultaneously creating competing prospect records. Existing event-id
-- idempotency and all submission/activity writes remain unchanged.
-- No historical records are modified.
begin;

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
  v_contact_key text;
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

  -- Functional 1C.3D: serialize distinct event IDs sharing an email or phone.
  -- Acquire locks in sorted order to avoid deadlocks when both keys are provided.
  -- This is in addition to (not instead of) the existing event-id lock.
  for v_contact_key in
    select distinct contact_key
    from unnest(array[
      case when public.prospect_normalize_email(p_email) is not null
        then 'email:' || public.prospect_normalize_email(p_email) else null end,
      case when public.prospect_normalize_phone(p_phone) is not null
        then 'phone:' || public.prospect_normalize_phone(p_phone) else null end
    ]) as contact(contact_key)
    where contact_key is not null
    order by contact_key
  loop
    perform pg_advisory_xact_lock(hashtextextended('atom-prospect-contact:' || v_contact_key, 0));
  end loop;

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

commit;
