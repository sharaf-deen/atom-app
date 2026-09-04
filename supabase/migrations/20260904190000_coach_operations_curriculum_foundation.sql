-- Coach Operations Lot 1A — Training Curriculum Foundation
-- Pedagogical hierarchy only: Technical Type -> Block -> Technique -> Situation / Opponent Reaction.

begin;

create table if not exists public.coach_curriculum_types (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null,
  description text null,
  sort_order integer not null default 100,
  is_active boolean not null default true,
  created_by uuid null references auth.users(id) on delete set null,
  updated_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint coach_curriculum_types_name_length check (char_length(btrim(name)) between 2 and 100),
  constraint coach_curriculum_types_slug_length check (char_length(btrim(slug)) between 2 and 120),
  constraint coach_curriculum_types_sort_order_range check (sort_order between 0 and 10000)
);

create unique index if not exists coach_curriculum_types_slug_uidx
  on public.coach_curriculum_types (lower(slug));
create unique index if not exists coach_curriculum_types_name_uidx
  on public.coach_curriculum_types (lower(name));

create table if not exists public.coach_curriculum_blocks (
  id uuid primary key default gen_random_uuid(),
  type_id uuid not null references public.coach_curriculum_types(id) on delete restrict,
  name text not null,
  description text null,
  sort_order integer not null default 100,
  is_active boolean not null default true,
  created_by uuid null references auth.users(id) on delete set null,
  updated_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint coach_curriculum_blocks_name_length check (char_length(btrim(name)) between 2 and 140),
  constraint coach_curriculum_blocks_sort_order_range check (sort_order between 0 and 10000)
);

create unique index if not exists coach_curriculum_blocks_parent_name_uidx
  on public.coach_curriculum_blocks (type_id, lower(name));
create index if not exists coach_curriculum_blocks_type_idx
  on public.coach_curriculum_blocks (type_id, sort_order, name);

create table if not exists public.coach_curriculum_techniques (
  id uuid primary key default gen_random_uuid(),
  block_id uuid not null references public.coach_curriculum_blocks(id) on delete restrict,
  name text not null,
  description text null,
  sort_order integer not null default 100,
  is_active boolean not null default true,
  created_by uuid null references auth.users(id) on delete set null,
  updated_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint coach_curriculum_techniques_name_length check (char_length(btrim(name)) between 2 and 160),
  constraint coach_curriculum_techniques_sort_order_range check (sort_order between 0 and 10000)
);

create unique index if not exists coach_curriculum_techniques_parent_name_uidx
  on public.coach_curriculum_techniques (block_id, lower(name));
create index if not exists coach_curriculum_techniques_block_idx
  on public.coach_curriculum_techniques (block_id, sort_order, name);

create table if not exists public.coach_curriculum_situations (
  id uuid primary key default gen_random_uuid(),
  technique_id uuid not null references public.coach_curriculum_techniques(id) on delete restrict,
  name text not null,
  opponent_reaction text not null,
  coaching_response text null,
  sort_order integer not null default 100,
  is_active boolean not null default true,
  created_by uuid null references auth.users(id) on delete set null,
  updated_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint coach_curriculum_situations_name_length check (char_length(btrim(name)) between 2 and 180),
  constraint coach_curriculum_situations_reaction_length check (char_length(btrim(opponent_reaction)) between 2 and 1000),
  constraint coach_curriculum_situations_sort_order_range check (sort_order between 0 and 10000)
);

create unique index if not exists coach_curriculum_situations_parent_name_uidx
  on public.coach_curriculum_situations (technique_id, lower(name));
create index if not exists coach_curriculum_situations_technique_idx
  on public.coach_curriculum_situations (technique_id, sort_order, name);

-- Initial curriculum types requested for the foundation.
insert into public.coach_curriculum_types (name, slug, description, sort_order)
values
  ('Passing', 'passing', 'Guard passing and positional advancement.', 10),
  ('Sweeps', 'sweeps', 'Reversals and transitions from bottom positions.', 20),
  ('Escapes', 'escapes', 'Defensive escapes and positional recovery.', 30),
  ('Takedowns', 'takedowns', 'Standing entries, finishes and transitions to the ground.', 40),
  ('Submissions', 'submissions', 'Submission attacks, control and finishing mechanics.', 50)
on conflict do nothing;

alter table public.coach_curriculum_types enable row level security;
alter table public.coach_curriculum_blocks enable row level security;
alter table public.coach_curriculum_techniques enable row level security;
alter table public.coach_curriculum_situations enable row level security;

-- Explicit privileges. RLS remains the authority for who can read/write.
grant select, insert, update on public.coach_curriculum_types to authenticated;
grant select, insert, update on public.coach_curriculum_blocks to authenticated;
grant select, insert, update on public.coach_curriculum_techniques to authenticated;
grant select, insert, update on public.coach_curriculum_situations to authenticated;

-- No curriculum row may be physically deleted through the authenticated role in Lot 1A.
revoke delete on public.coach_curriculum_types from authenticated;
revoke delete on public.coach_curriculum_blocks from authenticated;
revoke delete on public.coach_curriculum_techniques from authenticated;
revoke delete on public.coach_curriculum_situations from authenticated;

-- Read: assistant coach, coach, head coach, super admin.
-- Write: head coach, super admin only.
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'coach_curriculum_types',
    'coach_curriculum_blocks',
    'coach_curriculum_techniques',
    'coach_curriculum_situations'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', v_table || '_read_staff', v_table);
    execute format('drop policy if exists %I on public.%I', v_table || '_insert_managers', v_table);
    execute format('drop policy if exists %I on public.%I', v_table || '_update_managers', v_table);

    execute format($policy$
      create policy %I on public.%I
      for select to authenticated
      using (
        exists (
          select 1
          from public.profiles p
          where p.user_id = auth.uid()
            and p.role::text = any (array['assistant_coach','coach','head_coach','super_admin']::text[])
        )
      )
    $policy$, v_table || '_read_staff', v_table);

    execute format($policy$
      create policy %I on public.%I
      for insert to authenticated
      with check (
        exists (
          select 1
          from public.profiles p
          where p.user_id = auth.uid()
            and p.role::text = any (array['head_coach','super_admin']::text[])
        )
      )
    $policy$, v_table || '_insert_managers', v_table);

    execute format($policy$
      create policy %I on public.%I
      for update to authenticated
      using (
        exists (
          select 1
          from public.profiles p
          where p.user_id = auth.uid()
            and p.role::text = any (array['head_coach','super_admin']::text[])
        )
      )
      with check (
        exists (
          select 1
          from public.profiles p
          where p.user_id = auth.uid()
            and p.role::text = any (array['head_coach','super_admin']::text[])
        )
      )
    $policy$, v_table || '_update_managers', v_table);
  end loop;
end
$$;

comment on table public.coach_curriculum_types is 'Coach Operations: top-level technical curriculum categories.';
comment on table public.coach_curriculum_blocks is 'Coach Operations: technical blocks grouped under a technical type.';
comment on table public.coach_curriculum_techniques is 'Coach Operations: techniques grouped under a technical block.';
comment on table public.coach_curriculum_situations is 'Coach Operations: opponent-reaction situations linked to a technique.';

commit;
