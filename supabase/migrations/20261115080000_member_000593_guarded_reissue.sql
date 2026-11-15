-- Release only the historical Hemmali duplicate ATOM-000593 after transferring
-- the remaining idempotency FK to the actual account without losing original attribution.
-- This migration NEVER deletes Production data on deployment.
begin;
alter table public.member_id_reissue_queue drop constraint member_id_reissue_single_target;
alter table public.member_id_reissue_queue
  add constraint member_id_reissue_single_target
  check (member_id in ('ATOM-000593','ATOM-000595'));
alter table public.member_id_reissue_queue
  add column if not exists release_evidence jsonb not null default '{}'::jsonb;
alter table public.atom_subscription_idempotency
  add column if not exists original_member_user_id uuid;

create or replace function public.release_erroneous_atom_000593(
  p_actor_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_old constant uuid := 'fcbcd098-492b-4cea-84da-4afda7449c81'::uuid;
  v_parent constant uuid := 'ffa91e22-0b8a-4bd1-af46-063da811edfc'::uuid;
  v_profile public.profiles%rowtype;
  v_parent_profile public.profiles%rowtype;
  v_request public.atom_subscription_idempotency%rowtype;
  v_request_count bigint;
  v_fk record;
  v_count bigint;
  v_deleted bigint;
  v_audit jsonb;
begin
  if p_actor_id is null or length(btrim(coalesce(p_reason,''))) < 15 then
    raise exception 'ACTOR_AND_REASON_REQUIRED';
  end if;
  if not exists(
    select 1 from public.profiles
    where user_id=p_actor_id and role='super_admin' and archived_at is null
  ) then
    raise exception 'SUPER_ADMIN_REQUIRED';
  end if;
  if exists(select 1 from public.member_id_reissue_queue where member_id='ATOM-000593') then
    raise exception 'ALREADY_RELEASED';
  end if;
  -- Serialise this correction and protect both source and recipient profiles.
  perform pg_advisory_xact_lock(pg_catalog.hashtextextended('atom-000593-release',593));
  select * into strict v_profile from public.profiles
    where member_id='ATOM-000593' for update;
  select * into strict v_parent_profile from public.profiles
    where user_id=v_parent for update;
  if v_profile.user_id<>v_old or v_profile.archived_at is null
     or v_profile.role<>'member' or v_profile.email is not null
     or v_profile.first_name<>'Mehdi' or v_profile.last_name<>'Hemmali'
     or coalesce(v_profile.archive_reason,'') not ilike 'CREATED_IN_ERROR:%'
     or v_parent_profile.member_id<>'ATOM-000596'
     or v_parent_profile.archived_at is not null then
    raise exception 'IDENTITY_OR_ARCHIVE_MISMATCH';
  end if;
  if exists(select 1 from auth.users where id=v_old)
     or exists(select 1 from public.family_members where member_id=v_old)
     or exists(select 1 from public.family_guardians where auth_user_id=v_old)
  then
    raise exception 'AUTH_OR_FAMILY_DEPENDENCY';
  end if;
  if not exists(select 1 from public.family_duplicate_recovery_audit a
    where v_old=any(a.archived_profile_user_ids)
      and 'ATOM-000593'=any(a.archived_member_ids)
      and a.created_member_id='ATOM-000596'
      and a.guardian_auth_user_id=v_parent) then
    raise exception 'ORIGINAL_RECOVERY_AUDIT_MISSING';
  end if;

  select count(*) into v_request_count from public.atom_subscription_idempotency
    where member_id=v_old;
  if v_request_count<>1 then
    raise exception 'UNEXPECTED_ORIGINAL_IDEMPOTENCY_COUNT: %',v_request_count;
  end if;
  select * into strict v_request from public.atom_subscription_idempotency
    where member_id=v_old for update;
  if v_request.operation<>'create'
     or v_request.original_member_user_id is not null
     or not exists (
       select 1 from public.subscriptions s
       where s.id=v_request.subscription_id and s.member_id=v_parent
     ) then
    raise exception 'ORIGINAL_SUBSCRIPTION_PROVENANCE_MISMATCH';
  end if;
  -- Block all other FK references before altering even the idempotency reference.
  for v_fk in
    select n.nspname schema_name,r.relname table_name,a.attname column_name
    from pg_catalog.pg_constraint c
    join pg_catalog.pg_class r on r.oid=c.conrelid
    join pg_catalog.pg_namespace n on n.oid=r.relnamespace
    join pg_catalog.pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
    join pg_catalog.pg_attribute p on p.attrelid=c.confrelid and p.attnum=c.confkey[1]
    where c.contype='f' and c.confrelid='public.profiles'::regclass
      and array_length(c.conkey,1)=1 and array_length(c.confkey,1)=1
      and p.attname='user_id'
  loop
    execute format('select count(*) from %I.%I where %I=$1',
      v_fk.schema_name,v_fk.table_name,v_fk.column_name)
    into v_count using v_old;
    if v_count>0 and not (
      v_fk.schema_name='public' and v_fk.table_name='atom_subscription_idempotency'
      and v_fk.column_name='member_id' and v_count=1
    ) then
      raise exception 'DEPENDENCY_BLOCKED: %.% (% rows)',v_fk.table_name,v_fk.column_name,v_count;
    end if;
  end loop;
  -- Non-FK historical IDs must also be absent.
  if exists(select 1 from public.scan_audit where member_code='ATOM-000593')
     or exists(select 1 from public.store_sales where buyer_member_id='ATOM-000593')
     or exists(select 1 from public.coach_staff_attendance where staff_member_id_snapshot='ATOM-000593') then
    raise exception 'TEXTUAL_HISTORY_DEPENDENCY_BLOCKED';
  end if;

  v_audit:=jsonb_build_object(
    'former_member_user_id',v_old,
    'current_member_user_id',v_parent,
    'subscription_id',v_request.subscription_id,
    'request_key',v_request.request_key,
    'request_hash',v_request.request_hash,
    'operation',v_request.operation,
    'original_created_at',v_request.created_at
  );
  -- Do not delete or recreate the historical request. Keep the request key,
  -- hash, actor, subscription and created_at unchanged, and permanently retain
  -- its original member UUID next to the corrected current member reference.
  update public.atom_subscription_idempotency
  set original_member_user_id=v_old, member_id=v_parent
  where request_key=v_request.request_key and member_id=v_old;
  get diagnostics v_count=row_count;
  if v_count<>1 then raise exception 'IDEMPOTENCY_TRANSFER_COUNT_MISMATCH'; end if;

  delete from public.profiles
  where user_id=v_old and member_id='ATOM-000593' and archived_at is not null;
  get diagnostics v_deleted=row_count;
  if v_deleted<>1 then raise exception 'PROFILE_DELETE_COUNT_MISMATCH'; end if;

  insert into public.member_id_reissue_queue
    (member_id,original_profile_user_id,released_by,release_reason,release_evidence)
  values('ATOM-000593',v_old,p_actor_id,left(btrim(p_reason),1000),v_audit);

  return jsonb_build_object(
    'ok',true,'released_member_id','ATOM-000593',
    'original_profile_deleted',true,
    'idempotency_preserved',true,
    'idempotency_original_member_user_id',v_old,
    'idempotency_current_member_user_id',v_parent
  );
end;
$$;
revoke all on function public.release_erroneous_atom_000593(uuid,text)
  from public,anon,authenticated;
grant execute on function public.release_erroneous_atom_000593(uuid,text)
  to service_role;
commit;
