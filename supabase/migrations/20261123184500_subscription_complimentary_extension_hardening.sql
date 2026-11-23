-- Harden paid-end snapshot and grant audit against accidental/unauthorized direct edits.
create or replace function public.atom_preserve_paid_membership_coverage_v1()
returns trigger language plpgsql set search_path='public','pg_temp' as $$
declare is_grant boolean:=coalesce(current_setting('atom.complimentary_extension_operation',true),'')='1';
begin
 if not is_grant and old.paid_end_date is null and new.paid_end_date is not null then
   raise exception 'PAID_END_SNAPSHOT_RESTRICTED' using errcode='42501';
 end if;
 if not is_grant and old.paid_end_date is not null then
   if new.end_date is distinct from old.end_date then
     new.paid_end_date:=old.paid_end_date+(new.end_date-old.end_date);
   elsif new.paid_end_date is distinct from old.paid_end_date then
     raise exception 'PAID_END_EDIT_RESTRICTED' using errcode='42501';
   end if;
 end if;
 if new.paid_end_date is not null and new.end_date is not null and new.paid_end_date>new.end_date then
   raise exception 'PAID_END_EXCEEDS_ACCESS_END' using errcode='23514';
 end if;
 return new;
end $$;

create or replace function public.atom_complimentary_grant_immutable_guard_v1()
returns trigger language plpgsql set search_path='public','pg_temp' as $$
begin
 if tg_op='DELETE' then
   raise exception 'COMPLIMENTARY_HISTORY_IMMUTABLE' using errcode='42501';
 end if;
 if tg_op='UPDATE' then
   if old.reversed_at is not null or new.reversed_at is null
     or new.id is distinct from old.id
     or new.subscription_id is distinct from old.subscription_id
     or new.request_key is distinct from old.request_key
     or new.days is distinct from old.days
     or new.reason is distinct from old.reason
     or new.internal_note is distinct from old.internal_note
     or new.granted_by is distinct from old.granted_by
     or new.granted_at is distinct from old.granted_at
     or new.previous_end_date is distinct from old.previous_end_date
     or new.resulting_end_date is distinct from old.resulting_end_date
   then
     raise exception 'COMPLIMENTARY_HISTORY_IMMUTABLE' using errcode='42501';
   end if;
 end if;
 return new;
end $$;
drop trigger if exists atom_complimentary_grant_immutable_guard_v1 on public.subscription_complimentary_extensions;
create trigger atom_complimentary_grant_immutable_guard_v1
  before update or delete on public.subscription_complimentary_extensions
  for each row execute function public.atom_complimentary_grant_immutable_guard_v1();

create index if not exists subscription_complimentary_granted_by_idx
 on public.subscription_complimentary_extensions(granted_by);
create index if not exists subscription_complimentary_reversed_by_idx
 on public.subscription_complimentary_extensions(reversed_by) where reversed_by is not null;

revoke all on function public.atom_preserve_paid_membership_coverage_v1() from public,anon,authenticated;
revoke all on function public.atom_complimentary_grant_immutable_guard_v1() from public,anon,authenticated;
