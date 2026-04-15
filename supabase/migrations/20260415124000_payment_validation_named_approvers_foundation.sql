-- Payments reconciliation named approvers foundation
-- Activates obvious named approver profiles when they can be matched safely,
-- and exposes a human-readable view for the reconciliation UI.

begin;

insert into public.payment_validation_approvers (
  user_id,
  is_active,
  note,
  created_at,
  updated_at
)
select
  p.user_id,
  true,
  case
    when lower(coalesce(p.first_name, '')) = 'shehab' then 'Named approver foundation seed: Shehab'
    when lower(coalesce(p.first_name, '')) = 'shawki' then 'Named approver foundation seed: Shawki'
    when public.is_super_admin(p.user_id) then 'Named approver foundation seed: Super Admin'
    else 'Named approver foundation seed'
  end,
  now(),
  now()
from public.profiles p
where p.role in ('admin', 'super_admin')
  and (
    lower(coalesce(p.first_name, '')) in ('shehab', 'shawki')
    or public.is_super_admin(p.user_id)
  )
on conflict (user_id) do update
set
  is_active = true,
  updated_at = now(),
  note = case
    when coalesce(public.payment_validation_approvers.note, '') = '' then excluded.note
    else public.payment_validation_approvers.note
  end;

create or replace view public.payment_validation_approver_profiles_v1 as
select
  a.user_id,
  a.is_active,
  a.note,
  a.created_at,
  a.updated_at,
  p.role,
  p.email,
  p.first_name,
  p.last_name,
  case
    when btrim(concat_ws(' ', coalesce(p.first_name, ''), coalesce(p.last_name, ''))) <> '' then btrim(concat_ws(' ', coalesce(p.first_name, ''), coalesce(p.last_name, '')))
    when coalesce(p.email, '') <> '' then p.email
    else a.user_id::text
  end as display_name,
  case
    when lower(coalesce(p.first_name, '')) = 'shehab' then 'shehab'
    when lower(coalesce(p.first_name, '')) = 'shawki' then 'shawki'
    when public.is_super_admin(a.user_id) then 'sharaf_deen'
    else null
  end as named_key,
  public.is_super_admin(a.user_id) as is_super_admin
from public.payment_validation_approvers a
join public.profiles p on p.user_id = a.user_id
where a.is_active = true;

commit;
