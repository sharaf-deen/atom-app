-- Coach Operations: Gi / NoGi applicability per technique and situation.
-- Apply after 20260919110000_coach_curriculum_schools_lapel_situations.sql.
begin;

alter table public.coach_curriculum_techniques
  add column if not exists training_format text;
alter table public.coach_curriculum_situations
  add column if not exists training_format text;

-- A lapel, sleeve, collar grip or belt grip requires a Gi. Collar ties and
-- seatbelts are body controls and remain usable in NoGi.
update public.coach_curriculum_techniques ct
set training_format = case
  when lower(b.name) in ('collar sleeve guard', 'lasso guard', 'spider guard', 'lapel guard')
    or (lower(ct.name) ~ '\m(lapel|sleeve|lasso|spider|belt|collar)\M'
      and lower(ct.name) not like '%collar tie%')
    or lower(ct.name) in ('paper cutter choke', 'paper cutter transition', 'baseball bat choke', 'clock choke')
    then 'gi'
  else 'both'
end
from public.coach_curriculum_blocks b
where b.id = ct.block_id and ct.training_format is null;

update public.coach_curriculum_situations s
set training_format = case
  when ct.training_format = 'gi' then 'gi'
  when regexp_replace(
    lower(s.opponent_reaction || ' ' || coalesce(s.coaching_response, '')),
    'collar[ -]tie', '', 'g'
  ) ~ '\m(lapel|sleeve|collar|belt|kimono|fabric|jacket|trouser|gi)\M' then 'gi'
  else 'both'
end
from public.coach_curriculum_techniques ct
where ct.id = s.technique_id and s.training_format is null;

alter table public.coach_curriculum_techniques
  alter column training_format set not null;

alter table public.coach_curriculum_situations
  alter column training_format set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'coach_curriculum_techniques_training_format_check'
      and conrelid = 'public.coach_curriculum_techniques'::regclass
  ) then
    alter table public.coach_curriculum_techniques
      add constraint coach_curriculum_techniques_training_format_check
      check (training_format in ('gi','nogi','both'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'coach_curriculum_situations_training_format_check'
      and conrelid = 'public.coach_curriculum_situations'::regclass
  ) then
    alter table public.coach_curriculum_situations
      add constraint coach_curriculum_situations_training_format_check
      check (training_format in ('gi','nogi','both'));
  end if;
end $$;

comment on column public.coach_curriculum_techniques.training_format is
  'Formats in which this technique is taught: gi, nogi or both.';
comment on column public.coach_curriculum_situations.training_format is
  'Format of this particular reaction and coaching response; both means clothing-neutral.';

-- Direct writes must also respect the technique/situation relationship.
create or replace function public.coach_validate_curriculum_training_format()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_parent_format text;
begin
  if tg_table_name = 'coach_curriculum_situations' then
    if new.training_format <> 'gi' and regexp_replace(
      lower(new.opponent_reaction || ' ' || coalesce(new.coaching_response, '')),
      'collar[ -]tie', '', 'g'
    ) ~ '\m(lapel|sleeve|collar|belt|kimono|fabric|jacket|trouser)\M' then
      raise exception 'CLOTHING_GRIP_REQUIRES_GI' using errcode = '23514';
    end if;
    select training_format into v_parent_format
    from public.coach_curriculum_techniques where id = new.technique_id;
    if v_parent_format is not null and v_parent_format <> 'both'
      and new.training_format <> v_parent_format then
      raise exception 'SITUATION_FORMAT_MISMATCH' using errcode = '23514';
    end if;
  elsif new.training_format <> 'both' and exists (
    select 1 from public.coach_curriculum_situations s
    where s.technique_id = new.id and s.training_format <> new.training_format
  ) then
    raise exception 'TECHNIQUE_FORMAT_IN_USE' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists coach_curriculum_situation_format_guard on public.coach_curriculum_situations;
create trigger coach_curriculum_situation_format_guard
before insert or update of technique_id, training_format, opponent_reaction, coaching_response
on public.coach_curriculum_situations
for each row execute function public.coach_validate_curriculum_training_format();

drop trigger if exists coach_curriculum_technique_format_guard on public.coach_curriculum_techniques;
create trigger coach_curriculum_technique_format_guard
before update of training_format
on public.coach_curriculum_techniques
for each row execute function public.coach_validate_curriculum_training_format();

insert into public.coach_curriculum_blocks (type_id, name, description, sort_order, is_active)
select t.id, 'Leg Locks',
  'Leg entanglements and submissions; coaches set the permitted ruleset and practice with controlled finishes.',
  170, true
from public.coach_curriculum_types t
where t.slug = 'submissions'
  and not exists (
    select 1 from public.coach_curriculum_blocks b
    where b.type_id = t.id and lower(b.name) = 'leg locks'
  );

with entries(name, description, level, school, format, sort_order) as (
  values
    ('Straight Ankle Lock', 'Control the ankle line from a leg entanglement and apply a controlled straight finish.', 'intermediate', 'old_school', 'both', 10),
    ('Kneebar', 'Isolate the knee line and practice a controlled extension finish.', 'advanced', 'old_school', 'both', 20),
    ('Toe Hold', 'Isolate the foot with a controlled figure-four grip and stable knee line.', 'advanced', 'old_school', 'both', 30),
    ('Calf Slicer', 'Control the lower leg and apply compression gradually.', 'advanced', 'old_school', 'both', 40),
    ('50/50 Ankle Lock', 'Keep the 50/50 knee line controlled while attacking the ankle.', 'advanced', 'new_school', 'both', 50),
    ('Outside Heel Hook', 'NoGi heel exposure and leg control with a controlled finish.', 'advanced', 'new_school', 'nogi', 60),
    ('Inside Heel Hook', 'NoGi heel exposure from inside position with a controlled finish.', 'advanced', 'new_school', 'nogi', 70),
    ('Aoki Lock', 'NoGi ankle-control variation with careful foot positioning and a controlled finish.', 'advanced', 'new_school', 'nogi', 80)
)
insert into public.coach_curriculum_techniques
  (block_id, name, description, technical_level, school, training_format, sort_order, is_active)
select b.id, e.name, e.description, e.level, e.school, e.format, e.sort_order, true
from public.coach_curriculum_blocks b
join public.coach_curriculum_types t on t.id = b.type_id and t.slug = 'submissions'
cross join entries e
where lower(b.name) = 'leg locks'
  and not exists (
    select 1 from public.coach_curriculum_techniques ct
    where ct.block_id = b.id and lower(ct.name) = lower(e.name)
  );

-- A Gi reaction, a NoGi reaction, and a clothing-neutral reaction are distinct
-- for techniques taught in both formats. NoGi-only techniques use no fabric grips.
with examples(technique, format, name, reaction, response, sort_order) as (
  values
    ('Straight Ankle Lock', 'gi', 'Opponent grabs the sleeve to stand',
     'The opponent grips the sleeve and tries to pull the attacker upward.',
     'Clear the sleeve grip, keep the knee line and reset position before the controlled finish.', 10),
    ('Straight Ankle Lock', 'nogi', 'Opponent hand-fights and kicks free',
     'The opponent controls the attacking wrist and kicks the trapped foot outward.',
     'Peel the wrist control, re-secure the ankle line and pause if the leg slips free.', 20),
    ('Straight Ankle Lock', 'both', 'Opponent straightens the trapped leg',
     'The opponent extends the knee and moves the hips back to escape the entanglement.',
     'Follow the knee line, maintain safe hip distance and apply pressure only under control.', 30),
    ('Kneebar', 'gi', 'Opponent grips the trouser leg',
     'The opponent uses a trouser grip to turn the knee line away.',
     'Clear the trouser grip, control the hip and keep the knee aligned before advancing.', 10),
    ('Kneebar', 'nogi', 'Opponent rotates the knee outward',
     'The opponent rotates and slides the knee toward the exit.',
     'Follow the hip, re-establish the knee line and stop if control is lost.', 20),
    ('Kneebar', 'both', 'Opponent bends the knee',
     'The opponent bends the trapped leg and pulls the heel toward the hips.',
     'Keep the hip connection, isolate the leg again and finish only with gradual pressure.', 30),
    ('Toe Hold', 'gi', 'Opponent holds the sleeve to break the grip',
     'The opponent grabs the attacking sleeve and pulls the hands away from the foot.',
     'Free the sleeve, keep the knee controlled and re-establish the foot grip safely.', 10),
    ('Toe Hold', 'nogi', 'Opponent peels the hands from the foot',
     'The opponent hand-fights the wrists and tries to pull the foot clear.',
     'Keep elbow position, reset wrist control and release when the knee line is lost.', 20),
    ('Toe Hold', 'both', 'Opponent turns the knee line',
     'The opponent rotates the knee to change the angle of the foot.',
     'Follow the hip without forcing the foot; regain control before any pressure.', 30),
    ('Calf Slicer', 'gi', 'Opponent anchors to the jacket',
     'The opponent grips the jacket to pull the hips away from the compression.',
     'Clear the jacket grip, control the thigh and keep the compression gradual.', 10),
    ('Calf Slicer', 'nogi', 'Opponent hand-fights the leg control',
     'The opponent peels the wrist and slides the trapped leg backward.',
     'Reconnect to the thigh with body control; release if the leg escapes.', 20),
    ('Calf Slicer', 'both', 'Opponent straightens the knee',
     'The opponent extends the trapped leg to remove the compression.',
     'Stay connected to the hip and reset the entanglement without forcing a finish.', 30),
    ('50/50 Ankle Lock', 'gi', 'Opponent posts with a lapel grip',
     'The opponent anchors a lapel grip to sit up and clear the trapped ankle.',
     'Break the lapel grip and hold the 50/50 knee line before attacking again.', 10),
    ('50/50 Ankle Lock', 'nogi', 'Opponent peels the ankle control',
     'The opponent controls the wrists and pulls the ankle out of reach.',
     'Hand-fight for wrist position and re-establish the ankle line with body control.', 20),
    ('50/50 Ankle Lock', 'both', 'Opponent stands to free the leg',
     'The opponent posts a hand and tries to stand out of 50/50.',
     'Stay connected to the knee line, manage distance and disengage if control is lost.', 30),
    ('Outside Heel Hook', 'nogi', 'Opponent hides the heel',
     'The opponent turns the foot inward and hides the heel from the entry.',
     'Keep the knee line controlled, adjust the hip angle and do not force a hidden heel.', 10),
    ('Outside Heel Hook', 'nogi', 'Opponent clears the knee line',
     'The opponent slides the knee past the leg entanglement.',
     'Release the heel, follow the hip if safe and reset position before reattacking.', 20),
    ('Outside Heel Hook', 'nogi', 'Opponent hand-fights the finishing grip',
     'The opponent controls the wrists before the heel is secured.',
     'Win hand position patiently; apply no rotational pressure without stable control.', 30),
    ('Inside Heel Hook', 'nogi', 'Opponent hides the heel behind the hip',
     'The opponent turns and keeps the heel out of reach.',
     'Maintain inside leg control, change the angle and release if the knee line escapes.', 10),
    ('Inside Heel Hook', 'nogi', 'Opponent rotates with the entanglement',
     'The opponent turns the hips to relieve the entanglement.',
     'Follow only while the knee line remains controlled; stop any pressure during the turn.', 20),
    ('Inside Heel Hook', 'nogi', 'Opponent peels the wrists',
     'The opponent hand-fights before the finishing grip can be secured.',
     'Rebuild hand position and keep pressure gradual under the coach’s supervision.', 30),
    ('Aoki Lock', 'nogi', 'Opponent retracts the foot',
     'The opponent pulls the foot behind the hips to deny ankle exposure.',
     'Stay aligned with the knee line and reset the ankle position without forcing the joint.', 10),
    ('Aoki Lock', 'nogi', 'Opponent hand-fights the ankle grip',
     'The opponent peels the wrists to break the ankle control.',
     'Rebuild wrist position with body control, and release if the foot slips free.', 20),
    ('Aoki Lock', 'nogi', 'Opponent stands to disengage',
     'The opponent rises and pulls the trapped knee toward safety.',
     'Keep a safe distance, maintain control if possible and disengage before applying pressure.', 30)
)
insert into public.coach_curriculum_situations
  (technique_id, name, opponent_reaction, coaching_response, training_format, sort_order, is_active)
select ct.id, e.name, e.reaction, e.response, e.format, e.sort_order, true
from examples e
join public.coach_curriculum_techniques ct on lower(ct.name) = lower(e.technique)
join public.coach_curriculum_blocks b on b.id = ct.block_id and lower(b.name) = 'leg locks'
join public.coach_curriculum_types t on t.id = b.type_id and t.slug = 'submissions'
where (ct.training_format = 'both' or ct.training_format = e.format)
  and not exists (
    select 1 from public.coach_curriculum_situations s
    where s.technique_id = ct.id and lower(s.name) = lower(e.name)
  );

commit;
