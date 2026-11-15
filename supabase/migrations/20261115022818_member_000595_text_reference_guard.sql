-- Fail-closed for existing non-FK textual member ID snapshots before releasing 000595.
begin;
create or replace function public.release_erroneous_atom_000595(
  p_actor_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_record public.profiles%rowtype;
  v_fk record;
  v_fk_count bigint;
  v_deleted bigint;
begin
  if p_actor_id is null or length(btrim(coalesce(p_reason,'')))<15 then
    raise exception 'ACTOR_AND_REASON_REQUIRED';
  end if;
  if not exists (
    select 1 from public.profiles
    where user_id=p_actor_id and role='super_admin' and archived_at is null
  ) then
    raise exception 'SUPER_ADMIN_REQUIRED';
  end if;
  if exists(select 1 from public.member_id_reissue_queue where member_id='ATOM-000595') then
    raise exception 'ALREADY_RELEASED';
  end if;
  select * into strict v_record from public.profiles
  where member_id='ATOM-000595'
  for update;
  if v_record.user_id <> 'edc76e9e-d382-46cc-87b3-05cbda1e660f'::uuid
     or v_record.archived_at is null
     or v_record.role<>'member'
     or v_record.email is not null
     or coalesce(v_record.archive_reason,'') not ilike 'CREATED_IN_ERROR:%'
     or v_record.first_name<>'Mehdi' or v_record.last_name<>'Hemmali'
  then
    raise exception 'NOT_ORIGINAL_ARCHIVED_DUPLICATE';
  end if;
  if exists(select 1 from auth.users where id=v_record.user_id)
     or exists(select 1 from public.family_members where member_id=v_record.user_id)
     or exists(select 1 from public.family_guardians where auth_user_id=v_record.user_id)
  then
    raise exception 'AUTH_OR_FAMILY_DEPENDENCY';
  end if;
  -- Fail closed on ALL single-column FK dependencies, including newer tables.
  for v_fk in
    select n.nspname as schema_name, r.relname as table_name, a.attname as column_name
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
    into v_fk_count using v_record.user_id;
    if v_fk_count>0 then
      raise exception 'DEPENDENCY_BLOCKED: %.% (% rows)',v_fk.table_name,v_fk.column_name,v_fk_count;
    end if;
  end loop;
  -- Non-FK textual snapshots require an explicit check as they are not caught above.
  -- head_coach_athlete_roster is a derived view of profiles, not persisted history.
  if exists(select 1 from public.scan_audit where member_code='ATOM-000595')
     or exists(select 1 from public.store_sales where buyer_member_id='ATOM-000595')
     or exists(select 1 from public.coach_staff_attendance where staff_member_id_snapshot='ATOM-000595')
  then
    raise exception 'TEXTUAL_HISTORY_DEPENDENCY_BLOCKED';
  end if;

  -- Require historical context for the original profile; do not rewrite it.
  if not exists(select 1 from public.family_duplicate_recovery_audit
    where v_record.user_id=any(archived_profile_user_ids)
      and 'ATOM-000595'=any(archived_member_ids)) then
    raise exception 'ORIGINAL_RECOVERY_AUDIT_MISSING';
  end if;

  delete from public.profiles
  where user_id=v_record.user_id and member_id='ATOM-000595'
  and archived_at is not null;
  get diagnostics v_deleted=row_count;
  if v_deleted<>1 then raise exception 'PROFILE_DELETE_COUNT_MISMATCH'; end if;

  insert into public.member_id_reissue_queue
    (member_id,original_profile_user_id,released_by,release_reason)
  values('ATOM-000595',v_record.user_id,p_actor_id,left(btrim(p_reason),1000));
  return jsonb_build_object('ok',true,'released_member_id','ATOM-000595','original_profile_deleted',true);
end;
$$;

revoke all on function public.release_erroneous_atom_000595(uuid,text) from public,anon,authenticated;
grant execute on function public.release_erroneous_atom_000595(uuid,text) to service_role;
commit;
