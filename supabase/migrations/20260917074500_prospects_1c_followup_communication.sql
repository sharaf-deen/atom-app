-- ATOM Prospects 1C — Follow-Up & Communication
-- Hardens follow-up state, requires an explicit Lost reason, and makes contact logging atomic.

begin;

-- Historical safety: 1A allowed Lost rows without a reason. Normalize only legacy rows
-- before enforcing the new rule; new writes must provide an explicit reason.
update public.prospects
set lost_reason = 'other'
where status = 'lost'
  and lost_reason is null;

do $$
begin
  alter table public.prospects
    add constraint prospects_lost_requires_reason_chk
    check (status <> 'lost' or lost_reason is not null) not valid;
exception when duplicate_object then null;
end $$;
alter table public.prospects validate constraint prospects_lost_requires_reason_chk;

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

  new.lost_reason := nullif(btrim(coalesce(new.lost_reason, '')), '');

  if new.status = 'lost' then
    if new.lost_reason is null then
      raise exception 'PROSPECT_LOST_REASON_REQUIRED' using errcode = '23514';
    end if;
  else
    new.lost_reason := null;
  end if;

  -- Terminal prospects must never stay in the active follow-up queue.
  if new.status in ('joined', 'lost') then
    new.next_follow_up_at := null;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_prospects_before_write on public.prospects;
create trigger trg_prospects_before_write
before insert or update of full_name, email, phone, status, lost_reason, next_follow_up_at
on public.prospects
for each row execute function public.prospects_before_write();

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
  elsif old.lost_reason is distinct from new.lost_reason and new.status = 'lost' then
    insert into public.prospect_activities(
      prospect_id, activity_type, summary, details, actor_user_id, occurred_at
    )
    values (
      new.id,
      'status_change',
      'Lost reason updated',
      jsonb_build_object('from_lost_reason', old.lost_reason, 'to_lost_reason', new.lost_reason),
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
after update of status, lost_reason, assigned_to, next_follow_up_at
on public.prospects
for each row execute function public.prospects_audit_change();

-- One database transaction records the initiated action, updates last contact,
-- and promotes New -> Contacted. If any step fails, nothing is partially logged.
create or replace function public.log_prospect_contact(
  p_prospect_id uuid,
  p_channel text,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_summary text;
  v_existing_id uuid;
  v_activity public.prospect_activities%rowtype;
  v_prospect public.prospects%rowtype;
begin
  if p_channel is null or p_channel not in ('whatsapp', 'call', 'email') then
    raise exception 'PROSPECT_CONTACT_CHANNEL_INVALID' using errcode = '23514';
  end if;

  select id
    into v_existing_id
  from public.prospects
  where id = p_prospect_id
  for update;

  if v_existing_id is null then
    raise exception 'PROSPECT_NOT_FOUND' using errcode = 'P0002';
  end if;

  v_summary := case p_channel
    when 'whatsapp' then 'WhatsApp contact initiated'
    when 'call' then 'Phone call initiated'
    else 'Email contact initiated'
  end;

  insert into public.prospect_activities(
    prospect_id,
    activity_type,
    summary,
    details,
    actor_user_id,
    occurred_at
  )
  values (
    p_prospect_id,
    p_channel,
    v_summary,
    jsonb_build_object('channel', p_channel, 'state', 'initiated'),
    p_actor_user_id,
    v_now
  )
  returning * into v_activity;

  update public.prospects
  set
    last_contacted_at = v_now,
    status = case when status = 'new' then 'contacted' else status end,
    updated_by = p_actor_user_id
  where id = p_prospect_id
  returning * into v_prospect;

  return jsonb_build_object(
    'activity', to_jsonb(v_activity),
    'prospect', to_jsonb(v_prospect)
  );
end;
$$;

revoke all on function public.log_prospect_contact(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.log_prospect_contact(uuid, text, uuid) to service_role;

commit;
