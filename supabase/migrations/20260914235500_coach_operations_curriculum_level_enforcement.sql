-- Coach Operations — Curriculum Level Enforcement
-- Structured technique/program levels with cumulative access:
-- Beginner -> Beginner only
-- Intermediate -> Beginner + Intermediate
-- Advanced -> Beginner + Intermediate + Advanced

begin;

alter table public.coach_curriculum_techniques
  add column if not exists technical_level text;

update public.coach_curriculum_techniques
set technical_level = case
  when lower(coalesce(description, '')) like '%beginner%' then 'beginner'
  when lower(coalesce(description, '')) like '%intermediate%' then 'intermediate'
  when lower(coalesce(description, '')) like '%advanced%' then 'advanced'
  else 'advanced'
end
where technical_level is null
   or technical_level not in ('beginner','intermediate','advanced');

alter table public.coach_curriculum_techniques
  alter column technical_level set default 'advanced',
  alter column technical_level set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'coach_curriculum_techniques_technical_level_check'
      and conrelid = 'public.coach_curriculum_techniques'::regclass
  ) then
    alter table public.coach_curriculum_techniques
      add constraint coach_curriculum_techniques_technical_level_check
      check (technical_level in ('beginner','intermediate','advanced'));
  end if;
end $$;

create index if not exists coach_curriculum_techniques_level_idx
  on public.coach_curriculum_techniques (technical_level, block_id, sort_order, name);

alter table public.coach_training_programs
  add column if not exists technical_level text;

-- Legacy published Programs may predate the Program Team requirement and can still
-- have no Responsible Coach. The existing team snapshot trigger validates that
-- invariant on every UPDATE, even when only technical_level is being backfilled.
-- Temporarily disable that specific trigger for this metadata-only migration so
-- the backfill does not rewrite or validate Program team data. The transaction
-- guarantees the trigger state is rolled back if the migration fails.
alter table public.coach_training_programs
  disable trigger coach_training_program_team_snapshot_before_write;

-- Backfill legacy programs from their title/target group first, then linked Schedule class level.
update public.coach_training_programs p
set technical_level = case
  when lower(coalesce(p.title, '') || ' ' || coalesce(p.target_group, '')) like '%beginner%' then 'beginner'
  when lower(coalesce(p.title, '') || ' ' || coalesce(p.target_group, '')) like '%interm%'
       and lower(coalesce(p.title, '') || ' ' || coalesce(p.target_group, '')) like '%adv%' then 'advanced'
  when lower(coalesce(p.title, '') || ' ' || coalesce(p.target_group, '')) like '%advanced%'
       or lower(coalesce(p.title, '') || ' ' || coalesce(p.target_group, '')) like '%competition%'
       or lower(coalesce(p.title, '') || ' ' || coalesce(p.target_group, '')) like '%competitor%' then 'advanced'
  when lower(coalesce(p.title, '') || ' ' || coalesce(p.target_group, '')) like '%interm%' then 'intermediate'
  when exists (
    select 1
    from public.coach_training_program_class_templates m
    join public.schedule_class_templates t on t.id = m.class_template_id
    where m.program_id = p.id
      and m.is_active = true
      and (
        lower(coalesce(t.level, '')) like '%advanced%'
        or lower(coalesce(t.level, '')) like '%adv%'
      )
  ) then 'advanced'
  when exists (
    select 1
    from public.coach_training_program_class_templates m
    join public.schedule_class_templates t on t.id = m.class_template_id
    where m.program_id = p.id
      and m.is_active = true
      and lower(coalesce(t.level, '')) like '%interm%'
  ) then 'intermediate'
  when exists (
    select 1
    from public.coach_training_program_class_templates m
    join public.schedule_class_templates t on t.id = m.class_template_id
    where m.program_id = p.id
      and m.is_active = true
      and lower(coalesce(t.level, '')) like '%beginner%'
  ) then 'beginner'
  else 'advanced'
end
where p.technical_level is null
   or p.technical_level not in ('beginner','intermediate','advanced');

alter table public.coach_training_programs
  enable trigger coach_training_program_team_snapshot_before_write;

alter table public.coach_training_programs
  alter column technical_level set default 'advanced',
  alter column technical_level set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'coach_training_programs_technical_level_check'
      and conrelid = 'public.coach_training_programs'::regclass
  ) then
    alter table public.coach_training_programs
      add constraint coach_training_programs_technical_level_check
      check (technical_level in ('beginner','intermediate','advanced'));
  end if;
end $$;

create index if not exists coach_training_programs_technical_level_idx
  on public.coach_training_programs (technical_level, status, start_date desc);

create or replace function public.coach_curriculum_level_rank(p_level text)
returns integer
language sql
immutable
as $$
  select case lower(coalesce(p_level, ''))
    when 'beginner' then 1
    when 'intermediate' then 2
    when 'advanced' then 3
    else 99
  end;
$$;

-- Direct DB writes cannot assign an explicit technique/situation above the program level.
create or replace function public.coach_enforce_program_item_technical_level()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_program_level text;
  v_technique_level text;
begin
  if new.technique_id is null then
    return new;
  end if;

  select p.technical_level
    into v_program_level
  from public.coach_training_programs p
  where p.id = new.program_id;

  select t.technical_level
    into v_technique_level
  from public.coach_curriculum_techniques t
  where t.id = new.technique_id;

  if v_program_level is null or v_technique_level is null then
    raise exception 'CURRICULUM_LEVEL_LOOKUP_FAILED';
  end if;

  if public.coach_curriculum_level_rank(v_technique_level) > public.coach_curriculum_level_rank(v_program_level) then
    raise exception 'CURRICULUM_LEVEL_EXCEEDS_PROGRAM'
      using errcode = '23514',
            detail = format('Technique level %s exceeds program level %s.', v_technique_level, v_program_level);
  end if;

  return new;
end;
$$;

drop trigger if exists coach_training_program_items_level_guard on public.coach_training_program_items;
create trigger coach_training_program_items_level_guard
before insert or update of program_id, technique_id, situation_id
on public.coach_training_program_items
for each row
execute function public.coach_enforce_program_item_technical_level();

-- Training Logs receive the same server-side guard, including block-only Programs where
-- techniques are chosen later by the Responsible Coach.
create or replace function public.coach_enforce_log_item_technical_level()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_program_level text;
  v_technique_level text;
begin
  if new.technique_id is null then
    return new;
  end if;

  select p.technical_level
    into v_program_level
  from public.coach_training_session_logs l
  join public.coach_training_programs p on p.id = l.program_id
  where l.id = new.session_log_id;

  select t.technical_level
    into v_technique_level
  from public.coach_curriculum_techniques t
  where t.id = new.technique_id;

  if v_program_level is null or v_technique_level is null then
    raise exception 'CURRICULUM_LEVEL_LOOKUP_FAILED';
  end if;

  if public.coach_curriculum_level_rank(v_technique_level) > public.coach_curriculum_level_rank(v_program_level) then
    raise exception 'CURRICULUM_LEVEL_EXCEEDS_PROGRAM'
      using errcode = '23514',
            detail = format('Technique level %s exceeds program level %s.', v_technique_level, v_program_level);
  end if;

  return new;
end;
$$;

drop trigger if exists coach_training_session_log_items_level_guard on public.coach_training_session_log_items;
create trigger coach_training_session_log_items_level_guard
before insert or update of session_log_id, technique_id, situation_id
on public.coach_training_session_log_items
for each row
execute function public.coach_enforce_log_item_technical_level();

comment on column public.coach_curriculum_techniques.technical_level is
  'Structured technical level: beginner, intermediate or advanced. Situations inherit the parent technique level.';
comment on column public.coach_training_programs.technical_level is
  'Maximum curriculum level allowed in this Training Program. Intermediate includes Beginner; Advanced includes all levels.';

commit;
