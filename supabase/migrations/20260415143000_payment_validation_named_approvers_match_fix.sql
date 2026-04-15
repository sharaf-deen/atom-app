-- Payments reconciliation named approvers match fix
-- Expands the named-approver matching rules so the known admin profiles
-- Shehab Younis and Mohamed Shawki are picked up safely.

begin;

with named_matches as (
  select
    p.user_id,
    p.role,
    p.email,
    p.first_name,
    p.last_name,
    lower(trim(coalesce(p.first_name, ''))) as first_name_norm,
    lower(trim(coalesce(p.last_name, ''))) as last_name_norm,
    lower(trim(coalesce(p.email, ''))) as email_norm,
    lower(regexp_replace(btrim(concat_ws(' ', coalesce(p.first_name, ''), coalesce(p.last_name, ''))), '\s+', ' ', 'g')) as full_name_norm,
    case
      when public.is_super_admin(p.user_id) then 'sharaf_deen'
      when lower(trim(coalesce(p.email, ''))) = 'shehab2ldin@gmail.com' then 'shehab'
      when lower(regexp_replace(btrim(concat_ws(' ', coalesce(p.first_name, ''), coalesce(p.last_name, ''))), '\s+', ' ', 'g')) = 'shehab younis' then 'shehab'
      when lower(trim(coalesce(p.first_name, ''))) = 'shehab' then 'shehab'
      when lower(trim(coalesce(p.email, ''))) = 'mshawki24@gmail.com' then 'shawki'
      when lower(regexp_replace(btrim(concat_ws(' ', coalesce(p.first_name, ''), coalesce(p.last_name, ''))), '\s+', ' ', 'g')) = 'mohamed shawki' then 'shawki'
      when lower(trim(coalesce(p.last_name, ''))) = 'shawki' then 'shawki'
      when lower(trim(coalesce(p.first_name, ''))) = 'shawki' then 'shawki'
      else null
    end as named_key
  from public.profiles p
  where p.role in ('admin', 'super_admin')
), named_seed as (
  select
    user_id,
    named_key,
    case
      when named_key = 'shehab' then 'Named approver foundation seed: Shehab Younis'
      when named_key = 'shawki' then 'Named approver foundation seed: Mohamed Shawki'
      when named_key = 'sharaf_deen' then 'Named approver foundation seed: Super Admin'
      else 'Named approver foundation seed'
    end as seed_note
  from named_matches
  where named_key is not null
)
insert into public.payment_validation_approvers (
  user_id,
  is_active,
  note,
  created_at,
  updated_at
)
select
  s.user_id,
  true,
  s.seed_note,
  now(),
  now()
from named_seed s
on conflict (user_id) do update
set
  is_active = true,
  updated_at = now(),
  note = case
    when coalesce(public.payment_validation_approvers.note, '') = '' then excluded.note
    else public.payment_validation_approvers.note
  end;

create or replace view public.payment_validation_approver_profiles_v1 as
with named_matches as (
  select
    p.user_id,
    case
      when public.is_super_admin(p.user_id) then 'sharaf_deen'
      when lower(trim(coalesce(p.email, ''))) = 'shehab2ldin@gmail.com' then 'shehab'
      when lower(regexp_replace(btrim(concat_ws(' ', coalesce(p.first_name, ''), coalesce(p.last_name, ''))), '\s+', ' ', 'g')) = 'shehab younis' then 'shehab'
      when lower(trim(coalesce(p.first_name, ''))) = 'shehab' then 'shehab'
      when lower(trim(coalesce(p.email, ''))) = 'mshawki24@gmail.com' then 'shawki'
      when lower(regexp_replace(btrim(concat_ws(' ', coalesce(p.first_name, ''), coalesce(p.last_name, ''))), '\s+', ' ', 'g')) = 'mohamed shawki' then 'shawki'
      when lower(trim(coalesce(p.last_name, ''))) = 'shawki' then 'shawki'
      when lower(trim(coalesce(p.first_name, ''))) = 'shawki' then 'shawki'
      else null
    end as named_key
  from public.profiles p
)
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
  nm.named_key,
  public.is_super_admin(a.user_id) as is_super_admin
from public.payment_validation_approvers a
join public.profiles p on p.user_id = a.user_id
left join named_matches nm on nm.user_id = a.user_id
where a.is_active = true;

commit;
