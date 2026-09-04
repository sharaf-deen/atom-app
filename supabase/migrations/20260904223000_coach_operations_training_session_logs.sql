-- Coach Operations Lot 1C — Training Session Log
-- Coaches record what was actually taught from a published training program.
-- Schedule and member attendance remain untouched in this lot.

begin;

create table if not exists public.coach_training_session_logs (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.coach_training_programs(id) on delete restrict,
  program_title_snapshot text not null,
  target_group_snapshot text not null,
  training_date date not null,
  session_time time without time zone not null,
  coach_user_id uuid null references auth.users(id) on delete set null,
  coach_name_snapshot text not null,
  coach_role_snapshot text not null,
  notes text null,
  status text not null default 'draft',
  completed_by uuid null references auth.users(id) on delete set null,
  completed_at timestamptz null,
  reopened_by uuid null references auth.users(id) on delete set null,
  reopened_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint coach_training_session_logs_status_check check (status in ('draft','completed')),
  constraint coach_training_session_logs_program_title_length check (char_length(btrim(program_title_snapshot)) between 2 and 160),
  constraint coach_training_session_logs_target_group_length check (char_length(btrim(target_group_snapshot)) between 2 and 180),
  constraint coach_training_session_logs_coach_name_length check (char_length(btrim(coach_name_snapshot)) between 2 and 180),
  constraint coach_training_session_logs_notes_length check (notes is null or char_length(notes) <= 3000)
);

create index if not exists coach_training_session_logs_date_idx
  on public.coach_training_session_logs (training_date desc, session_time desc, created_at desc);
create index if not exists coach_training_session_logs_program_idx
  on public.coach_training_session_logs (program_id, training_date desc);
create index if not exists coach_training_session_logs_coach_idx
  on public.coach_training_session_logs (coach_user_id, training_date desc);
create index if not exists coach_training_session_logs_status_idx
  on public.coach_training_session_logs (status, training_date desc);

create table if not exists public.coach_training_session_log_items (
  id uuid primary key default gen_random_uuid(),
  session_log_id uuid not null references public.coach_training_session_logs(id) on delete cascade,
  selected_level text not null,
  type_id uuid not null references public.coach_curriculum_types(id) on delete restrict,
  block_id uuid not null references public.coach_curriculum_blocks(id) on delete restrict,
  technique_id uuid null references public.coach_curriculum_techniques(id) on delete restrict,
  situation_id uuid null references public.coach_curriculum_situations(id) on delete restrict,
  type_name_snapshot text not null,
  block_name_snapshot text not null,
  technique_name_snapshot text null,
  situation_name_snapshot text null,
  opponent_reaction_snapshot text null,
  coaching_response_snapshot text null,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  constraint coach_training_session_log_items_level_check check (selected_level in ('block','technique','situation')),
  constraint coach_training_session_log_items_sort_order_range check (sort_order between 0 and 10000),
  constraint coach_training_session_log_items_shape_check check (
    (selected_level = 'block' and technique_id is null and situation_id is null)
    or
    (selected_level = 'technique' and technique_id is not null and situation_id is null)
    or
    (selected_level = 'situation' and technique_id is not null and situation_id is not null)
  )
);

create index if not exists coach_training_session_log_items_session_idx
  on public.coach_training_session_log_items (session_log_id, sort_order, selected_level);
create unique index if not exists coach_training_session_log_items_block_uidx
  on public.coach_training_session_log_items (session_log_id, block_id)
  where selected_level = 'block';
create unique index if not exists coach_training_session_log_items_technique_uidx
  on public.coach_training_session_log_items (session_log_id, technique_id)
  where selected_level = 'technique';
create unique index if not exists coach_training_session_log_items_situation_uidx
  on public.coach_training_session_log_items (session_log_id, situation_id)
  where selected_level = 'situation';

alter table public.coach_training_session_logs enable row level security;
alter table public.coach_training_session_log_items enable row level security;

grant select, insert, update on public.coach_training_session_logs to authenticated;
grant select, insert, delete on public.coach_training_session_log_items to authenticated;
revoke delete on public.coach_training_session_logs from authenticated;

-- Managers can read every log. Coach / Assistant Coach can read completed logs and their own draft.
drop policy if exists coach_training_session_logs_read_staff on public.coach_training_session_logs;
create policy coach_training_session_logs_read_staff
on public.coach_training_session_logs
for select to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid()
      and (
        p.role::text = any (array['head_coach','super_admin']::text[])
        or (
          p.role::text = any (array['assistant_coach','coach']::text[])
          and (coach_training_session_logs.status = 'completed' or coach_training_session_logs.coach_user_id = auth.uid())
        )
      )
  )
);

-- Any coaching role can create a log for themselves. This does not certify QR attendance.
drop policy if exists coach_training_session_logs_insert_coaching_staff on public.coach_training_session_logs;
create policy coach_training_session_logs_insert_coaching_staff
on public.coach_training_session_logs
for insert to authenticated
with check (
  coach_user_id = auth.uid()
  and exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid()
      and p.role::text = any (array['assistant_coach','coach','head_coach','super_admin']::text[])
  )
);

-- Coach / Assistant Coach may update only their own draft. Managers may update any log.
-- Moving a draft to completed is allowed; once completed, the owner can no longer edit it.
drop policy if exists coach_training_session_logs_update_staff on public.coach_training_session_logs;
create policy coach_training_session_logs_update_staff
on public.coach_training_session_logs
for update to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid()
      and (
        p.role::text = any (array['head_coach','super_admin']::text[])
        or (
          p.role::text = any (array['assistant_coach','coach']::text[])
          and coach_training_session_logs.coach_user_id = auth.uid()
          and coach_training_session_logs.status = 'draft'
        )
      )
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid()
      and (
        p.role::text = any (array['head_coach','super_admin']::text[])
        or (
          p.role::text = any (array['assistant_coach','coach']::text[])
          and coach_training_session_logs.coach_user_id = auth.uid()
        )
      )
  )
);

-- Log items inherit the parent log visibility.
drop policy if exists coach_training_session_log_items_read_staff on public.coach_training_session_log_items;
create policy coach_training_session_log_items_read_staff
on public.coach_training_session_log_items
for select to authenticated
using (
  exists (
    select 1
    from public.coach_training_session_logs l
    join public.profiles p on p.user_id = auth.uid()
    where l.id = coach_training_session_log_items.session_log_id
      and (
        p.role::text = any (array['head_coach','super_admin']::text[])
        or (
          p.role::text = any (array['assistant_coach','coach']::text[])
          and (l.status = 'completed' or l.coach_user_id = auth.uid())
        )
      )
  )
);

-- Items may only change while their parent log is draft.
drop policy if exists coach_training_session_log_items_insert_staff on public.coach_training_session_log_items;
create policy coach_training_session_log_items_insert_staff
on public.coach_training_session_log_items
for insert to authenticated
with check (
  exists (
    select 1
    from public.coach_training_session_logs l
    join public.profiles p on p.user_id = auth.uid()
    where l.id = coach_training_session_log_items.session_log_id
      and l.status = 'draft'
      and (
        p.role::text = any (array['head_coach','super_admin']::text[])
        or (
          p.role::text = any (array['assistant_coach','coach']::text[])
          and l.coach_user_id = auth.uid()
        )
      )
  )
);

drop policy if exists coach_training_session_log_items_delete_staff on public.coach_training_session_log_items;
create policy coach_training_session_log_items_delete_staff
on public.coach_training_session_log_items
for delete to authenticated
using (
  exists (
    select 1
    from public.coach_training_session_logs l
    join public.profiles p on p.user_id = auth.uid()
    where l.id = coach_training_session_log_items.session_log_id
      and l.status = 'draft'
      and (
        p.role::text = any (array['head_coach','super_admin']::text[])
        or (
          p.role::text = any (array['assistant_coach','coach']::text[])
          and l.coach_user_id = auth.uid()
        )
      )
  )
);

comment on table public.coach_training_session_logs is 'Coach Operations: actual training-session logs recorded against a published training program.';
comment on table public.coach_training_session_log_items is 'Coach Operations: curriculum blocks, techniques and situations actually worked during a training session, with historical snapshots.';

commit;
