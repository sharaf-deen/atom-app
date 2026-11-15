-- Additional validation: subscription creation emits notification records; preserve their history during owner recovery.
begin;
create or replace function public.family_duplicate_recovery_preview(
  p_family_id uuid,
  p_guardian_auth_user_id uuid,
  p_member_ids text[]
)
returns jsonb
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  v_guardian public.family_guardians%rowtype;
  v_profile public.profiles%rowtype;
  v_seen text[] := array[]::text[];
  v_id text;
  v_blockers jsonb := '[]'::jsonb;
  v_record record;
  v_exists boolean;
  v_member_user_ids uuid[] := array[]::uuid[];
  v_subscription_count integer := 0;
  v_payment_count integer := 0;
  v_invoice_count integer := 0;
  v_financial_source uuid;
  v_attnum smallint;
begin
  if p_family_id is null or p_guardian_auth_user_id is null
     or coalesce(array_length(p_member_ids,1),0) <> 2
     or p_member_ids[1] = p_member_ids[2] then
    raise exception 'INVALID_RECOVERY_SELECTION';
  end if;
  select * into v_guardian from public.family_guardians
  where family_id = p_family_id and auth_user_id = p_guardian_auth_user_id;
  if not found then raise exception 'GUARDIAN_NOT_FOUND'; end if;
  if exists(select 1 from public.profiles where user_id = p_guardian_auth_user_id) then
    v_blockers := v_blockers || jsonb_build_array('GUARDIAN_ALREADY_MEMBER');
  end if;
  if exists(select 1 from public.profiles
    where email is not null and lower(btrim(email))=lower(btrim(v_guardian.email))
      and user_id<>p_guardian_auth_user_id) then
    v_blockers := v_blockers || jsonb_build_array('GUARDIAN_EMAIL_CONFLICT');
  end if;

  select attnum into v_attnum from pg_catalog.pg_attribute
  where attrelid='public.profiles'::regclass and attname='user_id' and not attisdropped;

  foreach v_id in array p_member_ids loop
    if v_id is null or btrim(v_id)='' or v_id=any(v_seen) then
      raise exception 'INVALID_MEMBER_ID';
    end if;
    v_seen := array_append(v_seen,v_id);
    select p.* into v_profile
    from public.profiles p join public.family_members fm on fm.member_id=p.user_id
    where fm.family_id=p_family_id and p.member_id=v_id;
    if not found then raise exception 'FAMILY_MEMBER_ID_NOT_FOUND: %',v_id; end if;
    v_member_user_ids := array_append(v_member_user_ids,v_profile.user_id);
    if v_profile.archived_at is not null then
      v_blockers := v_blockers || jsonb_build_array(v_id || ':ALREADY_ARCHIVED');
    end if;
    if coalesce(v_profile.role,'')<>'member' then
      v_blockers := v_blockers || jsonb_build_array(v_id || ':NOT_A_MEMBER_ROLE');
    end if;
    if nullif(btrim(coalesce(v_profile.email,'')),'') is not null then
      v_blockers := v_blockers || jsonb_build_array(v_id || ':HAS_LOGIN_EMAIL');
    end if;
    if lower(btrim(coalesce(v_profile.first_name,''))) <> lower(btrim(coalesce(v_guardian.first_name,'')))
       or lower(btrim(coalesce(v_profile.last_name,''))) <> lower(btrim(coalesce(v_guardian.last_name,''))) then
      v_blockers := v_blockers || jsonb_build_array(v_id || ':NAME_MISMATCH_GUARDIAN');
    end if;
    -- Block if any FK-referencing records exist (except the family link being removed).
    -- Never silently reassign attendance, payments, belt history, legal records, etc.
    for v_record in
      select ns.nspname as schema_name, rel.relname as table_name, a.attname as column_name
      from pg_catalog.pg_constraint c
      join pg_catalog.pg_class rel on rel.oid=c.conrelid
      join pg_catalog.pg_namespace ns on ns.oid=rel.relnamespace
      join pg_catalog.pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
      where c.contype='f' and c.confrelid='public.profiles'::regclass
        and array_length(c.conkey,1)=1 and array_length(c.confkey,1)=1
        and c.confkey[1]=v_attnum
        and not (ns.nspname='public' and rel.relname='family_members' and a.attname='member_id')
    loop
      execute format('select exists(select 1 from %I.%I where %I=$1 limit 1)',
        v_record.schema_name,v_record.table_name,v_record.column_name)
      into v_exists using v_profile.user_id;
      if v_exists then
        if v_record.schema_name='public' and v_record.column_name='member_id'
           and v_record.table_name in ('subscriptions','subscription_payments','invoices','notifications') then
          -- Allowed only if the explicitly validated financial unit can be transferred atomically.
          null;
        else
          v_blockers := v_blockers || jsonb_build_array(v_id || ':' || v_record.table_name || '.' || v_record.column_name);
        end if;
      end if;
    end loop;
  end loop;
  select count(*) into v_subscription_count
  from public.subscriptions where member_id=any(v_member_user_ids);
  select member_id into v_financial_source
  from public.subscriptions where member_id=any(v_member_user_ids) limit 1;
  select count(*) into v_payment_count from public.subscription_payments
  where member_id=any(v_member_user_ids);
  select count(*) into v_invoice_count from public.invoices
  where member_id=any(v_member_user_ids);

  if v_subscription_count>1 then
    v_blockers:=v_blockers || jsonb_build_array('MORE_THAN_ONE_SUBSCRIPTION');
  elsif v_subscription_count=0 and (v_payment_count>0 or v_invoice_count>0) then
    v_blockers:=v_blockers || jsonb_build_array('ORPHAN_FINANCIAL_RECORDS');
  elsif v_subscription_count=1 then
    if exists(select 1 from public.subscription_payments sp
      where sp.member_id=any(v_member_user_ids)
        and (sp.member_id<>v_financial_source or sp.subscription_id is distinct from
          (select id from public.subscriptions where member_id=v_financial_source limit 1)))
      or exists(select 1 from public.invoices i
      where i.member_id=any(v_member_user_ids)
        and (i.member_id<>v_financial_source or i.subscription_id is distinct from
          (select id from public.subscriptions where member_id=v_financial_source limit 1))) then
      v_blockers:=v_blockers || jsonb_build_array('FINANCIAL_OWNERSHIP_MISMATCH');
    end if;
    if exists(select 1 from public.subscriptions
      where member_id=v_financial_source
        and status not in ('active','expired','completed','cancelled','frozen')) then
      v_blockers:=v_blockers || jsonb_build_array('UNSUPPORTED_SUBSCRIPTION_STATUS');
    end if;
  end if;
  return jsonb_build_object(
    'financial_transfer',jsonb_build_object('subscriptions',v_subscription_count,'payments',v_payment_count,'invoices',v_invoice_count),
    'can_recover', jsonb_array_length(v_blockers)=0,
    'blockers',v_blockers,
    'family_id',p_family_id,
    'guardian_auth_user_id',p_guardian_auth_user_id,
    'archived_member_ids',p_member_ids,
    'profile_user_ids',v_member_user_ids,
    'existing_login_preserved',true
  );
end;
$$;

create or replace function public.family_duplicate_recovery_execute(
  p_family_id uuid,
  p_guardian_auth_user_id uuid,
  p_member_ids text[],
  p_actor_id uuid,
  p_reason text
)
returns jsonb
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  v_preview jsonb;
  v_result jsonb;
  v_ids uuid[];
  v_count integer;
  v_member_id text;
  v_financial_before jsonb;
  v_financial_after jsonb;
begin
  if p_actor_id is null or nullif(btrim(coalesce(p_reason,'')),'') is null then
    raise exception 'REASON_AND_ACTOR_REQUIRED';
  end if;
  -- Serializes all recovery operations on one family.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_family_id::text,1389));
  v_preview:=public.family_duplicate_recovery_preview(p_family_id,p_guardian_auth_user_id,p_member_ids);
  if not coalesce((v_preview->>'can_recover')::boolean,false) then
    raise exception 'RECOVERY_BLOCKED: %',v_preview->'blockers';
  end if;
  v_ids:=array(select jsonb_array_elements_text(v_preview->'profile_user_ids')::uuid);
  -- Hold both member rows against concurrent changes.
  perform 1 from public.profiles p where p.user_id=any(v_ids) for update;
  v_preview:=public.family_duplicate_recovery_preview(p_family_id,p_guardian_auth_user_id,p_member_ids);
  if not coalesce((v_preview->>'can_recover')::boolean,false) then
    raise exception 'RECOVERY_BLOCKED_AFTER_LOCK: %',v_preview->'blockers';
  end if;

  -- Capture immutable pre-transfer evidence, including the exact issued invoice snapshot.
  select jsonb_build_object(
    'subscriptions',coalesce((select jsonb_agg(to_jsonb(x)) from public.subscriptions x where x.member_id=any(v_ids)),'[]'::jsonb),
    'payments',coalesce((select jsonb_agg(to_jsonb(x)) from public.subscription_payments x where x.member_id=any(v_ids)),'[]'::jsonb),
    'invoices',coalesce((select jsonb_agg(to_jsonb(x)) from public.invoices x where x.member_id=any(v_ids)),'[]'::jsonb),
    'notifications',coalesce((select jsonb_agg(to_jsonb(x)) from public.notifications x where x.member_id=any(v_ids)),'[]'::jsonb)
  ) into v_financial_before;

  update public.profiles
  set archived_at=now(), archive_reason='CREATED_IN_ERROR: '||left(btrim(p_reason),450)
  where user_id=any(v_ids) and archived_at is null;
  get diagnostics v_count = row_count;
  if v_count<>2 then raise exception 'ARCHIVE_ROW_COUNT_MISMATCH'; end if;

  delete from public.family_members
  where family_id=p_family_id and member_id=any(v_ids);
  get diagnostics v_count = row_count;
  if v_count<>2 then raise exception 'UNLINK_ROW_COUNT_MISMATCH'; end if;

  v_result:=public.family_guardian_promote_to_member(p_family_id,p_guardian_auth_user_id,p_actor_id);
  v_member_id:=v_result->>'member_id';

  -- Source records remain intact for audit; only ownership references are moved.
  update public.subscriptions set member_id=p_guardian_auth_user_id where member_id=any(v_ids);
  update public.subscription_payments set member_id=p_guardian_auth_user_id where member_id=any(v_ids);
  update public.invoices set member_id=p_guardian_auth_user_id where member_id=any(v_ids);
  update public.notifications set member_id=p_guardian_auth_user_id where member_id=any(v_ids);

  select jsonb_build_object(
    'subscriptions',coalesce((select jsonb_agg(to_jsonb(x)) from public.subscriptions x where x.member_id=p_guardian_auth_user_id),'[]'::jsonb),
    'payments',coalesce((select jsonb_agg(to_jsonb(x)) from public.subscription_payments x where x.member_id=p_guardian_auth_user_id),'[]'::jsonb),
    'invoices',coalesce((select jsonb_agg(to_jsonb(x)) from public.invoices x where x.member_id=p_guardian_auth_user_id),'[]'::jsonb),
    'notifications',coalesce((select jsonb_agg(to_jsonb(x)) from public.notifications x where x.member_id=p_guardian_auth_user_id),'[]'::jsonb)
  ) into v_financial_after;

  insert into public.family_duplicate_recovery_audit
    (family_id,guardian_auth_user_id,archived_profile_user_ids,archived_member_ids,created_member_id,performed_by,reason,
     financial_before,financial_after)
  values
    (p_family_id,p_guardian_auth_user_id,v_ids,p_member_ids,v_member_id,p_actor_id,left(btrim(p_reason),1000),
     v_financial_before,v_financial_after);
  return jsonb_build_object('ok',true,'guardian_member',v_result,'reserved_ids',p_member_ids);
end;
$$;

revoke all on function public.family_duplicate_recovery_preview(uuid,uuid,text[]) from public,anon,authenticated;
grant execute on function public.family_duplicate_recovery_preview(uuid,uuid,text[]) to service_role;

revoke all on function public.family_duplicate_recovery_preview(uuid,uuid,text[]) from public,anon,authenticated;
grant execute on function public.family_duplicate_recovery_preview(uuid,uuid,text[]) to service_role;

revoke all on function public.family_duplicate_recovery_preview(uuid,uuid,text[]) from public,anon,authenticated;
grant execute on function public.family_duplicate_recovery_preview(uuid,uuid,text[]) to service_role;
revoke all on function public.family_duplicate_recovery_execute(uuid,uuid,text[],uuid,text) from public,anon,authenticated;
grant execute on function public.family_duplicate_recovery_execute(uuid,uuid,text[],uuid,text) to service_role;
commit;
