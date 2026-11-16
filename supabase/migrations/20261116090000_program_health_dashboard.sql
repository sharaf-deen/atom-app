-- Program Health 1A: dashboard configuration and read-only aggregate, Super Admin only.
-- No mutations to subscriptions, enrollments or financial records.
begin;
create table if not exists public.atom_program_health_settings (
 program_key text primary key references public.member_program_catalog(key) on update cascade on delete cascade,
 target_capacity integer,
 warning_percent integer not null default 80,
 management_note text not null default '',
 updated_at timestamptz not null default now(),
 updated_by uuid,
 constraint program_health_capacity_valid check(target_capacity is null or target_capacity between 1 and 500),
 constraint program_health_warning_valid check(warning_percent between 50 and 100),
 constraint program_health_note_valid check(length(management_note)<=2000)
);
create table if not exists public.atom_program_health_settings_audit(
 id bigint generated always as identity primary key,
 program_key text not null,
 old_values jsonb not null,
 new_values jsonb not null,
 changed_by uuid not null,
 changed_at timestamptz not null default now()
);
alter table public.atom_program_health_settings enable row level security;
alter table public.atom_program_health_settings_audit enable row level security;
revoke all on public.atom_program_health_settings from public,anon,authenticated;
revoke all on public.atom_program_health_settings_audit from public,anon,authenticated;
grant select on public.atom_program_health_settings to service_role;
grant select on public.atom_program_health_settings_audit to service_role;

create or replace function public.atom_program_health_update(
 p_actor uuid,p_program_key text,p_capacity integer,p_warning_percent integer,p_note text
) returns jsonb
language plpgsql security definer set search_path=public,pg_catalog
as $$
declare v_previous jsonb; v_next jsonb;
begin
 if not exists(select 1 from public.profiles where user_id=p_actor and role='super_admin' and archived_at is null)
 then raise exception 'SUPER_ADMIN_REQUIRED';end if;
 if p_program_key is null or not exists(select 1 from public.member_program_catalog where key=p_program_key)
 then raise exception 'UNKNOWN_PROGRAM';end if;
 if (p_capacity is not null and (p_capacity<1 or p_capacity>500))
    or p_warning_percent is null or p_warning_percent<50 or p_warning_percent>100
    or length(coalesce(p_note,''))>2000 then raise exception 'INVALID_SETTINGS';end if;
 perform pg_advisory_xact_lock(hashtextextended('atom-program-health-'||p_program_key,0));
 select to_jsonb(s) into v_previous from public.atom_program_health_settings s where program_key=p_program_key;
 insert into public.atom_program_health_settings(program_key,target_capacity,warning_percent,management_note,updated_by)
 values(p_program_key,p_capacity,p_warning_percent,coalesce(p_note,''),p_actor)
 on conflict(program_key) do update set
 target_capacity=excluded.target_capacity,warning_percent=excluded.warning_percent,
 management_note=excluded.management_note,updated_at=now(),updated_by=p_actor;
 select to_jsonb(s) into v_next from public.atom_program_health_settings s where program_key=p_program_key;
 insert into public.atom_program_health_settings_audit(program_key,old_values,new_values,changed_by)
 values(p_program_key,coalesce(v_previous,'{}'::jsonb),v_next,p_actor);
 return jsonb_build_object('ok',true,'program_key',p_program_key);
end;
$$;

create or replace function public.atom_program_health_snapshot(p_actor uuid)
returns jsonb
language plpgsql security definer set search_path=public,pg_catalog
as $$
declare v_data jsonb;
begin
 if not exists(select 1 from public.profiles where user_id=p_actor and role='super_admin' and archived_at is null)
 then raise exception 'SUPER_ADMIN_REQUIRED';end if;
 with
 today as (select (now() at time zone 'Africa/Cairo')::date as current_day),
 current_enrollments as (
  select distinct on(e.member_user_id,e.program_key)
   e.member_user_id,e.program_key,e.started_at
  from public.member_program_enrollments e
  join public.profiles p on p.user_id=e.member_user_id and p.archived_at is null
  where e.is_current=true and e.ended_at is null and p.role in ('member','champion','vip')
  order by e.member_user_id,e.program_key,e.started_at desc
 ),
 counts_by_member as (
  select member_user_id,count(*)::numeric as program_count from current_enrollments group by member_user_id
 ),
 eligible_access as (
  select distinct s.member_id
  from public.subscriptions s cross join today t
  where s.status='active' and s.start_date<=t.current_day and s.end_date>=t.current_day
    and (coalesce(s.subscription_type,'')<>'sessions' or coalesce(s.remaining_classes,s.sessions_total-coalesce(s.sessions_used,0),0)>0)
 ),
 activity as (
  select distinct a.member_id from public.attendance a
  where a.valid=true and a.date >= (select current_day-29 from today)
    and a.date <= (select current_day from today)
 ),
 receipts as (
  select x.member_id,
    sum(case when coalesce(x.paid_at,x.created_at) >= now()-interval '30 days'
          and coalesce(x.paid_at,x.created_at)<=now() then x.amount else 0 end)::numeric as gross_30,
    sum(case when coalesce(x.paid_at,x.created_at) >= now()-interval '90 days'
          and coalesce(x.paid_at,x.created_at)<=now() then x.amount else 0 end)::numeric as gross_90
  from public.subscription_payments x
  where coalesce(x.paid_at,x.created_at)>=now()-interval '90 days'
    and coalesce(x.paid_at,x.created_at)<=now()
  group by x.member_id
 ),
 refunded as (
  select r.member_id,
    sum(case when coalesce(r.paid_at,r.refunded_at) >= now()-interval '30 days' then r.amount else 0 end)::numeric as refund_30,
    sum(case when coalesce(r.paid_at,r.refunded_at) >= now()-interval '90 days' then r.amount else 0 end)::numeric as refund_90
  from public.membership_refunds r
  where r.status in ('paid','refunded')
    and coalesce(r.paid_at,r.refunded_at)>=now()-interval '90 days'
    and coalesce(r.paid_at,r.refunded_at)<=now()
  group by r.member_id
 ),
 stats as (
  select e.program_key,
    count(*)::int enrolled,
    count(*) filter(where ac.member_id is not null)::int active,
    count(*) filter(where act.member_id is not null)::int visited_30,
    count(*) filter(where ac.member_id is null)::int inactive,
    round(sum(coalesce(rec.gross_30,0)/nullif(cm.program_count,0)),2) as gross_30,
    round(sum(coalesce(rec.gross_90,0)/nullif(cm.program_count,0)),2) as gross_90,
    round(sum((coalesce(rec.gross_30,0)-coalesce(ref.refund_30,0))/nullif(cm.program_count,0)),2) as net_30,
    round(sum((coalesce(rec.gross_90,0)-coalesce(ref.refund_90,0))/nullif(cm.program_count,0)),2) as net_90
  from current_enrollments e
  join counts_by_member cm on cm.member_user_id=e.member_user_id
  left join eligible_access ac on ac.member_id=e.member_user_id
  left join activity act on act.member_id=e.member_user_id
  left join receipts rec on rec.member_id=e.member_user_id
  left join refunded ref on ref.member_id=e.member_user_id
  group by e.program_key
 ),
 members as (
  select e.program_key,
   jsonb_agg(jsonb_build_object(
    'user_id',p.user_id,'member_id',p.member_id,
    'name',concat_ws(' ',p.first_name,p.last_name),
    'active',ac.member_id is not null,
    'visited_30',act.member_id is not null
   ) order by p.first_name,p.last_name) as member_rows
  from current_enrollments e
  join public.profiles p on p.user_id=e.member_user_id
  left join eligible_access ac on ac.member_id=e.member_user_id
  left join activity act on act.member_id=e.member_user_id
  group by e.program_key
 )
 select jsonb_build_object(
   'as_of',(select current_day from today),
   'methodology','Revenue allocation estimate: last 30/90 days net subscription cash payments less completed refunds, divided equally across each paying member current programs. Not historical program-level accounting. No private coaching, store, or expenses included.',
   'programs',coalesce(jsonb_agg(jsonb_build_object(
     'key',c.key,'name',c.name,'audience',c.audience,'level',c.level,'is_active',c.is_active,
     'target_capacity',settings.target_capacity,'warning_percent',coalesce(settings.warning_percent,80),
     'management_note',coalesce(settings.management_note,''),
     'enrolled',coalesce(s.enrolled,0),'active',coalesce(s.active,0),
     'inactive',coalesce(s.inactive,0),'visited_30',coalesce(s.visited_30,0),
     'gross_30',coalesce(s.gross_30,0),'gross_90',coalesce(s.gross_90,0),
     'net_30',coalesce(s.net_30,0),'net_90',coalesce(s.net_90,0),
     'members',coalesce(m.member_rows,'[]'::jsonb)
   ) order by c.sort_order,c.name),'[]'::jsonb)
 ) into v_data
 from public.member_program_catalog c
 left join stats s on s.program_key=c.key
 left join members m on m.program_key=c.key
 left join public.atom_program_health_settings settings on settings.program_key=c.key;
 return v_data;
end;
$$;

revoke all on function public.atom_program_health_update(uuid,text,integer,integer,text) from public,anon,authenticated;
revoke all on function public.atom_program_health_snapshot(uuid) from public,anon,authenticated;
grant execute on function public.atom_program_health_update(uuid,text,integer,integer,text) to service_role;
grant execute on function public.atom_program_health_snapshot(uuid) to service_role;
commit;
