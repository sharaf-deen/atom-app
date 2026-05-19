begin;

create table if not exists public.private_coaching_slots (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.profiles(user_id) on delete restrict,
  slot_date date not null,
  start_time time without time zone not null,
  end_time time without time zone not null,
  status text not null default 'available',
  note text null,
  cancelled_at timestamptz null,
  cancelled_by uuid null references public.profiles(user_id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  created_by uuid null references public.profiles(user_id) on delete set null,
  updated_by uuid null references public.profiles(user_id) on delete set null,
  constraint private_coaching_slots_time_order_check check (end_time > start_time),
  constraint private_coaching_slots_status_check check (status in ('available', 'cancelled')),
  constraint private_coaching_slots_note_length_check check (note is null or char_length(note) <= 500),
  constraint private_coaching_slots_cancelled_state_check check (
    status <> 'cancelled' or (cancelled_at is not null and cancelled_by is not null)
  )
);

create index if not exists idx_private_coaching_slots_coach_date_start
  on public.private_coaching_slots(coach_id, slot_date, start_time);

create index if not exists idx_private_coaching_slots_status_date
  on public.private_coaching_slots(status, slot_date, start_time);

create unique index if not exists uq_private_coaching_slots_available_coach_time
  on public.private_coaching_slots(coach_id, slot_date, start_time, end_time)
  where status = 'available';

drop trigger if exists trg_private_coaching_slots_updated_at on public.private_coaching_slots;
create trigger trg_private_coaching_slots_updated_at
before update on public.private_coaching_slots
for each row execute function public.set_updated_at();

alter table public.private_coaching_slots enable row level security;

drop policy if exists private_coaching_slots_member_select_available on public.private_coaching_slots;
create policy private_coaching_slots_member_select_available
on public.private_coaching_slots
for select
to authenticated
using (
  status = 'available'
  and exists (
    select 1
    from public.private_coaching_passes pass
    where pass.member_id = auth.uid()
      and pass.coach_id = private_coaching_slots.coach_id
      and pass.status = 'active'
      and pass.remaining_sessions > 0
  )
);

drop policy if exists private_coaching_slots_manager_select on public.private_coaching_slots;
create policy private_coaching_slots_manager_select
on public.private_coaching_slots
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.user_id = auth.uid()
      and (
        p.role = 'super_admin'
        or (p.role = 'head_coach' and private_coaching_slots.coach_id = auth.uid())
      )
  )
);

drop policy if exists private_coaching_slots_super_admin_all on public.private_coaching_slots;
create policy private_coaching_slots_super_admin_all
on public.private_coaching_slots
for all
to authenticated
using (public.is_super_admin(auth.uid()))
with check (public.is_super_admin(auth.uid()));

drop policy if exists private_coaching_slots_head_coach_insert_own on public.private_coaching_slots;
create policy private_coaching_slots_head_coach_insert_own
on public.private_coaching_slots
for insert
to authenticated
with check (
  coach_id = auth.uid()
  and created_by = auth.uid()
  and exists (
    select 1
    from public.profiles p
    where p.user_id = auth.uid()
      and p.role = 'head_coach'
  )
);

drop policy if exists private_coaching_slots_head_coach_update_own on public.private_coaching_slots;
create policy private_coaching_slots_head_coach_update_own
on public.private_coaching_slots
for update
to authenticated
using (
  coach_id = auth.uid()
  and exists (
    select 1
    from public.profiles p
    where p.user_id = auth.uid()
      and p.role = 'head_coach'
  )
)
with check (
  coach_id = auth.uid()
  and updated_by = auth.uid()
  and exists (
    select 1
    from public.profiles p
    where p.user_id = auth.uid()
      and p.role = 'head_coach'
  )
);

revoke all on table public.private_coaching_slots from anon, authenticated;
grant select, insert, update, delete on table public.private_coaching_slots to authenticated;
grant select, insert, update, delete on table public.private_coaching_slots to service_role;

commit;
