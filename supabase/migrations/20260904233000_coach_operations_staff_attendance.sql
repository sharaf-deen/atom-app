-- Coach Operations Lot 1D — Coach & Assistant Attendance QR
-- Staff QR attendance is stored separately from member attendance.
-- Schedule remains unchanged; completed Training Logs can be correlated by staff/date in the UI.

begin;

create table if not exists public.coach_staff_attendance (
  id uuid primary key default gen_random_uuid(),
  staff_user_id uuid not null references auth.users(id) on delete restrict,
  staff_name_snapshot text not null,
  staff_member_id_snapshot text null,
  staff_role_snapshot text not null,
  attendance_date date not null,
  checked_in_at timestamptz not null default now(),
  scanned_by uuid null references auth.users(id) on delete set null,
  device_tag text null,
  source text not null default 'kiosk_qr',
  created_at timestamptz not null default now(),
  constraint coach_staff_attendance_name_length
    check (char_length(btrim(staff_name_snapshot)) between 1 and 180),
  constraint coach_staff_attendance_role_check
    check (staff_role_snapshot in ('assistant_coach','coach','head_coach','super_admin')),
  constraint coach_staff_attendance_source_check
    check (source in ('kiosk_qr'))
);

create index if not exists coach_staff_attendance_staff_date_idx
  on public.coach_staff_attendance (staff_user_id, attendance_date desc, checked_in_at desc);

create index if not exists coach_staff_attendance_date_idx
  on public.coach_staff_attendance (attendance_date desc, checked_in_at desc);

alter table public.coach_staff_attendance enable row level security;

grant select on public.coach_staff_attendance to authenticated;
revoke insert, update, delete on public.coach_staff_attendance from authenticated;

-- Assistant Coach / Coach can read only their own QR attendance.
-- Head Coach / Super Admin can read all coaching staff attendance.
drop policy if exists coach_staff_attendance_read_coaching_staff on public.coach_staff_attendance;
create policy coach_staff_attendance_read_coaching_staff
on public.coach_staff_attendance
for select to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.user_id = auth.uid()
      and (
        p.role::text = any (array['head_coach','super_admin']::text[])
        or (
          p.role::text = any (array['assistant_coach','coach']::text[])
          and coach_staff_attendance.staff_user_id = auth.uid()
        )
      )
  )
);

comment on table public.coach_staff_attendance is
  'Coach Operations: QR check-ins for coaching staff, intentionally separate from member attendance.';

comment on column public.coach_staff_attendance.attendance_date is
  'Local Cairo calendar date of the staff QR check-in.';

comment on column public.coach_staff_attendance.checked_in_at is
  'Exact timestamp of the staff QR check-in. The scanner suppresses another row for the same staff member within two hours.';

commit;
