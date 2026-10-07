-- Private Coaching 5B — Session Technical Content
-- Links each private coaching booking to ATOM's existing curriculum library.
-- Curriculum labels are snapshotted so historical session content remains readable
-- if the library is renamed, deactivated or later cleaned up.
begin;

create table if not exists public.private_coaching_session_contents (
  booking_id uuid primary key references public.private_coaching_bookings(id) on delete cascade,
  session_notes text null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  created_by uuid null references public.profiles(user_id) on delete set null,
  updated_by uuid null references public.profiles(user_id) on delete set null,
  constraint private_coaching_session_contents_notes_length
    check (session_notes is null or char_length(session_notes) <= 3000)
);

create table if not exists public.private_coaching_session_blocks (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.private_coaching_bookings(id) on delete cascade,
  block_id uuid null references public.coach_curriculum_blocks(id) on delete set null,
  block_name_snapshot text not null,
  sort_order integer not null default 100,
  created_at timestamptz not null default timezone('utc', now()),
  created_by uuid null references public.profiles(user_id) on delete set null,
  constraint private_coaching_session_blocks_snapshot_length
    check (char_length(btrim(block_name_snapshot)) between 1 and 180)
);

create table if not exists public.private_coaching_session_techniques (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.private_coaching_bookings(id) on delete cascade,
  technique_id uuid null references public.coach_curriculum_techniques(id) on delete set null,
  technique_name_snapshot text not null,
  block_name_snapshot text null,
  sort_order integer not null default 100,
  created_at timestamptz not null default timezone('utc', now()),
  created_by uuid null references public.profiles(user_id) on delete set null,
  constraint private_coaching_session_techniques_snapshot_length
    check (char_length(btrim(technique_name_snapshot)) between 1 and 200)
);

create table if not exists public.private_coaching_session_situations (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.private_coaching_bookings(id) on delete cascade,
  situation_id uuid null references public.coach_curriculum_situations(id) on delete set null,
  situation_name_snapshot text not null,
  technique_name_snapshot text null,
  sort_order integer not null default 100,
  created_at timestamptz not null default timezone('utc', now()),
  created_by uuid null references public.profiles(user_id) on delete set null,
  constraint private_coaching_session_situations_snapshot_length
    check (char_length(btrim(situation_name_snapshot)) between 1 and 220)
);

create unique index if not exists private_coaching_session_blocks_booking_block_uidx
  on public.private_coaching_session_blocks (booking_id, block_id)
  where block_id is not null;

create unique index if not exists private_coaching_session_techniques_booking_technique_uidx
  on public.private_coaching_session_techniques (booking_id, technique_id)
  where technique_id is not null;

create unique index if not exists private_coaching_session_situations_booking_situation_uidx
  on public.private_coaching_session_situations (booking_id, situation_id)
  where situation_id is not null;

create index if not exists private_coaching_session_blocks_booking_idx
  on public.private_coaching_session_blocks (booking_id, sort_order);
create index if not exists private_coaching_session_techniques_booking_idx
  on public.private_coaching_session_techniques (booking_id, sort_order);
create index if not exists private_coaching_session_situations_booking_idx
  on public.private_coaching_session_situations (booking_id, sort_order);

drop trigger if exists trg_private_coaching_session_contents_updated_at
  on public.private_coaching_session_contents;
create trigger trg_private_coaching_session_contents_updated_at
before update on public.private_coaching_session_contents
for each row execute function public.set_updated_at();

alter table public.private_coaching_session_contents enable row level security;
alter table public.private_coaching_session_blocks enable row level security;
alter table public.private_coaching_session_techniques enable row level security;
alter table public.private_coaching_session_situations enable row level security;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'private_coaching_session_contents',
    'private_coaching_session_blocks',
    'private_coaching_session_techniques',
    'private_coaching_session_situations'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', v_table || '_manager_select', v_table);
    execute format('drop policy if exists %I on public.%I', v_table || '_super_admin_all', v_table);

    execute format($policy$
      create policy %I on public.%I
      for select to authenticated
      using (
        exists (
          select 1
          from public.private_coaching_bookings b
          join public.profiles p on p.user_id = auth.uid()
          where b.id = %I.booking_id
            and (
              p.role::text = 'super_admin'
              or (p.role::text = 'head_coach' and b.coach_id = auth.uid())
            )
        )
      )
    $policy$, v_table || '_manager_select', v_table, v_table);

    execute format($policy$
      create policy %I on public.%I
      for all to authenticated
      using (public.is_super_admin(auth.uid()))
      with check (public.is_super_admin(auth.uid()))
    $policy$, v_table || '_super_admin_all', v_table);
  end loop;
end
$$;

revoke all on public.private_coaching_session_contents from anon, authenticated;
revoke all on public.private_coaching_session_blocks from anon, authenticated;
revoke all on public.private_coaching_session_techniques from anon, authenticated;
revoke all on public.private_coaching_session_situations from anon, authenticated;

grant select on public.private_coaching_session_contents to authenticated;
grant select on public.private_coaching_session_blocks to authenticated;
grant select on public.private_coaching_session_techniques to authenticated;
grant select on public.private_coaching_session_situations to authenticated;

grant select, insert, update, delete on public.private_coaching_session_contents to service_role;
grant select, insert, update, delete on public.private_coaching_session_blocks to service_role;
grant select, insert, update, delete on public.private_coaching_session_techniques to service_role;
grant select, insert, update, delete on public.private_coaching_session_situations to service_role;

comment on table public.private_coaching_session_contents is
  'Private Coaching 5B: per-booking technical session notes.';
comment on table public.private_coaching_session_blocks is
  'Private Coaching 5B: curriculum blocks selected for a private session, with historical label snapshots.';
comment on table public.private_coaching_session_techniques is
  'Private Coaching 5B: curriculum techniques selected for a private session, with historical label snapshots.';
comment on table public.private_coaching_session_situations is
  'Private Coaching 5B: curriculum situations selected for a private session, with historical label snapshots.';

commit;
