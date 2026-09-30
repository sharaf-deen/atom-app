-- Coach Curriculum — Body Forms 1B
-- Adds an optional structured audience to Training Programs.
-- NULL means General / not restricted, preserving all existing programs.

begin;

alter table public.coach_training_programs
  add column if not exists target_audience text null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'coach_training_programs_target_audience_check'
      and conrelid = 'public.coach_training_programs'::regclass
  ) then
    alter table public.coach_training_programs
      add constraint coach_training_programs_target_audience_check
      check (
        target_audience is null
        or target_audience in ('baby_3_5', 'kids_beginner', 'adult_beginner')
      );
  end if;
end $$;

comment on column public.coach_training_programs.target_audience is
  'Optional structured curriculum audience. NULL means General / not restricted.';

commit;
