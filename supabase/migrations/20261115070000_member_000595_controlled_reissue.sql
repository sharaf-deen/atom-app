-- Atom: one-off, audited release of ATOM-000595 only. No other historical IDs become reusable.
-- Deploy on Staging first. This migration does NOT delete any member automatically.
begin;

create table if not exists public.member_id_reissue_queue (
  member_id text primary key,
  original_profile_user_id uuid not null,
  released_by uuid not null,
  release_reason text not null,
  released_at timestamptz not null default now(),
  consumed_by_profile_user_id uuid,
  consumed_at timestamptz,
  constraint member_id_reissue_single_target check (member_id='ATOM-000595'),
  constraint member_id_reissue_consumed_together check
    ((consumed_by_profile_user_id is null)=(consumed_at is null))
);
alter table public.member_id_reissue_queue enable row level security;
revoke all on public.member_id_reissue_queue from public, anon, authenticated;
grant select,insert,update on public.member_id_reissue_queue to service_role;

-- A BEFORE INSERT trigger can allocate an available, released ID atomically.
-- Do not spend the released ID on an UPDATE, a staff profile, or an explicitly supplied ID.
create or replace function public.fill_member_id()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_reissued text;
begin
  if NEW.member_id is null or btrim(NEW.member_id)='' then
    if TG_OP='INSERT' and NEW.role='member' and NEW.archived_at is null then
      -- Row-level lock makes competing registrations wait; rollback restores availability.
      with candidate as (
        select q.member_id
        from public.member_id_reissue_queue q
        where q.consumed_at is null
          and not exists (select 1 from public.profiles p where p.member_id=q.member_id)
        order by q.released_at
        limit 1 for update of q
      )
      update public.member_id_reissue_queue q
      set consumed_by_profile_user_id=NEW.user_id, consumed_at=now()
      from candidate c
      where q.member_id=c.member_id and q.consumed_at is null
      returning q.member_id into v_reissued;
    end if;
    NEW.member_id:=coalesce(v_reissued,public.generate_member_id());
  end if;
  return NEW;
end;
$$;

-- Restricted release function: the mistake must be archived, unrelated to login,
-- and completely free of FK-based dependencies before deletion.
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
