-- ATOM Curriculum V1 — idempotent curriculum seed
-- Adds the validated ATOM Curriculum V1 without overwriting existing curriculum data.
-- Hierarchy: Technical Type -> Block -> Technique.
-- No Situations are seeded here; those remain for real coaching variants / opponent reactions.
--
-- Safety:
--   * Existing technical types are kept as-is.
--   * Existing blocks are never overwritten.
--   * A block with the same name anywhere in the curriculum is reused instead of duplicated.
--   * Existing techniques under the resolved block are kept as-is.
--   * Only missing rows are inserted.
--   * Level classification is stored in technique.description because the current schema
--     has no dedicated Beginner / Intermediate / Advanced column.

begin;

insert into public.coach_curriculum_types (
  name, slug, description, sort_order, is_active
)
select
  'Guard Systems',
  'guard-systems',
  'Guard positions, controls, sweeps, transitions and back-take systems.',
  25,
  true
where not exists (
  select 1
  from public.coach_curriculum_types t
  where lower(t.name) = lower('Guard Systems')
     or lower(t.slug) = lower('guard-systems')
);

do $atom_curriculum_v1$
declare
  v_seed jsonb := '[{"type":"Takedowns","block":"Takedowns","block_sort":10,"techniques":[{"name":"Double Leg","level":"Beginner","sort":10},{"name":"Single Leg","level":"Beginner","sort":20},{"name":"Snapdown","level":"Beginner","sort":30},{"name":"Ankle Pick","level":"Intermediate","sort":40},{"name":"High Crotch","level":"Intermediate","sort":50},{"name":"Body Lock Takedown","level":"Intermediate","sort":60},{"name":"Foot Sweep","level":"Intermediate","sort":70}]},{"type":"Takedowns","block":"Takedown Defense / Counters","block_sort":20,"techniques":[{"name":"Sprawl + Go Behind","level":"Beginner","sort":10},{"name":"Single Leg Defense + Whizzer","level":"Beginner","sort":20},{"name":"Double Leg Defense","level":"Intermediate","sort":30},{"name":"Front Headlock Counter","level":"Intermediate","sort":40},{"name":"Limp Leg / Single Leg Escape","level":"Intermediate","sort":50},{"name":"Counter Takedown from Whizzer","level":"Advanced","sort":60}]},{"type":"Guard Systems","block":"Closed Guard","block_sort":10,"techniques":[{"name":"Hip Bump Sweep","level":"Beginner","sort":10},{"name":"Scissor Sweep","level":"Beginner","sort":20},{"name":"Kimura","level":"Beginner","sort":30},{"name":"Armbar","level":"Beginner","sort":40},{"name":"Triangle","level":"Intermediate","sort":50},{"name":"Back Take","level":"Intermediate","sort":60}]},{"type":"Guard Systems","block":"Sit Up Guard","block_sort":20,"techniques":[{"name":"Sit Up Sleeve","level":"Beginner","sort":10},{"name":"Sit Up Lasso","level":"Intermediate","sort":20},{"name":"Sit Up Lapel","level":"Intermediate","sort":30},{"name":"Sit Up Lapel Lasso","level":"Intermediate","sort":40},{"name":"Sit Up Belt","level":"Intermediate","sort":50},{"name":"Sit Up Single Leg","level":"Beginner","sort":60}]},{"type":"Guard Systems","block":"De La Riva","block_sort":30,"techniques":[{"name":"DLR Entry / Control","level":"Beginner","sort":10},{"name":"Tripod Sweep","level":"Beginner","sort":20},{"name":"Technical Stand-Up Sweep","level":"Beginner","sort":30},{"name":"DLR to Single Leg","level":"Intermediate","sort":40},{"name":"DLR Back Take","level":"Intermediate","sort":50},{"name":"DLR to X Guard","level":"Intermediate","sort":60},{"name":"DLR to Berimbolo","level":"Advanced","sort":70}]},{"type":"Guard Systems","block":"Deep De La Riva","block_sort":40,"techniques":[{"name":"Deep DLR Entry","level":"Intermediate","sort":10},{"name":"Deep DLR Off-Balance","level":"Intermediate","sort":20},{"name":"Deep DLR Sweep","level":"Intermediate","sort":30},{"name":"Deep DLR to X Guard","level":"Advanced","sort":40},{"name":"Deep DLR Back Take","level":"Advanced","sort":50}]},{"type":"Guard Systems","block":"Shallow Guard","block_sort":50,"techniques":[{"name":"Shallow Guard Entry","level":"Intermediate","sort":10},{"name":"Basic Off-Balance","level":"Intermediate","sort":20},{"name":"Technical Stand-Up Sweep","level":"Intermediate","sort":30},{"name":"Single Leg Transition","level":"Intermediate","sort":40},{"name":"DLR Transition","level":"Intermediate","sort":50},{"name":"Back Take","level":"Advanced","sort":60}]},{"type":"Guard Systems","block":"Waiter Guard","block_sort":60,"techniques":[{"name":"Waiter Entry","level":"Intermediate","sort":10},{"name":"Waiter Sweep","level":"Intermediate","sort":20},{"name":"Waiter to X Guard","level":"Intermediate","sort":30},{"name":"Waiter Back Take","level":"Advanced","sort":40}]},{"type":"Guard Systems","block":"Double Pull / Berimbolo","block_sort":70,"techniques":[{"name":"Double Pull Entry","level":"Intermediate","sort":10},{"name":"Double Pull Control","level":"Intermediate","sort":20},{"name":"Berimbolo Entry","level":"Advanced","sort":30},{"name":"Crab Ride Transition","level":"Advanced","sort":40},{"name":"Berimbolo Back Take","level":"Advanced","sort":50},{"name":"Leg Drag Transition","level":"Advanced","sort":60}]},{"type":"Guard Systems","block":"Butterfly Guard","block_sort":80,"techniques":[{"name":"Butterfly Position / Hooks","level":"Beginner","sort":10},{"name":"Basic Butterfly Sweep","level":"Beginner","sort":20},{"name":"Double Underhook Sweep","level":"Beginner","sort":30},{"name":"Arm Drag","level":"Intermediate","sort":40},{"name":"Single Leg X Entry","level":"Intermediate","sort":50},{"name":"X Guard Entry","level":"Intermediate","sort":60}]},{"type":"Guard Systems","block":"Half Guard","block_sort":90,"techniques":[{"name":"Knee Shield","level":"Beginner","sort":10},{"name":"Underhook Recovery","level":"Beginner","sort":20},{"name":"Old School Sweep","level":"Intermediate","sort":30},{"name":"Dogfight","level":"Intermediate","sort":40},{"name":"Single Leg Sweep","level":"Intermediate","sort":50},{"name":"Back Take","level":"Advanced","sort":60}]},{"type":"Guard Systems","block":"Deep Half Guard","block_sort":100,"techniques":[{"name":"Deep Half Entry","level":"Intermediate","sort":10},{"name":"Position / Control","level":"Intermediate","sort":20},{"name":"Homer Simpson Sweep","level":"Intermediate","sort":30},{"name":"Waiter Sweep","level":"Intermediate","sort":40},{"name":"Back Door Sweep","level":"Advanced","sort":50},{"name":"Back Take","level":"Advanced","sort":60}]},{"type":"Passing","block":"Open Guard Passing","block_sort":10,"techniques":[{"name":"Toreando","level":"Beginner","sort":10},{"name":"Knee Cut","level":"Beginner","sort":20},{"name":"Double Under Pass","level":"Beginner","sort":30},{"name":"Leg Drag","level":"Intermediate","sort":40},{"name":"Stack Pass","level":"Intermediate","sort":50},{"name":"Body Lock Pass","level":"Intermediate","sort":60}]},{"type":"Passing","block":"De La Riva Passing","block_sort":20,"techniques":[{"name":"DLR Grip Removal","level":"Beginner","sort":10},{"name":"DLR Knee Cut","level":"Intermediate","sort":20},{"name":"DLR Leg Drag","level":"Intermediate","sort":30},{"name":"Back Step","level":"Intermediate","sort":40},{"name":"Smash Pass","level":"Intermediate","sort":50}]},{"type":"Passing","block":"Under-Over Passing","block_sort":30,"techniques":[{"name":"Under-Over Entry","level":"Beginner","sort":10},{"name":"Shoulder Pressure / Control","level":"Beginner","sort":20},{"name":"Hip Switch","level":"Intermediate","sort":30},{"name":"Under-Over Finish","level":"Intermediate","sort":40},{"name":"Stack Transition","level":"Intermediate","sort":50}]},{"type":"Passing","block":"Half Guard Passing","block_sort":40,"techniques":[{"name":"Crossface + Underhook","level":"Beginner","sort":10},{"name":"Flatten Half Guard","level":"Beginner","sort":20},{"name":"Knee Cut","level":"Beginner","sort":30},{"name":"Tripod Pass","level":"Intermediate","sort":40},{"name":"Back Step","level":"Intermediate","sort":50},{"name":"Smash Pass","level":"Intermediate","sort":60}]},{"type":"Escapes","block":"Side Control Escapes","block_sort":10,"techniques":[{"name":"Frames + Hip Escape","level":"Beginner","sort":10},{"name":"Underhook Escape","level":"Beginner","sort":20},{"name":"Bridge Escape","level":"Beginner","sort":30},{"name":"Guard Recovery","level":"Beginner","sort":40},{"name":"Turtle Recovery","level":"Intermediate","sort":50},{"name":"Ghost Escape","level":"Advanced","sort":60}]},{"type":"Escapes","block":"Mount Escapes","block_sort":20,"techniques":[{"name":"Upa / Bridge Escape","level":"Beginner","sort":10},{"name":"Elbow Escape","level":"Beginner","sort":20},{"name":"Knee-Elbow Recovery","level":"Beginner","sort":30},{"name":"Kipping Escape","level":"Intermediate","sort":40},{"name":"Half Guard Recovery","level":"Intermediate","sort":50}]},{"type":"Escapes","block":"Back Escapes","block_sort":30,"techniques":[{"name":"Defensive Hand Fighting","level":"Beginner","sort":10},{"name":"Safe Side Escape","level":"Beginner","sort":20},{"name":"Shoulder-to-Mat Escape","level":"Intermediate","sort":30},{"name":"Hip Escape","level":"Intermediate","sort":40},{"name":"Guard Recovery","level":"Intermediate","sort":50}]},{"type":"Submissions","block":"Back Attacks","block_sort":10,"techniques":[{"name":"Seatbelt Control","level":"Beginner","sort":10},{"name":"Hand Fighting","level":"Beginner","sort":20},{"name":"Rear Naked Choke","level":"Beginner","sort":30},{"name":"Short Choke","level":"Intermediate","sort":40},{"name":"Armbar from Back","level":"Intermediate","sort":50},{"name":"Bow & Arrow Choke","level":"Intermediate · Gi","sort":60}]}]'::jsonb;
  v_block jsonb;
  v_technique jsonb;
  v_type_id uuid;
  v_block_id uuid;
  v_existing_block_type_id uuid;
  v_type_name text;
  v_block_name text;
  v_technique_name text;
  v_level text;
  v_block_sort integer;
  v_technique_sort integer;
begin
  for v_block in
    select value from jsonb_array_elements(v_seed)
  loop
    v_type_name := btrim(v_block ->> 'type');
    v_block_name := btrim(v_block ->> 'block');
    v_block_sort := coalesce((v_block ->> 'block_sort')::integer, 100);

    select t.id
      into v_type_id
    from public.coach_curriculum_types t
    where lower(t.name) = lower(v_type_name)
    order by t.is_active desc, t.created_at asc
    limit 1;

    if v_type_id is null then
      raise exception 'ATOM Curriculum V1 seed failed: technical type "%" was not found.', v_type_name;
    end if;

    -- Prefer the intended Technical Type. If this exact Block name already exists
    -- elsewhere, reuse it rather than creating a duplicate Block.
    select b.id, b.type_id
      into v_block_id, v_existing_block_type_id
    from public.coach_curriculum_blocks b
    where lower(b.name) = lower(v_block_name)
    order by
      case when b.type_id = v_type_id then 0 else 1 end,
      b.is_active desc,
      b.created_at asc
    limit 1;

    if v_block_id is null then
      insert into public.coach_curriculum_blocks (
        type_id, name, description, sort_order, is_active
      )
      values (
        v_type_id, v_block_name, 'ATOM Curriculum V1.', v_block_sort, true
      )
      returning id, type_id into v_block_id, v_existing_block_type_id;
    elsif v_existing_block_type_id <> v_type_id then
      raise notice
        'ATOM Curriculum V1: existing Block "%" is under another Technical Type; reusing it without modifying existing data.',
        v_block_name;
    end if;

    for v_technique in
      select value from jsonb_array_elements(v_block -> 'techniques')
    loop
      v_technique_name := btrim(v_technique ->> 'name');
      v_level := btrim(v_technique ->> 'level');
      v_technique_sort := coalesce((v_technique ->> 'sort')::integer, 100);

      if not exists (
        select 1
        from public.coach_curriculum_techniques ct
        where ct.block_id = v_block_id
          and lower(ct.name) = lower(v_technique_name)
      ) then
        insert into public.coach_curriculum_techniques (
          block_id, name, description, sort_order, is_active
        )
        values (
          v_block_id,
          v_technique_name,
          'ATOM Curriculum V1 · ' || v_level,
          v_technique_sort,
          true
        );
      end if;
    end loop;
  end loop;
end
$atom_curriculum_v1$;

commit;
