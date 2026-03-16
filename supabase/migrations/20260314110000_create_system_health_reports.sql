create table if not exists public.system_health_reports (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  actor_user_id uuid null,
  mode text not null default 'manual',
  overall_status text not null,
  email_sent boolean not null default false,
  email_error text null,
  email_recipients text[] not null default '{}',
  summary jsonb not null
);

alter table public.system_health_reports enable row level security;

create index if not exists idx_system_health_reports_created_at
  on public.system_health_reports (created_at desc);

create index if not exists idx_system_health_reports_status_created_at
  on public.system_health_reports (overall_status, created_at desc);

alter table public.system_health_reports
  add constraint system_health_reports_actor_user_fk
  foreign key (actor_user_id) references public.profiles(user_id)
  on delete set null;

revoke all on public.system_health_reports from anon;
revoke all on public.system_health_reports from authenticated;
grant all on public.system_health_reports to service_role;
