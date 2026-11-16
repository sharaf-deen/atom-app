-- Notifications UI performance 1A: server-paginated sent groups (read-only).
-- Sender-only soft-deletion remains unchanged and never deletes recipient messages.
begin;
create or replace function public.atom_notifications_sent_groups(
  p_actor uuid,
  p_page integer default 1,
  p_limit integer default 8,
  p_kind text default null,
  p_search text default null
) returns jsonb
language plpgsql security definer set search_path=public,pg_catalog
as $$
declare v_result jsonb;
begin
  if p_actor is null or not exists(
    select 1 from public.profiles
    where user_id=p_actor and role in ('admin','super_admin','head_coach') and archived_at is null
  ) then raise exception 'NOTIFICATION_SENDER_FORBIDDEN'; end if;
  if p_page is null or p_page<1 or p_page>10000
     or p_limit is null or p_limit<1 or p_limit>20
     or length(coalesce(p_kind,''))>32
     or length(coalesce(p_search,''))>80
  then raise exception 'NOTIFICATION_INVALID_FILTERS'; end if;

  with grouped as (
    select min(n.id::text) as id,
      min(n.created_at) as created_at,
      n.title, n.body, n.kind,
      count(*)::integer as recipient_count,
      array_agg(n.id order by n.created_at desc, n.id desc) as source_ids
    from public.notifications n
    where n.created_by=p_actor and n.deleted_for_sender_at is null
      and (nullif(p_kind,'') is null or n.kind=p_kind)
      and (nullif(p_search,'') is null
           or n.title ilike '%'||replace(replace(replace(p_search,'\\','\\\\'),'%','\\%'),'_','\\_')||'%' escape '\'
           or n.body ilike '%'||replace(replace(replace(p_search,'\\','\\\\'),'%','\\%'),'_','\\_')||'%' escape '\')
    group by date_trunc('second',n.created_at),n.title,n.body,n.kind
  ),
  paged as (
    select * from grouped
    order by created_at desc,id desc
    limit p_limit offset (p_page-1)*p_limit
  )
  select jsonb_build_object(
    'ok',true,
    'page',p_page,'pageSize',p_limit,
    'total',(select count(*) from grouped),
    'items',coalesce((select jsonb_agg(jsonb_build_object(
      'id',x.id,'created_at',x.created_at,
      'title',x.title,'body',x.body,'kind',x.kind,
      'recipient_count',x.recipient_count,
      'recipient_name',case when x.recipient_count=1 then '1 recipient' else x.recipient_count::text||' recipients' end,
      'source_ids',x.source_ids
    ) order by x.created_at desc,x.id desc) from paged x),'[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function public.atom_notifications_sent_groups(uuid,integer,integer,text,text)
  from public,anon,authenticated;
grant execute on function public.atom_notifications_sent_groups(uuid,integer,integer,text,text) to service_role;

-- Clear a user's own *read* inbox messages in one bounded-scope operation.
-- This is a personal soft delete. Underlying delivery/accounting records remain intact.
create or replace function public.atom_notifications_clear_read(p_actor uuid)
returns jsonb
language plpgsql security definer set search_path=public,pg_catalog
as $
declare v_count integer;
begin
  if p_actor is null or not exists(
    select 1 from public.profiles where user_id=p_actor and archived_at is null
  ) then raise exception 'NOTIFICATION_ACTOR_FORBIDDEN'; end if;
  update public.notifications
  set deleted_for_user_at=now()
  where user_id=p_actor and read_at is not null and deleted_for_user_at is null;
  get diagnostics v_count=row_count;
  return jsonb_build_object('ok',true,'removed',v_count);
end;
$;
revoke all on function public.atom_notifications_clear_read(uuid)
  from public,anon,authenticated;
grant execute on function public.atom_notifications_clear_read(uuid) to service_role;
commit;
