-- Coach Operations Lot 1B — Training Program Assignment
-- Head Coach / Super Admin build and publish training programs from the curriculum.
-- Coach / Assistant Coach have read-only access to published programs.

begin;

create table if not exists public.coach_training_programs (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  target_group text not null,
  start_date date not null,
  end_date date not null,
  notes text null,
  status text not null default 'draft',
  created_by uuid null references auth.users(id) on delete set null,
  updated_by uuid null references auth.users(id) on delete set null,
  published_by uuid null references auth.users(id) on delete set null,
  published_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint coach_training_programs_title_length check (char_length(btrim(title)) between 2 and 160),
  constraint coach_training_programs_target_group_length check (char_length(btrim(target_group)) between 2 and 180),
  constraint coach_training_programs_date_range check (end_date >= start_date),
  constraint coach_training_programs_status_check check (status in ('draft','published','archived'))
);

create index if not exists coach_training_programs_period_idx
  on public.coach_training_programs (start_date desc, end_date desc);
create index if not exists coach_training_programs_status_period_idx
  on public.coach_training_programs (status, start_date desc, end_date desc);

create table if not exists public.coach_training_program_items (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.coach_training_programs(id) on delete cascade,
  selected_level text not null,
  type_id uuid not null references public.coach_curriculum_types(id) on delete restrict,
  block_id uuid not null references public.coach_curriculum_blocks(id) on delete restrict,
  technique_id uuid null references public.coach_curriculum_techniques(id) on delete restrict,
  situation_id uuid null references public.coach_curriculum_situations(id) on delete restrict,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  constraint coach_training_program_items_level_check check (selected_level in ('block','technique','situation')),
  constraint coach_training_program_items_sort_order_range check (sort_order between 0 and 10000),
  constraint coach_training_program_items_shape_check check (
    (selected_level = 'block' and technique_id is null and situation_id is null)
    or
    (selected_level = 'technique' and technique_id is not null and situation_id is null)
    or
    (selected_level = 'situation' and technique_id is not null and situation_id is not null)
  )
);

create index if not exists coach_training_program_items_program_idx
  on public.coach_training_program_items (program_id, sort_order, selected_level);
create unique index if not exists coach_training_program_items_block_uidx
  on public.coach_training_program_items (program_id, block_id)
  where selected_level = 'block';
create unique index if not exists coach_training_program_items_technique_uidx
  on public.coach_training_program_items (program_id, technique_id)
  where selected_level = 'technique';
create unique index if not exists coach_training_program_items_situation_uidx
  on public.coach_training_program_items (program_id, situation_id)
  where selected_level = 'situation';

alter table public.coach_training_programs enable row level security;
alter table public.coach_training_program_items enable row level security;

grant select, insert, update on public.coach_training_programs to authenticated;
grant select, insert, delete on public.coach_training_program_items to authenticated;
revoke delete on public.coach_training_programs from authenticated;

-- Managers can see every program. Coach / Assistant Coach can only see published programs.
drop policy if exists coach_training_programs_read_staff on public.coach_training_programs;
create policy coach_training_programs_read_staff
on public.coach_training_programs
for select to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.user_id = auth.uid()
      and (
        p.role::text = any (array['head_coach','super_admin']::text[])
        or (
          p.role::text = any (array['assistant_coach','coach']::text[])
          and coach_training_programs.status = 'published'
        )
      )
  )
);

drop policy if exists coach_training_programs_insert_managers on public.coach_training_programs;
create policy coach_training_programs_insert_managers
on public.coach_training_programs
for insert to authenticated
with check (
  exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid()
      and p.role::text = any (array['head_coach','super_admin']::text[])
  )
);

drop policy if exists coach_training_programs_update_managers on public.coach_training_programs;
create policy coach_training_programs_update_managers
on public.coach_training_programs
for update to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid()
      and p.role::text = any (array['head_coach','super_admin']::text[])
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid()
      and p.role::text = any (array['head_coach','super_admin']::text[])
  )
);

-- Program items inherit visibility from their parent program, with the same role rules.
drop policy if exists coach_training_program_items_read_staff on public.coach_training_program_items;
create policy coach_training_program_items_read_staff
on public.coach_training_program_items
for select to authenticated
using (
  exists (
    select 1
    from public.coach_training_programs pr
    join public.profiles p on p.user_id = auth.uid()
    where pr.id = coach_training_program_items.program_id
      and (
        p.role::text = any (array['head_coach','super_admin']::text[])
        or (
          p.role::text = any (array['assistant_coach','coach']::text[])
          and pr.status = 'published'
        )
      )
  )
);

drop policy if exists coach_training_program_items_insert_managers on public.coach_training_program_items;
create policy coach_training_program_items_insert_managers
on public.coach_training_program_items
for insert to authenticated
with check (
  exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid()
      and p.role::text = any (array['head_coach','super_admin']::text[])
  )
  and exists (
    select 1 from public.coach_training_programs pr
    where pr.id = coach_training_program_items.program_id
  )
);

drop policy if exists coach_training_program_items_delete_managers on public.coach_training_program_items;
create policy coach_training_program_items_delete_managers
on public.coach_training_program_items
for delete to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid()
      and p.role::text = any (array['head_coach','super_admin']::text[])
  )
);

comment on table public.coach_training_programs is 'Coach Operations: planned curriculum assignment for a group/class and date range.';
comment on table public.coach_training_program_items is 'Coach Operations: curriculum blocks, techniques and situations selected for a training program.';

commit;
