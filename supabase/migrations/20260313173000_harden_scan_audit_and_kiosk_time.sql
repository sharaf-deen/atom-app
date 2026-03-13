-- Keep attendance status aligned with the kiosk flow.
do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'attendance_status_check'
      and conrelid = 'public.attendance'::regclass
  ) then
    alter table public.attendance drop constraint attendance_status_check;
  end if;
end $$;

alter table public.attendance
  add constraint attendance_status_check
  check (status = any (array['ok'::text, 'invalid'::text, 'expired'::text, 'frozen'::text, 'error'::text]));

create or replace view public.scan_audit as
select
  a.id,
  a.date,
  a.scanned_at,
  a.scan_time,
  a.status,
  a.valid,
  a.member_id,
  a.scanned_by,
  a.device_tag,
  a.source,
  m.member_id as member_code,
  m.email as member_email,
  m.first_name as member_first_name,
  m.last_name as member_last_name,
  m.role as member_role,
  s.email as scanned_by_email,
  s.first_name as scanned_by_first_name,
  s.last_name as scanned_by_last_name,
  s.role as scanned_by_role
from public.attendance a
left join public.profiles m on m.user_id = a.member_id
left join public.profiles s on s.user_id = a.scanned_by
where a.source = 'kiosk'
   or a.scanned_by is not null
   or a.device_tag is not null;

comment on view public.scan_audit is 'Kiosk scan audit (attendance + member + scanner profile details), resilient to legacy rows missing source=kiosk.';
