begin;

alter table public.belt_promotion_event_candidates
  add column if not exists results_applied_at timestamptz null,
  add column if not exists results_applied_by uuid null references public.profiles(user_id) on delete set null;

create index if not exists idx_belt_promotion_event_candidates_event_applied
  on public.belt_promotion_event_candidates(event_id, results_applied_at desc);

create table if not exists public.belt_promotion_event_apply_runs (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.belt_promotion_events(id) on delete cascade,
  applied_count integer not null default 0 check (applied_count >= 0),
  stripe_count integer not null default 0 check (stripe_count >= 0),
  belt_count integer not null default 0 check (belt_count >= 0),
  note_count integer not null default 0 check (note_count >= 0),
  closed_event boolean not null default false,
  applied_by uuid null references public.profiles(user_id) on delete set null,
  notes text null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_belt_promotion_event_apply_runs_event_created
  on public.belt_promotion_event_apply_runs(event_id, created_at desc);

alter table public.belt_promotion_event_apply_runs enable row level security;

revoke all on table public.belt_promotion_event_apply_runs from anon, authenticated;
grant select, insert, update, delete on table public.belt_promotion_event_apply_runs to service_role;

alter table public.belt_promotion_event_logs
  drop constraint if exists belt_promotion_event_logs_action_check;

alter table public.belt_promotion_event_logs
  add constraint belt_promotion_event_logs_action_check
  check (action in (
    'event_created',
    'event_updated',
    'event_status_changed',
    'candidate_added',
    'candidate_updated',
    'candidate_removed',
    'suggestions_added',
    'results_applied'
  ));

commit;
