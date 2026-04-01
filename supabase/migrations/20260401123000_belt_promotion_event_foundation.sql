begin;

create table if not exists public.belt_promotion_events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  event_date date not null,
  event_time time null,
  audience text not null check (audience in ('kids', 'adults', 'mixed')),
  status text not null default 'draft' check (status in ('draft', 'published', 'live', 'closed')),
  notes text null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  created_by uuid null references public.profiles(user_id) on delete set null,
  updated_by uuid null references public.profiles(user_id) on delete set null
);

create table if not exists public.belt_promotion_event_candidates (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.belt_promotion_events(id) on delete cascade,
  member_user_id uuid not null references public.profiles(user_id) on delete cascade,
  current_belt text null,
  current_stripes integer null check (current_stripes between 0 and 4),
  proposed_decision text not null default 'none' check (proposed_decision in ('stripe', 'belt', 'none')),
  proposed_belt text null,
  proposed_stripes integer null check (proposed_stripes is null or proposed_stripes between 0 and 4),
  preparation_status text not null default 'suggested' check (preparation_status in ('suggested', 'reviewed', 'approved', 'hold')),
  final_decision text not null default 'pending' check (final_decision in ('pending', 'confirmed', 'deferred', 'rejected', 'absent')),
  attendance_status text not null default 'pending' check (attendance_status in ('pending', 'present', 'absent')),
  payment_status text not null default 'pending' check (payment_status in ('pending', 'paid', 'waived', 'verify')),
  reference_coach_user_id uuid null references public.profiles(user_id) on delete set null,
  head_coach_note text null,
  belt_delivered boolean not null default false,
  certificate_delivered boolean not null default false,
  sort_order integer null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (event_id, member_user_id)
);

create table if not exists public.belt_promotion_event_logs (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.belt_promotion_events(id) on delete cascade,
  candidate_id uuid null references public.belt_promotion_event_candidates(id) on delete set null,
  action text not null check (action in ('event_created', 'event_updated', 'event_status_changed', 'candidate_added', 'candidate_updated', 'candidate_removed', 'suggestions_added')),
  details text null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_belt_promotion_events_date_status
  on public.belt_promotion_events(event_date desc, status);

create index if not exists idx_belt_promotion_event_candidates_event_sort
  on public.belt_promotion_event_candidates(event_id, sort_order asc, created_at asc);

create index if not exists idx_belt_promotion_event_candidates_member
  on public.belt_promotion_event_candidates(member_user_id, created_at desc);

create index if not exists idx_belt_promotion_event_logs_event_created
  on public.belt_promotion_event_logs(event_id, created_at desc);

alter table public.belt_promotion_events enable row level security;
alter table public.belt_promotion_event_candidates enable row level security;
alter table public.belt_promotion_event_logs enable row level security;

drop trigger if exists trg_belt_promotion_events_updated_at on public.belt_promotion_events;
create trigger trg_belt_promotion_events_updated_at
before update on public.belt_promotion_events
for each row execute function public.set_updated_at();

drop trigger if exists trg_belt_promotion_event_candidates_updated_at on public.belt_promotion_event_candidates;
create trigger trg_belt_promotion_event_candidates_updated_at
before update on public.belt_promotion_event_candidates
for each row execute function public.set_updated_at();

revoke all on table public.belt_promotion_events from anon, authenticated;
revoke all on table public.belt_promotion_event_candidates from anon, authenticated;
revoke all on table public.belt_promotion_event_logs from anon, authenticated;

grant select, insert, update, delete on table public.belt_promotion_events to service_role;
grant select, insert, update, delete on table public.belt_promotion_event_candidates to service_role;
grant select, insert, update, delete on table public.belt_promotion_event_logs to service_role;

commit;
