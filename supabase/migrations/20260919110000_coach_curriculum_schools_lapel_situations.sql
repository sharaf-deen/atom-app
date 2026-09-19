-- Coach Operations: editable technique school, lapel guards and opponent reactions.
-- Existing classifications and situations are never overwritten or reactivated.
begin;

alter table public.coach_curriculum_techniques
  add column if not exists school text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'coach_curriculum_techniques_school_check'
      and conrelid = 'public.coach_curriculum_techniques'::regclass
  ) then
    alter table public.coach_curriculum_techniques
      add constraint coach_curriculum_techniques_school_check
      check (school in ('old_school', 'new_school'));
  end if;
end $$;

comment on column public.coach_curriculum_techniques.school is
  'Coaching classification: old_school or new_school. NULL means awaiting coach review.';

-- New catalog entries only; existing blocks/techniques and their edits are preserved.
insert into public.coach_curriculum_blocks (type_id, name, description, sort_order, is_active)
select t.id, 'Lapel Guard',
  'Gi lapel controls, Worm Guard, Squid Guard and Polish Worm Rider entries and transitions.',
  125, true
from public.coach_curriculum_types t
where t.slug = 'guard-systems'
  and not exists (
    select 1 from public.coach_curriculum_blocks b
    where b.type_id = t.id and lower(b.name) = 'lapel guard'
  );

with entries(name, description, technical_level, sort_order) as (
  values
    ('Lapel Grip & Guard Entry', 'Establish a safe lapel grip and distance before threading the lapel.', 'intermediate', 10),
    ('Worm Guard Entry / Control', 'Thread the lapel around the far leg and maintain angle and distance.', 'advanced', 20),
    ('Squid Guard Entry / Control', 'Control the near leg with the lapel when the opponent withdraws the far leg.', 'advanced', 30),
    ('Squid Guard Sweep', 'Off-balance the near leg from Squid Guard and finish the sweep safely.', 'advanced', 40),
    ('Polish Worm Rider Entry / Control', 'Keep lapel connection and hip angle in the Polish Worm Rider.', 'advanced', 50),
    ('Polish Worm Rider Sweep', 'Use the lapel connection to off-balance and come on top.', 'advanced', 60)
)
insert into public.coach_curriculum_techniques
  (block_id, name, description, technical_level, school, sort_order, is_active)
select b.id, e.name, e.description, e.technical_level, 'new_school', e.sort_order, true
from public.coach_curriculum_blocks b
join public.coach_curriculum_types t on t.id = b.type_id
cross join entries e
where t.slug = 'guard-systems' and lower(b.name) = 'lapel guard'
  and not exists (
    select 1 from public.coach_curriculum_techniques ct
    where ct.block_id = b.id and lower(ct.name) = lower(e.name)
  );

-- Each new lapel technique has two or three distinct, actionable reactions.
with examples(technique, name, reaction, response, sort_order) as (
  values
    ('Lapel Grip & Guard Entry', 'Opponent strips the lapel grip',
     'The opponent peels the lapel free before it can be threaded.',
     'Recover inside distance and establish a safe frame before rebuilding the lapel grip.', 10),
    ('Lapel Grip & Guard Entry', 'Opponent closes distance early',
     'The opponent drives forward while the lapel is still loose.',
     'Frame against the near shoulder, move the hips and regain a usable angle before threading.', 20),
    ('Worm Guard Entry / Control', 'Far leg withdraws',
     'The opponent steps the far leg back before the lapel can wrap it.',
     'Keep the lapel grip and switch attention to the near leg for a Squid Guard entry.', 10),
    ('Worm Guard Entry / Control', 'Opponent squares the hips',
     'The opponent turns to face the guard and tries to free the far leg.',
     'Keep the lapel taut, maintain the leg barrier and rebuild the angle before sweeping.', 20),
    ('Squid Guard Entry / Control', 'Far leg is hidden',
     'The opponent steps the far leg away to deny a Worm Guard wrap.',
     'Retain the lapel and connect to the near leg to establish Squid Guard.', 10),
    ('Squid Guard Entry / Control', 'Opponent retracts the near knee',
     'The opponent pulls the near knee clear as the lapel is being fed.',
     'Stay on the hip, keep the lapel connection and adjust the angle before wrapping the near leg.', 20),
    ('Squid Guard Entry / Control', 'Opponent drives into the guard',
     'The opponent drops weight forward and tries to pin the entangled leg.',
     'Frame, create an angle and keep the controlled knee between both players.', 30),
    ('Squid Guard Sweep', 'Opponent posts a hand',
     'The opponent posts a hand to stop the initial off-balance.',
     'Maintain near-leg control, change the sweep direction and come up only after breaking the post.', 10),
    ('Squid Guard Sweep', 'Opponent backs the hips away',
     'The opponent moves the hips out of range as the sweep starts.',
     'Follow with the lapel connection, recover the angle and attack the near ankle or wrestle up.', 20),
    ('Squid Guard Sweep', 'Opponent turns the knee inward',
     'The opponent rotates the controlled knee to release the lapel tension.',
     'Keep the knee line in view, reset the lapel tension and redirect the off-balance.', 30),
    ('Polish Worm Rider Entry / Control', 'Opponent posts the near knee',
     'The opponent raises the near knee to regain a stable base.',
     'Keep the lapel connection, adjust the hip angle and use the new space for the next guard entry.', 10),
    ('Polish Worm Rider Entry / Control', 'Opponent flattens the hips',
     'The opponent drives weight through the guard before the rider position settles.',
     'Frame at the shoulder, move the hips and restore the lapel tension without exposing the back.', 20),
    ('Polish Worm Rider Entry / Control', 'Opponent breaks the lapel grip',
     'The opponent peels the feeding hand off the lapel.',
     'Rebuild a frame and secure the lapel again before committing to the sweep.', 30),
    ('Polish Worm Rider Sweep', 'Opponent bases with a hand',
     'The opponent posts a hand to stop the initial tip.',
     'Keep the lapel tight, change the angle and follow the base hand before coming on top.', 10),
    ('Polish Worm Rider Sweep', 'Opponent steps out to recover base',
     'The opponent posts a foot and widens the base to stop the sweep.',
     'Keep the leg and lapel connected, follow the step and transition to a leg-drag or another off-balance.', 20),
    ('Polish Worm Rider Sweep', 'Opponent rotates to face the guard',
     'The opponent squares the shoulders and turns back into the sweep.',
     'Retain the lapel, angle the hips and rebuild the off-balance before completing the reversal.', 30)
)
insert into public.coach_curriculum_situations
  (technique_id, name, opponent_reaction, coaching_response, sort_order, is_active)
select ct.id, e.name, e.reaction, e.response, e.sort_order, true
from examples e
join public.coach_curriculum_techniques ct on lower(ct.name) = lower(e.technique)
join public.coach_curriculum_blocks b on b.id = ct.block_id and lower(b.name) = 'lapel guard'
join public.coach_curriculum_types t on t.id = b.type_id and t.slug = 'guard-systems'
where not exists (
  select 1 from public.coach_curriculum_situations s
  where s.technique_id = ct.id and lower(s.name) = lower(e.name)
);

-- Backfill two situational prompts for techniques with fewer than two active
-- reactions. Prompts are chosen by position, and existing authored rows win.
-- Custom techniques in those positions benefit too; coaches can refine each cue.
with scenarios(group_name, priority, name, reaction, response) as (
  values
    ('standing', 1, 'Opponent circles away',
     'The opponent circles off the line and denies the initial standing connection.',
     'Reset stance and inside position, move the feet to regain an angle before committing.'),
    ('standing', 2, 'Opponent counters the entry',
     'The opponent posts a hand and steps the hips back as the entry develops.',
     'Keep head and hips aligned, clear the post and re-enter from a safer angle.'),
    ('takedown_defense', 1, 'Opponent switches the takedown angle',
     'The opponent changes direction after the first defensive movement.',
     'Keep head position and a wide base, circle off the attack line and recover the underhook.'),
    ('takedown_defense', 2, 'Opponent chains to the far leg',
     'The opponent abandons the first grip and attacks the opposite leg.',
     'Move the hips back, free the far leg and face the opponent before counterattacking.'),
    ('guard', 1, 'Opponent drives weight forward',
     'The opponent closes distance and tries to flatten the guard before the attack develops.',
     'Frame at the shoulder or hip, move the hips and rebuild an inside knee or hook.'),
    ('guard', 2, 'Opponent withdraws to passing distance',
     'The opponent steps back and strips the closest grip or hook.',
     'Keep the feet between both players, follow the retreat and reconnect to the nearest leg.'),
    ('passing', 1, 'Opponent frames and hip escapes',
     'The opponent frames on the shoulder and moves the hips away from the passing lane.',
     'Clear the frame, maintain hip control and adjust the angle before advancing.'),
    ('passing', 2, 'Opponent recovers an inside knee',
     'The opponent inserts the near knee between the bodies as the pass progresses.',
     'Control the knee line, reset head and hip position and redirect around the new frame.'),
    ('escapes', 1, 'Opponent tightens upper-body control',
     'The opponent closes the crossface or head control to stop the initial movement.',
     'Protect the neck, build a forearm frame and create space before turning the hips.'),
    ('escapes', 2, 'Opponent follows the hip escape',
     'The opponent follows the hips and blocks the inside knee during the recovery.',
     'Change the hip angle, reconnect elbow to knee and recover guard before disengaging.'),
    ('attacks', 1, 'Opponent hides the near arm',
     'The opponent brings the elbow close and blocks the first attacking grip.',
     'Hold positional control, separate the elbow with a better angle and isolate the target.'),
    ('attacks', 2, 'Opponent turns and hand-fights',
     'The opponent turns toward safety and uses both hands to defend the attack.',
     'Follow the rotation, keep the shoulders controlled and switch grips before finishing.'),
    ('back_attacks', 1, 'Opponent traps the top arm',
     'The opponent clamps the attacking arm and hides the neck while defending the back.',
     'Keep chest-to-back contact, hand-fight for the inside lane and retain the seatbelt.'),
    ('back_attacks', 2, 'Opponent turns toward the underhook',
     'The opponent slides the shoulders to the mat and turns toward the underhook side.',
     'Follow with the hips, retain at least one hook and re-secure upper-body control.'),
    ('turtle_attacks', 1, 'Opponent elbows tight in turtle',
     'The opponent closes the elbows to deny inside grips and back exposure.',
     'Stay heavy over the shoulders, control a near wrist and create an angle for the entry.'),
    ('turtle_attacks', 2, 'Opponent rolls to recover guard',
     'The opponent rolls across the shoulders as the attack begins.',
     'Follow the rotation with chest pressure, protect your grips and secure top control or the back.'),
    ('headlock', 1, 'Opponent peels the chin strap',
     'The opponent controls the wrist and lifts the chin out of the front headlock.',
     'Keep weight on the shoulders, adjust the grip and follow the head angle before attacking.'),
    ('headlock', 2, 'Opponent drives to a single leg',
     'The opponent reaches for the near leg to counter the front headlock.',
     'Sprawl the hips, circle off the captured leg and recover head-and-arm control.'),
    ('mount_attacks', 1, 'Opponent frames at the hips',
     'The opponent pushes the hips and bridges as the mount attack begins.',
     'Widen the base, keep knees tight and isolate an arm after the bridge settles.'),
    ('mount_attacks', 2, 'Opponent traps an arm to roll',
     'The opponent traps the attacking arm and bridges toward that side.',
     'Post safely, re-center the weight and recover high mount before advancing.'),
    ('side_attacks', 1, 'Opponent frames across the neck',
     'The opponent frames under the chin and turns toward the attacker.',
     'Clear the frame, settle shoulder pressure and isolate the near arm.'),
    ('side_attacks', 2, 'Opponent inserts a knee',
     'The opponent recovers the near knee while defending the side-control attack.',
     'Follow the hip, block the knee line and secure the position before attacking again.'),
    ('north_south_attacks', 1, 'Opponent turns toward the attacker',
     'The opponent turns and frames at the shoulder to free the head.',
     'Stay connected to the near shoulder and adjust the angle without giving up control.'),
    ('north_south_attacks', 2, 'Opponent reaches for the near arm',
     'The opponent hooks the attacking arm and shifts the hips out of north-south.',
     'Clear the hook, maintain chest pressure and move with the hips before committing.')
), grouped as (
  select ct.id,
    case
      when lower(b.name) = 'takedown defense / counters' then 'takedown_defense'
      when lower(b.name) like '%escap%' or lower(b.name) = 'guard retention' then 'escapes'
      when t.slug = 'takedowns' then 'standing'
      when t.slug = 'passing' then 'passing'
      when lower(b.name) = 'back attacks' then 'back_attacks'
      when lower(b.name) = 'turtle attacks' then 'turtle_attacks'
      when lower(b.name) = 'front headlock' then 'headlock'
      when lower(b.name) = 'mount attacks' then 'mount_attacks'
      when lower(b.name) = 'side control attacks' then 'side_attacks'
      when lower(b.name) = 'north-south attacks' then 'north_south_attacks'
      when t.slug = 'submissions' or lower(b.name) like '%attack%' then 'attacks'
      when t.slug = 'guard-systems' then 'guard'
      else null
    end as group_name
  from public.coach_curriculum_techniques ct
  join public.coach_curriculum_blocks b on b.id = ct.block_id
  join public.coach_curriculum_types t on t.id = b.type_id
  where lower(b.name) <> 'lapel guard'
), candidates as (
  select g.id as technique_id, s.*,
    (select count(*) from public.coach_curriculum_situations present
     where present.technique_id = g.id and present.is_active) as active_count,
    row_number() over (partition by g.id order by s.priority) as candidate_number
  from grouped g
  join scenarios s on s.group_name = g.group_name
  where not exists (
    select 1 from public.coach_curriculum_situations present
    where present.technique_id = g.id and lower(present.name) = lower(s.name)
  )
)
insert into public.coach_curriculum_situations
  (technique_id, name, opponent_reaction, coaching_response, sort_order, is_active)
select c.technique_id, c.name, c.reaction, c.response, 800 + 10 * c.priority, true
from candidates c
where c.active_count + c.candidate_number <= 2;

commit;
