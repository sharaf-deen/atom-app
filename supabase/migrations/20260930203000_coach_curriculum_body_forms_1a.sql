-- Coach Curriculum — Body Forms 1A
-- Adds audience tagging and seeds the Body Forms foundational movement curriculum.
begin;

alter table public.coach_curriculum_techniques
  add column if not exists audiences text[] not null default '{}'::text[];

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'coach_curriculum_techniques_audiences_check'
      and conrelid = 'public.coach_curriculum_techniques'::regclass
  ) then
    alter table public.coach_curriculum_techniques
      add constraint coach_curriculum_techniques_audiences_check
      check (
        audiences <@ array['baby_3_5','kids_beginner','adult_beginner']::text[]
      );
  end if;
end $$;

comment on column public.coach_curriculum_techniques.audiences is
  'Optional teaching audiences: baby_3_5, kids_beginner, adult_beginner. Empty means not audience-classified.';

insert into public.coach_curriculum_types (name, slug, description, sort_order, is_active)
select
  'Body Forms',
  'body-forms',
  'Foundational body movement, coordination, falling, rolling, base and ground mobility for beginner development.',
  5,
  true
where not exists (
  select 1 from public.coach_curriculum_types
  where lower(slug) = 'body-forms' or lower(name) = 'body forms'
);

with body_type as (
  select id from public.coach_curriculum_types
  where lower(slug) = 'body-forms'
  order by created_at asc
  limit 1
),
blocks(name, description, sort_order) as (
  values
    ('Locomotion & Coordination', 'Animal movements, directional movement and basic coordination patterns.', 10),
    ('Falling & Rolling', 'Safe falling mechanics and fundamental rolling patterns.', 20),
    ('Ground Mobility', 'Foundational hip, shoulder and ground movement used throughout Jiu-Jitsu.', 30),
    ('Base & Standing Movement', 'Posture, base, standing recovery and fundamental level-changing movement.', 40),
    ('Dynamic Body Movement', 'More dynamic transitional movements used in wrestling, turtle and guard recovery.', 50)
)
insert into public.coach_curriculum_blocks (type_id, name, description, sort_order, is_active)
select bt.id, b.name, b.description, b.sort_order, true
from body_type bt
cross join blocks b
where not exists (
  select 1 from public.coach_curriculum_blocks cb
  where cb.type_id = bt.id and lower(cb.name) = lower(b.name)
);

with seed(block_name, name, description, level, audiences, sort_order) as (
  values
    ('Locomotion & Coordination','Bear Crawl','Move on hands and feet while maintaining a stable trunk and coordinated opposite-side movement.','beginner',array['baby_3_5','kids_beginner']::text[],10),
    ('Locomotion & Coordination','Crab Walk','Move with hands and feet on the floor while keeping the hips lifted and coordinated.','beginner',array['baby_3_5','kids_beginner']::text[],20),
    ('Locomotion & Coordination','Frog Jump','Explosive squat-to-jump pattern emphasizing landing balance and lower-body coordination.','beginner',array['baby_3_5','kids_beginner']::text[],30),
    ('Locomotion & Coordination','Bunny Hop','Two-foot jumping pattern emphasizing balance, rhythm and safe landing.','beginner',array['baby_3_5']::text[],40),
    ('Locomotion & Coordination','Duck Walk','Low squat walking pattern for balance, hip mobility and leg coordination.','beginner',array['baby_3_5','kids_beginner']::text[],50),
    ('Locomotion & Coordination','Side Shuffle','Lateral movement while maintaining balance and athletic posture.','beginner',array['baby_3_5','kids_beginner','adult_beginner']::text[],60),
    ('Locomotion & Coordination','Forward / Backward Crawl','Controlled crawling forward and backward while maintaining coordinated hand-foot movement.','beginner',array['baby_3_5','kids_beginner']::text[],70),

    ('Falling & Rolling','Backward Breakfall','Safe backward falling mechanics with chin protected and controlled impact.','beginner',array['baby_3_5','kids_beginner','adult_beginner']::text[],10),
    ('Falling & Rolling','Side Breakfall','Safe lateral falling mechanics with protected head and controlled arm contact.','beginner',array['kids_beginner','adult_beginner']::text[],20),
    ('Falling & Rolling','Forward Breakfall','Safe forward falling mechanics using the arms and body position to distribute impact.','beginner',array['kids_beginner','adult_beginner']::text[],30),
    ('Falling & Rolling','Forward Roll','Basic forward rolling pattern with rounded posture and safe shoulder-to-hip pathway.','beginner',array['baby_3_5','kids_beginner','adult_beginner']::text[],40),
    ('Falling & Rolling','Backward Roll','Controlled backward roll while protecting the neck and maintaining body orientation.','beginner',array['baby_3_5','kids_beginner','adult_beginner']::text[],50),
    ('Falling & Rolling','Shoulder Roll','Diagonal shoulder roll used to develop safe rotational movement and spatial awareness.','beginner',array['kids_beginner','adult_beginner']::text[],60),

    ('Ground Mobility','Hip Escape / Shrimp','Move the hips away from pressure while keeping useful frames and body alignment.','beginner',array['baby_3_5','kids_beginner','adult_beginner']::text[],10),
    ('Ground Mobility','Reverse Shrimp','Move the hips toward the feet and rebuild inside position with coordinated hip movement.','beginner',array['kids_beginner','adult_beginner']::text[],20),
    ('Ground Mobility','Bridge','Drive through the feet and elevate the hips while maintaining safe head and shoulder position.','beginner',array['baby_3_5','kids_beginner','adult_beginner']::text[],30),
    ('Ground Mobility','Bridge & Turn','Combine a bridge with controlled rotation onto the shoulder to create an escape angle.','beginner',array['baby_3_5','kids_beginner','adult_beginner']::text[],40),
    ('Ground Mobility','Hip Switch','Switch the hips from one side to the other while maintaining stable upper-body position.','beginner',array['kids_beginner','adult_beginner']::text[],50),
    ('Ground Mobility','Shoulder Walk','Move the body using alternating shoulder movement while keeping the hips engaged.','beginner',array['baby_3_5','kids_beginner','adult_beginner']::text[],60),
    ('Ground Mobility','Knee-to-Elbow Movement','Connect knee and elbow while moving the hips to develop compact defensive structure.','beginner',array['kids_beginner','adult_beginner']::text[],70),

    ('Base & Standing Movement','Athletic Stance','Balanced standing posture with knees bent, stable base and readiness to move in every direction.','beginner',array['baby_3_5','kids_beginner','adult_beginner']::text[],10),
    ('Base & Standing Movement','Combat Base','Stable seated-to-kneeling base used to protect balance and prepare to stand.','beginner',array['kids_beginner','adult_beginner']::text[],20),
    ('Base & Standing Movement','Technical Stand-Up','Stand safely while maintaining distance, base and protective hand positioning.','beginner',array['baby_3_5','kids_beginner','adult_beginner']::text[],30),
    ('Base & Standing Movement','Base Recovery','Recover stable posture after balance is disrupted without crossing the feet or exposing the body.','beginner',array['baby_3_5','kids_beginner','adult_beginner']::text[],40),
    ('Base & Standing Movement','Level Change','Lower the body by bending the knees while preserving posture and balance.','beginner',array['kids_beginner','adult_beginner']::text[],50),
    ('Base & Standing Movement','Penetration Step','Basic wrestling entry step with level change, knee placement and posture control.','beginner',array['kids_beginner','adult_beginner']::text[],60),
    ('Base & Standing Movement','Pivot / Direction Change','Change direction around a stable base without crossing the feet or losing posture.','beginner',array['baby_3_5','kids_beginner','adult_beginner']::text[],70),

    ('Dynamic Body Movement','Sprawl','Move the hips back and down while controlling posture to defend a lower-body entry.','beginner',array['kids_beginner','adult_beginner']::text[],10),
    ('Dynamic Body Movement','Sit-Out / Hip Heist','Rotate the hips through from a posted position while maintaining base and shoulder awareness.','beginner',array['kids_beginner','adult_beginner']::text[],20),
    ('Dynamic Body Movement','Granby Roll','Rotational shoulder roll used for guard recovery and movement from turtle.','intermediate',array['kids_beginner','adult_beginner']::text[],30),
    ('Dynamic Body Movement','Technical Get-Up + Movement','Connect a technical stand-up with immediate balanced movement and stance recovery.','beginner',array['kids_beginner','adult_beginner']::text[],40),
    ('Dynamic Body Movement','Bridge to Knee','Bridge to create space, rotate and recover onto a knee with stable posture.','beginner',array['kids_beginner','adult_beginner']::text[],50),
    ('Dynamic Body Movement','Turtle Turn / Sit-Out','Rotate from turtle or posted base into a sit-out while protecting balance and body position.','beginner',array['kids_beginner','adult_beginner']::text[],60)
),
body_type as (
  select id from public.coach_curriculum_types
  where lower(slug) = 'body-forms'
  order by created_at asc
  limit 1
)
insert into public.coach_curriculum_techniques
  (block_id, name, description, technical_level, school, training_format, audiences, sort_order, is_active)
select
  b.id,
  s.name,
  s.description,
  s.level,
  null,
  'both',
  s.audiences,
  s.sort_order,
  true
from seed s
join body_type bt on true
join public.coach_curriculum_blocks b
  on b.type_id = bt.id and lower(b.name) = lower(s.block_name)
where not exists (
  select 1 from public.coach_curriculum_techniques ct
  where ct.block_id = b.id and lower(ct.name) = lower(s.name)
);

commit;
