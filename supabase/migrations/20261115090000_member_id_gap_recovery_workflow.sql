-- ATOM Member ID Recovery 2A — reviewable gap audit, controlled release, automatic detection.
-- Never mark historical IDs available merely because the profiles row no longer exists.
-- Migration is non-destructive and does not approve or reissue any of the 22 legacy gaps.
begin;

alter table public.member_id_reissue_queue
  drop constraint if exists member_id_reissue_single_target;
alter table public.member_id_reissue_queue
  add constraint member_id_reissue_single_target
  check (member_id ~ '^ATOM-[0-9]{6,}$');
alter table public.member_id_reissue_queue
  alter column original_profile_user_id drop not null;
alter table public.member_id_reissue_queue
  add column if not exists release_evidence jsonb not null default '{}'::jsonb;
revoke insert, update, delete on public.member_id_reissue_queue from anon, authenticated, service_role;
grant select on public.member_id_reissue_queue to service_role;

create table if not exists public.member_id_deletion_events (
  id uuid primary key default gen_random_uuid(),
  member_id text not null,
  original_user_id uuid not null,
  archived_at timestamptz,
  archive_reason text,
  deleted_at timestamptz not null default now()
);
create index if not exists member_id_deletion_events_code_idx on public.member_id_deletion_events(member_id);
alter table public.member_id_deletion_events enable row level security;
revoke all on public.member_id_deletion_events from public, anon, authenticated;
grant select on public.member_id_deletion_events to service_role;

create or replace function public.member_id_capture_profile_deletion()
returns trigger language plpgsql security definer set search_path=public,pg_catalog
as $$
begin
  if old.member_id is not null and old.member_id ~ '^ATOM-[0-9]{6,}$' then
    insert into public.member_id_deletion_events(member_id,original_user_id,archived_at,archive_reason)
    values(old.member_id,old.user_id,old.archived_at,old.archive_reason);
  end if;
  return old;
end;
$$;
drop trigger if exists member_id_capture_profile_deletion_trg on public.profiles;
create trigger member_id_capture_profile_deletion_trg
  after delete on public.profiles for each row
  execute function public.member_id_capture_profile_deletion();

create table if not exists public.member_id_gap_review (
  member_id text primary key,
  first_detected_at timestamptz not null default now(),
  last_scanned_at timestamptz not null default now(),
  classification text not null check (classification in
    ('historical_do_not_reissue','manual_review','queued','consumed','no_longer_missing')),
  evidence jsonb not null default '{}'::jsonb,
  approved_by uuid,
  approved_at timestamptz,
  approval_reason text,
  constraint member_id_gap_review_code_chk check (member_id ~ '^ATOM-[0-9]{6,}$')
);
alter table public.member_id_gap_review enable row level security;
revoke all on public.member_id_gap_review from public, anon, authenticated;
grant select on public.member_id_gap_review to service_role;

-- Conservative evidence. These are ID-code (text) references; UUID references
-- cannot be recovered from a deleted row without an original identity record.
create or replace function public.member_id_gap_evidence(p_code text)
returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
begin
  if p_code is null or p_code !~ '^ATOM-[0-9]{6,}$' then raise exception 'INVALID_MEMBER_ID'; end if;
  return jsonb_build_object(
    'audit_logs', (select count(*) from public.audit_logs a where a.action_details::text like '%'||p_code||'%'),
    'scan_audit', (select count(*) from public.scan_audit a where a.member_code=p_code),
    'store_sales', (select count(*) from public.store_sales a where a.buyer_member_id=p_code),
    'coach_incidents', (select count(*) from public.coach_member_incidents a where a.member_code_snapshot=p_code),
    'staff_attendance', (select count(*) from public.coach_staff_attendance a where a.staff_member_id_snapshot=p_code),
    'family_recovery', (select count(*) from public.family_duplicate_recovery_audit a where p_code=any(a.archived_member_ids) or a.created_member_id=p_code),
    'deletion_events', (select count(*) from public.member_id_deletion_events a where a.member_id=p_code)
  );
end;
$$;

create or replace function public.member_id_gap_scan_system()
returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare
  v_limit bigint;
  v_code text;
  v_evidence jsonb;
  v_historical bigint;
  v_queued boolean;
  v_consumed boolean;
  v_count integer:=0;
begin
  select last_value into v_limit from public.member_id_seq;
  if v_limit>1000000 then raise exception 'MEMBER_SEQUENCE_SCAN_LIMIT'; end if;
  for v_code in
    select 'ATOM-'||lpad(s.n::text,6,'0')
    from generate_series(1,greatest(v_limit,0)) s(n)
    where not exists (select 1 from public.profiles p
      where p.member_id='ATOM-'||lpad(s.n::text,6,'0'))
    order by s.n
  loop
    v_evidence:=public.member_id_gap_evidence(v_code);
    select exists(select 1 from public.member_id_reissue_queue where member_id=v_code and consumed_at is null),
           exists(select 1 from public.member_id_reissue_queue where member_id=v_code and consumed_at is not null)
    into v_queued,v_consumed;
    select coalesce(sum((value)::bigint),0) into v_historical
    from jsonb_each_text(v_evidence);
    insert into public.member_id_gap_review(member_id,last_scanned_at,classification,evidence)
    values(v_code,now(),
      case when v_queued then 'queued'
        when v_consumed then 'consumed'
        when v_historical>0 then 'historical_do_not_reissue'
        else 'manual_review' end,
      v_evidence)
    on conflict(member_id) do update
      set last_scanned_at=excluded.last_scanned_at,
      classification=excluded.classification,evidence=excluded.evidence;
    v_count:=v_count+1;
  end loop;
  update public.member_id_gap_review r set
    last_scanned_at=now(),classification='no_longer_missing'
  where classification<>'no_longer_missing'
    and exists(select 1 from public.profiles p where p.member_id=r.member_id);
  return jsonb_build_object('scanned_gaps',v_count);
end;
$$;

create or replace function public.member_id_gap_scan(p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
begin
  if not exists(select 1 from public.profiles
    where user_id=p_actor_id and role='super_admin' and archived_at is null) then
    raise exception 'SUPER_ADMIN_REQUIRED';
  end if;
  return public.member_id_gap_scan_system();
end;
$$;

-- Explicit manual attestation for ONLY clean gaps. Historical deletion evidence
-- is never overrideable through this RPC.
create or replace function public.member_id_approve_gaps(
  p_actor_id uuid,p_codes text[],p_reason text,p_attested boolean
)
returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare
  v_code text;
  v_evidence jsonb;
  v_total bigint;
  v_limit bigint;
  v_count integer:=0;
begin
  if not exists(select 1 from public.profiles
    where user_id=p_actor_id and role='super_admin' and archived_at is null) then
    raise exception 'SUPER_ADMIN_REQUIRED';
  end if;
  if p_attested is distinct from true or length(btrim(coalesce(p_reason,'')))<35
     or coalesce(array_length(p_codes,1),0)<1
     or coalesce(array_length(p_codes,1),0)>50
     or (select count(distinct x) from unnest(p_codes) x)<>array_length(p_codes,1) then
    raise exception 'REVIEW_ATTESTATION_AND_UNIQUE_IDS_REQUIRED';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('member-id-gap-approval',0));
  select last_value into v_limit from public.member_id_seq;
  foreach v_code in array p_codes loop
    if v_code is null or v_code !~ '^ATOM-[0-9]{6,}$'
       or substring(v_code from 6)::bigint>v_limit
       or exists(select 1 from public.profiles where member_id=v_code)
       or exists(select 1 from public.member_id_reissue_queue where member_id=v_code)
       or not exists(select 1 from public.member_id_gap_review
          where member_id=v_code and classification='manual_review') then
      raise exception 'NOT_AN_ELIGIBLE_REVIEWED_GAP: %',v_code;
    end if;
    v_evidence:=public.member_id_gap_evidence(v_code);
    select coalesce(sum(value::bigint),0) into v_total from jsonb_each_text(v_evidence);
    if v_total<>0 then raise exception 'HISTORICAL_EVIDENCE_BLOCKS_REISSUE: %',v_code; end if;
    insert into public.member_id_reissue_queue
      (member_id,original_profile_user_id,released_by,release_reason,release_evidence)
    values(v_code,null,p_actor_id,left(btrim(p_reason),1000),
      jsonb_build_object('source','manual_reviewed_gap','evidence',v_evidence,'attested',true));
    update public.member_id_gap_review set
      approved_by=p_actor_id,approved_at=now(),approval_reason=left(btrim(p_reason),1000),
      classification='queued',last_scanned_at=now(),evidence=v_evidence
    where member_id=v_code;
    v_count:=v_count+1;
  end loop;
  return jsonb_build_object('ok',true,'approved_count',v_count);
end;
$$;

-- Future errors: atomic release only for an explicitly archived "created in error"
-- member with no FKs, login, family links, QR/financial history or references.
-- Anything with data requires a case-specific recovery/migration, not silent deletion.
create or replace function public.member_id_release_archived_error(
  p_actor_id uuid,p_profile_user_id uuid,p_reason text
)
returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare
  v_p public.profiles%rowtype;
  v_fk record; v_count bigint; v_ev jsonb; v_ev_total bigint;
begin
  if not exists(select 1 from public.profiles
    where user_id=p_actor_id and role='super_admin' and archived_at is null) then
    raise exception 'SUPER_ADMIN_REQUIRED';
  end if;
  if length(btrim(coalesce(p_reason,'')))<35 then raise exception 'REASON_REQUIRED';end if;
  perform pg_advisory_xact_lock(hashtextextended('member-id-error-release',0));
  select * into strict v_p from public.profiles where user_id=p_profile_user_id for update;
  if v_p.archived_at is null or v_p.role<>'member' or v_p.email is not null
     or v_p.member_id !~ '^ATOM-[0-9]{6,}$'
     or coalesce(v_p.archive_reason,'') not ilike 'CREATED_IN_ERROR:%'
     or exists(select 1 from public.member_id_reissue_queue where member_id=v_p.member_id)
     or exists(select 1 from auth.users where id=v_p.user_id)
     or exists(select 1 from public.family_members where member_id=v_p.user_id)
     or exists(select 1 from public.family_guardians where auth_user_id=v_p.user_id)
  then raise exception 'NOT_SAFE_ARCHIVED_ERROR';end if;

  for v_fk in
    select n.nspname schema_name,r.relname table_name,a.attname column_name
    from pg_catalog.pg_constraint c
    join pg_catalog.pg_class r on r.oid=c.conrelid
    join pg_catalog.pg_namespace n on n.oid=r.relnamespace
    join pg_catalog.pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
    join pg_catalog.pg_attribute p on p.attrelid=c.confrelid and p.attnum=c.confkey[1]
    where c.contype='f' and c.confrelid='public.profiles'::regclass
      and array_length(c.conkey,1)=1 and array_length(c.confkey,1)=1 and p.attname='user_id'
  loop
    execute format('select count(*) from %I.%I where %I=$1',
      v_fk.schema_name,v_fk.table_name,v_fk.column_name)
    into v_count using v_p.user_id;
    if v_count>0 then
      raise exception 'DEPENDENCY_BLOCKED: %.% (% rows)',v_fk.table_name,v_fk.column_name,v_count;
    end if;
  end loop;
  v_ev:=public.member_id_gap_evidence(v_p.member_id);
  select coalesce(sum(value::bigint),0) into v_ev_total from jsonb_each_text(v_ev);
  if v_ev_total>0 then raise exception 'TEXTUAL_OR_HISTORICAL_EVIDENCE_BLOCKED: %',v_p.member_id;end if;

  delete from public.profiles where user_id=v_p.user_id and member_id=v_p.member_id and archived_at is not null;
  get diagnostics v_count=row_count;
  if v_count<>1 then raise exception 'PROFILE_DELETE_COUNT_MISMATCH';end if;
  insert into public.member_id_reissue_queue
    (member_id,original_profile_user_id,released_by,release_reason,release_evidence)
  values(v_p.member_id,v_p.user_id,p_actor_id,left(btrim(p_reason),1000),
    jsonb_build_object('source','reviewed_archived_error','evidence_before_delete',v_ev));
  insert into public.member_id_gap_review(member_id,classification,evidence)
  values(v_p.member_id,'queued',jsonb_build_object('safe_release',true))
  on conflict(member_id) do update set
    classification='queued',last_scanned_at=now(),evidence=excluded.evidence;
  return jsonb_build_object('ok',true,'released_member_id',v_p.member_id);
end;
$$;

-- Keep FIFO behavior of the two previously approved Hemmali IDs.
-- Within an approval batch with identical release timestamps, select lower ID first.
create or replace function public.fill_member_id()
returns trigger language plpgsql security definer set search_path=public,pg_catalog as $$
declare v_reissued text;
begin
  if new.member_id is null or btrim(new.member_id)='' then
    if TG_OP='INSERT' and new.role='member' and new.archived_at is null then
      with candidate as (
        select q.member_id from public.member_id_reissue_queue q
        where q.consumed_at is null and not exists(
          select 1 from public.profiles p where p.member_id=q.member_id)
        order by q.released_at,q.member_id limit 1 for update of q
      )
      update public.member_id_reissue_queue q
        set consumed_by_profile_user_id=new.user_id,consumed_at=now()
      from candidate c
      where q.member_id=c.member_id and q.consumed_at is null
      returning q.member_id into v_reissued;
    end if;
    new.member_id:=coalesce(v_reissued,public.generate_member_id());
  end if;
  return new;
end;
$$;

revoke all on function public.member_id_gap_evidence(text) from public,anon,authenticated;
revoke all on function public.member_id_gap_scan_system() from public,anon,authenticated;
revoke all on function public.member_id_gap_scan(uuid) from public,anon,authenticated;
revoke all on function public.member_id_approve_gaps(uuid,text[],text,boolean) from public,anon,authenticated;
revoke all on function public.member_id_release_archived_error(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.member_id_gap_scan(uuid) to service_role;
grant execute on function public.member_id_approve_gaps(uuid,text[],text,boolean) to service_role;
grant execute on function public.member_id_release_archived_error(uuid,uuid,text) to service_role;
-- Background scanner is restricted to the database owner (cron execution).
grant execute on function public.member_id_gap_scan_system() to postgres;

commit;
