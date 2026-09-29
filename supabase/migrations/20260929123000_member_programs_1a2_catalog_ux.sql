-- Member Programs 1A.2 — Curated Academy Program Catalog & UX Polish
-- Creates a stable, explicit member-program catalog independent from schedule occurrences.
-- Exact display order requested by ATOM:
-- Baby 3–5
-- Kids 6–9 Beginners
-- Kids 6–9 Intermediate
-- Kids 10–14 Beginners
-- Kids 10–14 Intermediate
-- Kids Competition
-- Kids PT
-- Adults Beginners
-- Adults Intermediate / Advanced
-- Adults PT
--
-- Masters and Wrestling are intentionally excluded from the member-program catalog.

begin;

create table if not exists public.member_program_catalog (
  key text primary key,
  name text not null,
  audience text not null,
  age_min smallint null,
  age_max smallint null,
  level text not null default '',
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint member_program_catalog_key_check
    check (key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint member_program_catalog_name_check
    check (char_length(btrim(name)) between 2 and 180),
  constraint member_program_catalog_audience_check
    check (audience in ('kids_teens','adults')),
  constraint member_program_catalog_age_check
    check (
      (age_min is null and age_max is null)
      or (
        age_min is not null
        and age_max is not null
        and age_min >= 0
        and age_max <= 99
        and age_max >= age_min
      )
    )
);

create index if not exists member_program_catalog_active_sort_idx
  on public.member_program_catalog (is_active, sort_order, name);

alter table public.member_program_catalog enable row level security;

grant select on public.member_program_catalog to authenticated;
revoke insert, update, delete on public.member_program_catalog from authenticated;

drop policy if exists member_program_catalog_read_authenticated on public.member_program_catalog;
create policy member_program_catalog_read_authenticated
on public.member_program_catalog
for select to authenticated
using (is_active = true);

insert into public.member_program_catalog
  (key, name, audience, age_min, age_max, level, sort_order, is_active)
values
  ('baby-3-5', 'Baby 3–5', 'kids_teens', 3, 5, 'Beginners', 10, true),
  ('kids-6-9-beginners', 'Kids 6–9 Beginners', 'kids_teens', 6, 9, 'Beginners', 20, true),
  ('kids-6-9-intermediate', 'Kids 6–9 Intermediate', 'kids_teens', 6, 9, 'Intermediate', 30, true),
  ('kids-10-14-beginners', 'Kids 10–14 Beginners', 'kids_teens', 10, 14, 'Beginners', 40, true),
  ('kids-10-14-intermediate', 'Kids 10–14 Intermediate', 'kids_teens', 10, 14, 'Intermediate', 50, true),
  ('kids-competition', 'Kids Competition', 'kids_teens', null, null, 'Competition', 60, true),
  ('kids-pt', 'Kids PT', 'kids_teens', null, null, 'Physical Training', 70, true),
  ('adults-beginners', 'Adults Beginners', 'adults', null, null, 'Beginners', 80, true),
  ('adults-intermediate-advanced', 'Adults Intermediate / Advanced', 'adults', null, null, 'Intermediate / Advanced', 90, true),
  ('adults-pt', 'Adults PT', 'adults', null, null, 'Physical Training', 100, true)
on conflict (key) do update
set name = excluded.name,
    audience = excluded.audience,
    age_min = excluded.age_min,
    age_max = excluded.age_max,
    level = excluded.level,
    sort_order = excluded.sort_order,
    is_active = excluded.is_active,
    updated_at = now();

-- Normalize any 1A enrollments already created from Structured Schedule keys.
update public.member_program_enrollments
set program_key = case program_key
      when 'baby-3-5-group-a' then 'baby-3-5'
      when 'baby-3-5-group-b' then 'baby-3-5'
      when 'teens-10-14-beginners' then 'kids-10-14-beginners'
      when 'teens-10-14-intermediate' then 'kids-10-14-intermediate'
      when 'competition-kids' then 'kids-competition'
      when 'physical-preparation' then 'adults-pt'
      else program_key
    end,
    updated_at = now()
where program_key in (
  'baby-3-5-group-a',
  'baby-3-5-group-b',
  'teens-10-14-beginners',
  'teens-10-14-intermediate',
  'competition-kids',
  'physical-preparation'
);

-- Refresh display snapshots to the curated names while retaining every history row.
update public.member_program_enrollments e
set program_name_snapshot = c.name,
    updated_at = now()
from public.member_program_catalog c
where c.key = e.program_key
  and e.program_name_snapshot is distinct from c.name;

create or replace function public.set_member_current_program_v1(
  p_member_user_id uuid,
  p_program_key text,
  p_actor_user_id uuid,
  p_source text default 'manual'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_role text;
  v_target_role text;
  v_program_name text;
  v_existing public.member_program_enrollments%rowtype;
  v_new_id uuid;
  v_now timestamptz := now();
begin
  select p.role::text into v_actor_role
  from public.profiles p
  where p.user_id = p_actor_user_id;

  if v_actor_role is null or v_actor_role <> all (array['reception','admin','super_admin','head_coach']::text[]) then
    raise exception 'MEMBER_PROGRAM_FORBIDDEN';
  end if;

  select p.role::text into v_target_role
  from public.profiles p
  where p.user_id = p_member_user_id;

  if v_target_role is null or v_target_role <> all (array['member','champion','vip']::text[]) then
    raise exception 'MEMBER_PROGRAM_INVALID_TARGET';
  end if;

  select * into v_existing
  from public.member_program_enrollments e
  where e.member_user_id = p_member_user_id
    and e.is_current = true
  for update;

  if p_program_key is null or btrim(p_program_key) = '' then
    if v_existing.id is not null then
      update public.member_program_enrollments
      set is_current = false,
          ended_at = v_now,
          updated_at = v_now
      where id = v_existing.id;
    end if;
    return null;
  end if;

  select c.name into v_program_name
  from public.member_program_catalog c
  where c.is_active = true
    and c.key = btrim(p_program_key)
  limit 1;

  if v_program_name is null then
    raise exception 'MEMBER_PROGRAM_INVALID_PROGRAM';
  end if;

  if v_existing.id is not null and v_existing.program_key = btrim(p_program_key) then
    if v_existing.program_name_snapshot is distinct from v_program_name then
      update public.member_program_enrollments
      set program_name_snapshot = v_program_name,
          updated_at = v_now
      where id = v_existing.id;
    end if;
    return v_existing.id;
  end if;

  if v_existing.id is not null then
    update public.member_program_enrollments
    set is_current = false,
        ended_at = v_now,
        updated_at = v_now
    where id = v_existing.id;
  end if;

  insert into public.member_program_enrollments (
    member_user_id,
    program_key,
    program_name_snapshot,
    started_at,
    is_current,
    source,
    assigned_by
  ) values (
    p_member_user_id,
    btrim(p_program_key),
    v_program_name,
    v_now,
    true,
    coalesce(nullif(btrim(p_source), ''), 'manual'),
    p_actor_user_id
  )
  returning id into v_new_id;

  return v_new_id;
end;
$$;

revoke all on function public.set_member_current_program_v1(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.set_member_current_program_v1(uuid, text, uuid, text) to service_role;

comment on table public.member_program_catalog is
  'Curated ATOM academy-program catalog used for member enrollment and analytics. Independent from recurring schedule occurrences.';

commit;
