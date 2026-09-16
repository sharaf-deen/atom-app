-- ATOM Prospects 1A — Foundation & Gmail Backfill
-- Contact-level lead pipeline for website enquiries.
-- PII is intentionally stored in application tables, never embedded in seed migrations.

begin;

create or replace function public.prospect_normalize_email(p_email text)
returns text
language sql
immutable
as $$
  select nullif(lower(btrim(coalesce(p_email, ''))), '');
$$;

create or replace function public.prospect_normalize_phone(p_phone text)
returns text
language plpgsql
immutable
as $$
declare
  v_digits text;
begin
  v_digits := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  if v_digits = '' then
    return null;
  end if;

  if left(v_digits, 2) = '00' then
    v_digits := substr(v_digits, 3);
  end if;

  -- Normalize Egyptian local mobile numbers to country-code form.
  if length(v_digits) = 11 and left(v_digits, 1) = '0' then
    v_digits := '20' || substr(v_digits, 2);
  end if;

  return nullif(v_digits, '');
end;
$$;

create table if not exists public.prospects (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text null,
  email_normalized text null,
  phone text null,
  phone_digits text null,
  status text not null default 'new',
  lost_reason text null,
  assigned_to uuid null references public.profiles(user_id) on delete set null,
  next_follow_up_at timestamptz null,
  last_contacted_at timestamptz null,
  first_seen_at timestamptz not null default now(),
  last_submission_at timestamptz not null default now(),
  created_by uuid null references public.profiles(user_id) on delete set null,
  updated_by uuid null references public.profiles(user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.prospect_submissions (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.prospects(id) on delete cascade,
  source text not null,
  ingest_channel text not null default 'gmail_backfill',
  submitted_name text null,
  submitted_email text null,
  submitted_phone text null,
  requested_classes text[] not null default '{}'::text[],
  submitted_level text null,
  goals text[] not null default '{}'::text[],
  message text null,
  gmail_message_id text null,
  gmail_thread_id text null,
  received_at timestamptz not null default now(),
  raw_payload jsonb not null default '{}'::jsonb,
  created_by uuid null references public.profiles(user_id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.prospect_activities (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.prospects(id) on delete cascade,
  submission_id uuid null references public.prospect_submissions(id) on delete set null,
  activity_type text not null,
  summary text not null,
  details jsonb not null default '{}'::jsonb,
  actor_user_id uuid null references public.profiles(user_id) on delete set null,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

do $$
begin
  alter table public.prospects
    add constraint prospects_status_chk
    check (status in ('new','contacted','awaiting_reply','trial_booked','trial_completed','joined','lost')) not valid;
exception when duplicate_object then null;
end $$;
alter table public.prospects validate constraint prospects_status_chk;

do $$
begin
  alter table public.prospects
    add constraint prospects_lost_reason_chk
    check (
      lost_reason is null
      or lost_reason in ('no_response','not_interested','invalid','spam','other')
    ) not valid;
exception when duplicate_object then null;
end $$;
alter table public.prospects validate constraint prospects_lost_reason_chk;

do $$
begin
  alter table public.prospect_submissions
    add constraint prospect_submissions_source_chk
    check (source in ('contact_us','visitor_information','unknown')) not valid;
exception when duplicate_object then null;
end $$;
alter table public.prospect_submissions validate constraint prospect_submissions_source_chk;

do $$
begin
  alter table public.prospect_submissions
    add constraint prospect_submissions_ingest_channel_chk
    check (ingest_channel in ('gmail_backfill','website_api','manual')) not valid;
exception when duplicate_object then null;
end $$;
alter table public.prospect_submissions validate constraint prospect_submissions_ingest_channel_chk;

do $$
begin
  alter table public.prospect_activities
    add constraint prospect_activities_type_chk
    check (
      activity_type in (
        'submission','status_change','assignment','follow_up_scheduled',
        'note','whatsapp','call','email','joined','lost'
      )
    ) not valid;
exception when duplicate_object then null;
end $$;
alter table public.prospect_activities validate constraint prospect_activities_type_chk;

create unique index if not exists prospects_email_normalized_uidx
  on public.prospects(email_normalized)
  where email_normalized is not null;

create unique index if not exists prospects_phone_digits_uidx
  on public.prospects(phone_digits)
  where phone_digits is not null;

create unique index if not exists prospect_submissions_gmail_message_uidx
  on public.prospect_submissions(gmail_message_id)
  where gmail_message_id is not null and btrim(gmail_message_id) <> '';

create index if not exists prospects_status_followup_idx
  on public.prospects(status, next_follow_up_at, last_submission_at desc);

create index if not exists prospects_assigned_idx
  on public.prospects(assigned_to, status, next_follow_up_at);

create index if not exists prospect_submissions_prospect_received_idx
  on public.prospect_submissions(prospect_id, received_at desc);

create index if not exists prospect_activities_prospect_occurred_idx
  on public.prospect_activities(prospect_id, occurred_at desc);

create or replace function public.prospects_before_write()
returns trigger
language plpgsql
as $$
begin
  new.full_name := btrim(coalesce(new.full_name, ''));
  if new.full_name = '' then
    raise exception 'PROSPECT_NAME_REQUIRED' using errcode = '23514';
  end if;

  new.email := nullif(btrim(coalesce(new.email, '')), '');
  new.phone := nullif(btrim(coalesce(new.phone, '')), '');
  new.email_normalized := public.prospect_normalize_email(new.email);
  new.phone_digits := public.prospect_normalize_phone(new.phone);

  if new.email_normalized is null and new.phone_digits is null then
    raise exception 'PROSPECT_CONTACT_REQUIRED' using errcode = '23514';
  end if;

  if new.status <> 'lost' then
    new.lost_reason := null;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_prospects_before_write on public.prospects;
create trigger trg_prospects_before_write
before insert or update of full_name, email, phone, status, lost_reason
on public.prospects
for each row execute function public.prospects_before_write();

drop trigger if exists trg_prospects_set_updated_at on public.prospects;
create trigger trg_prospects_set_updated_at
before update on public.prospects
for each row execute function public.set_updated_at();

create or replace function public.prospects_audit_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status is distinct from new.status then
    insert into public.prospect_activities(
      prospect_id, activity_type, summary, details, actor_user_id, occurred_at
    )
    values (
      new.id,
      case when new.status = 'joined' then 'joined'
           when new.status = 'lost' then 'lost'
           else 'status_change' end,
      'Status changed from ' || old.status || ' to ' || new.status,
      jsonb_build_object('from', old.status, 'to', new.status, 'lost_reason', new.lost_reason),
      new.updated_by,
      now()
    );
  end if;

  if old.assigned_to is distinct from new.assigned_to then
    insert into public.prospect_activities(
      prospect_id, activity_type, summary, details, actor_user_id, occurred_at
    )
    values (
      new.id,
      'assignment',
      case when new.assigned_to is null then 'Prospect unassigned' else 'Prospect assigned' end,
      jsonb_build_object('from', old.assigned_to, 'to', new.assigned_to),
      new.updated_by,
      now()
    );
  end if;

  if old.next_follow_up_at is distinct from new.next_follow_up_at then
    insert into public.prospect_activities(
      prospect_id, activity_type, summary, details, actor_user_id, occurred_at
    )
    values (
      new.id,
      'follow_up_scheduled',
      case when new.next_follow_up_at is null then 'Follow-up cleared' else 'Follow-up scheduled' end,
      jsonb_build_object('from', old.next_follow_up_at, 'to', new.next_follow_up_at),
      new.updated_by,
      now()
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_prospects_audit_change on public.prospects;
create trigger trg_prospects_audit_change
after update of status, assigned_to, next_follow_up_at
on public.prospects
for each row execute function public.prospects_audit_change();

create or replace function public.import_prospect_submission(
  p_full_name text,
  p_email text,
  p_phone text,
  p_source text,
  p_ingest_channel text,
  p_received_at timestamptz,
  p_gmail_message_id text,
  p_gmail_thread_id text,
  p_requested_classes text[],
  p_submitted_level text,
  p_goals text[],
  p_message text,
  p_raw_payload jsonb,
  p_actor_user_id uuid
)
returns table(
  prospect_id_out uuid,
  submission_id_out uuid,
  created_prospect_out boolean,
  duplicate_message_out boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_phone text;
  v_matches uuid[];
  v_prospect_id uuid;
  v_submission_id uuid;
  v_created boolean := false;
  v_existing_prospect_id uuid;
  v_existing_submission_id uuid;
  v_received_at timestamptz := coalesce(p_received_at, now());
  v_source text;
  v_ingest text;
begin
  v_email := public.prospect_normalize_email(p_email);
  v_phone := public.prospect_normalize_phone(p_phone);
  v_source := case when p_source in ('contact_us','visitor_information','unknown') then p_source else 'unknown' end;
  v_ingest := case when p_ingest_channel in ('gmail_backfill','website_api','manual') then p_ingest_channel else 'gmail_backfill' end;

  if btrim(coalesce(p_full_name, '')) = '' then
    raise exception 'PROSPECT_NAME_REQUIRED' using errcode = '23514';
  end if;

  if v_email is null and v_phone is null then
    raise exception 'PROSPECT_CONTACT_REQUIRED' using errcode = '23514';
  end if;

  if nullif(btrim(coalesce(p_gmail_message_id, '')), '') is not null then
    select s.prospect_id, s.id
      into v_existing_prospect_id, v_existing_submission_id
    from public.prospect_submissions s
    where s.gmail_message_id = btrim(p_gmail_message_id)
    limit 1;

    if found then
      return query
      select v_existing_prospect_id, v_existing_submission_id, false, true;
      return;
    end if;
  end if;

  select array_agg(x.id order by x.created_at asc)
    into v_matches
  from (
    select distinct p.id, p.created_at
    from public.prospects p
    where (v_email is not null and p.email_normalized = v_email)
       or (v_phone is not null and p.phone_digits = v_phone)
  ) x;

  if coalesce(cardinality(v_matches), 0) > 1 then
    raise exception 'PROSPECT_CONTACT_CONFLICT'
      using errcode = '23505',
            detail = 'Email and phone resolve to different existing prospect records.';
  end if;

  if coalesce(cardinality(v_matches), 0) = 1 then
    v_prospect_id := v_matches[1];

    update public.prospects
    set
      full_name = case
        when length(btrim(coalesce(full_name, ''))) < length(btrim(coalesce(p_full_name, '')))
          then btrim(p_full_name)
        else full_name
      end,
      email = coalesce(email, nullif(btrim(coalesce(p_email, '')), '')),
      phone = coalesce(phone, nullif(btrim(coalesce(p_phone, '')), '')),
      first_seen_at = least(first_seen_at, v_received_at),
      last_submission_at = greatest(last_submission_at, v_received_at),
      updated_by = p_actor_user_id
    where id = v_prospect_id;
  else
    insert into public.prospects(
      full_name, email, phone, first_seen_at, last_submission_at, created_by, updated_by
    )
    values (
      btrim(p_full_name),
      nullif(btrim(coalesce(p_email, '')), ''),
      nullif(btrim(coalesce(p_phone, '')), ''),
      v_received_at,
      v_received_at,
      p_actor_user_id,
      p_actor_user_id
    )
    returning id into v_prospect_id;

    v_created := true;
  end if;

  insert into public.prospect_submissions(
    prospect_id,
    source,
    ingest_channel,
    submitted_name,
    submitted_email,
    submitted_phone,
    requested_classes,
    submitted_level,
    goals,
    message,
    gmail_message_id,
    gmail_thread_id,
    received_at,
    raw_payload,
    created_by
  )
  values (
    v_prospect_id,
    v_source,
    v_ingest,
    nullif(btrim(coalesce(p_full_name, '')), ''),
    nullif(btrim(coalesce(p_email, '')), ''),
    nullif(btrim(coalesce(p_phone, '')), ''),
    coalesce(p_requested_classes, '{}'::text[]),
    nullif(btrim(coalesce(p_submitted_level, '')), ''),
    coalesce(p_goals, '{}'::text[]),
    nullif(btrim(coalesce(p_message, '')), ''),
    nullif(btrim(coalesce(p_gmail_message_id, '')), ''),
    nullif(btrim(coalesce(p_gmail_thread_id, '')), ''),
    v_received_at,
    coalesce(p_raw_payload, '{}'::jsonb),
    p_actor_user_id
  )
  returning id into v_submission_id;

  insert into public.prospect_activities(
    prospect_id, submission_id, activity_type, summary, details, actor_user_id, occurred_at
  )
  values (
    v_prospect_id,
    v_submission_id,
    'submission',
    case
      when v_source = 'visitor_information' then 'Visitor Information form received'
      when v_source = 'contact_us' then 'Contact Us form received'
      else 'Website enquiry received'
    end,
    jsonb_build_object(
      'source', v_source,
      'ingest_channel', v_ingest,
      'gmail_message_id', nullif(btrim(coalesce(p_gmail_message_id, '')), '')
    ),
    p_actor_user_id,
    v_received_at
  );

  return query
  select v_prospect_id, v_submission_id, v_created, false;
end;
$$;

alter table public.prospects enable row level security;
alter table public.prospect_submissions enable row level security;
alter table public.prospect_activities enable row level security;

drop policy if exists "front desk read prospects" on public.prospects;
create policy "front desk read prospects"
  on public.prospects for select
  using (
    exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid()
        and p.role in ('reception','admin','super_admin')
    )
  );

drop policy if exists "front desk insert prospects" on public.prospects;
create policy "front desk insert prospects"
  on public.prospects for insert
  with check (
    exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid()
        and p.role in ('reception','admin','super_admin')
    )
  );

drop policy if exists "front desk update prospects" on public.prospects;
create policy "front desk update prospects"
  on public.prospects for update
  using (
    exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid()
        and p.role in ('reception','admin','super_admin')
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid()
        and p.role in ('reception','admin','super_admin')
    )
  );

drop policy if exists "front desk read prospect submissions" on public.prospect_submissions;
create policy "front desk read prospect submissions"
  on public.prospect_submissions for select
  using (
    exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid()
        and p.role in ('reception','admin','super_admin')
    )
  );

drop policy if exists "front desk insert prospect submissions" on public.prospect_submissions;
create policy "front desk insert prospect submissions"
  on public.prospect_submissions for insert
  with check (
    exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid()
        and p.role in ('reception','admin','super_admin')
    )
  );

drop policy if exists "front desk read prospect activities" on public.prospect_activities;
create policy "front desk read prospect activities"
  on public.prospect_activities for select
  using (
    exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid()
        and p.role in ('reception','admin','super_admin')
    )
  );

drop policy if exists "front desk insert prospect activities" on public.prospect_activities;
create policy "front desk insert prospect activities"
  on public.prospect_activities for insert
  with check (
    exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid()
        and p.role in ('reception','admin','super_admin')
    )
  );

grant select, insert, update on public.prospects to authenticated;
grant select, insert on public.prospect_submissions to authenticated;
grant select, insert on public.prospect_activities to authenticated;

grant all on public.prospects to service_role;
grant all on public.prospect_submissions to service_role;
grant all on public.prospect_activities to service_role;

revoke all on function public.import_prospect_submission(
  text,text,text,text,text,timestamptz,text,text,text[],text,text[],text,jsonb,uuid
) from public, anon, authenticated;
grant execute on function public.import_prospect_submission(
  text,text,text,text,text,timestamptz,text,text,text[],text,text[],text,jsonb,uuid
) to service_role;

commit;
