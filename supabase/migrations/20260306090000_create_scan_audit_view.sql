-- Create/replace a view for kiosk scan audit (member + scanner details)
-- Idempotent + safe to re-run.

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

  -- Member details
  m.member_id as member_code,
  m.email as member_email,
  m.first_name as member_first_name,
  m.last_name as member_last_name,
  m.role as member_role,

  -- Scanner (staff) details (may be null if scan not performed by staff)
  s.email as scanned_by_email,
  s.first_name as scanned_by_first_name,
  s.last_name as scanned_by_last_name,
  s.role as scanned_by_role

from public.attendance a
left join public.profiles m on m.user_id = a.member_id
left join public.profiles s on s.user_id = a.scanned_by
where a.source = 'kiosk';

comment on view public.scan_audit is 'Kiosk scan audit (attendance + member + scanner profile details)';
