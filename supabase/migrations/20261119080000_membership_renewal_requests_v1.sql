-- ATOM Membership Renewal Requests V1 - additive, no data migration.
-- All mutations must be authorized by the server API. RLS permits only owner SELECT.
create table if not exists public.membership_renewal_requests (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles(user_id),
  requested_by uuid not null references auth.users(id),
  last_actor_id uuid references auth.users(id),
  source_subscription_id uuid references public.subscriptions(id) on delete set null,
  completed_subscription_id uuid unique references public.subscriptions(id) on delete set null,
  package_id uuid references public.packages_pricing(id) on delete set null,
  plan text not null check (plan in ('1w','1m','3m','6m','12m')),
  status text not null default 'pending_review' check (status in
    ('pending_review','changes_requested','awaiting_payment','payment_verification','ready_to_renew','completed','rejected','cancelled')),
  preferred_payment_method text not null check (preferred_payment_method in ('instapay','bank_transfer','card','cash')),
  catalog_price_egp numeric(12,2) not null check (catalog_price_egp >= 0),
  quoted_price_egp numeric(12,2) not null check (quoted_price_egp >= 0),
  approved_price_egp numeric(12,2) check (approved_price_egp >= 0),
  pricing_snapshot jsonb not null default '{}'::jsonb,
  member_comment text,
  admin_note text,
  decision_reason text,
  approved_by uuid references auth.users(id),
  payment_verified_at timestamptz,
  payment_verified_by uuid references auth.users(id),
  payment_verification_reference text,
  payment_verified_amount_egp numeric(12,2) check (payment_verified_amount_egp >= 0),
  approved_at timestamptz,
  completed_by uuid references auth.users(id),
  completed_at timestamptz,
  cancelled_at timestamptz,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint renewal_completed_link check (status <> 'completed' or (completed_subscription_id is not null and completed_at is not null)),
  constraint renewal_verified_before_ready check (status not in ('ready_to_renew','completed') or (payment_verified_at is not null and payment_verified_amount_egp >= approved_price_egp)),
  constraint renewal_approval_price check (status not in ('awaiting_payment','payment_verification','ready_to_renew','completed') or approved_price_egp is not null)
);
create unique index if not exists membership_renewal_one_open_per_member
  on public.membership_renewal_requests(member_id)
  where status in ('pending_review','changes_requested','awaiting_payment','payment_verification','ready_to_renew');
create index if not exists membership_renewal_requests_admin_queue_idx
  on public.membership_renewal_requests(status,created_at desc);
create index if not exists membership_renewal_requests_member_idx
  on public.membership_renewal_requests(member_id,created_at desc);

create table if not exists public.membership_renewal_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.membership_renewal_requests(id) on delete restrict,
  actor_id uuid references auth.users(id),
  event_type text not null,
  previous_status text,
  next_status text,
  member_summary text,
  admin_details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists membership_renewal_events_request_idx
  on public.membership_renewal_events(request_id,created_at,id);

create table if not exists public.membership_renewal_proofs (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.membership_renewal_requests(id) on delete restrict,
  uploaded_by uuid not null references auth.users(id),
  storage_path text not null unique,
  original_filename text not null,
  mime_type text not null check (mime_type in ('image/jpeg','image/png','application/pdf')),
  file_size_bytes integer not null check (file_size_bytes > 0 and file_size_bytes <= 10485760),
  declared_amount_egp numeric(12,2) check (declared_amount_egp > 0),
  declared_payment_reference text,
  review_status text not null default 'pending' check (review_status in ('pending','verified','rejected')),
  verified_amount_egp numeric(12,2) check (verified_amount_egp > 0),
  verified_at timestamptz,
  verified_by uuid references auth.users(id),
  linked_subscription_payment_id uuid unique references public.subscription_payments(id) on delete set null,
  admin_review_note text,
  created_at timestamptz not null default now(),
  constraint renewal_proof_review_consistency check (
    (review_status = 'verified' and verified_amount_egp is not null and verified_by is not null and verified_at is not null)
    or (review_status <> 'verified' and verified_amount_egp is null)
  )
);
create index if not exists membership_renewal_proofs_request_idx
  on public.membership_renewal_proofs(request_id,created_at);

-- All request data includes confidential administrative fields; no client-side table access.\n-- Server routes must authenticate and authorize before using the service-role client.\nalter table public.membership_renewal_requests enable row level security;\nalter table public.membership_renewal_events enable row level security;\nalter table public.membership_renewal_proofs enable row level security;\nrevoke all on public.membership_renewal_requests from anon, authenticated;\nrevoke all on public.membership_renewal_events from anon, authenticated;\nrevoke all on public.membership_renewal_proofs from anon, authenticated;\n\n-- Only authenticated server routes can access objects through a short-lived signed URL.
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('membership-renewal-proofs','membership-renewal-proofs',false,10485760,
  array['image/jpeg','image/png','application/pdf'])
on conflict (id) do nothing;

-- Events must never be changed or removed, even by privileged application code.
create or replace function public.atom_renewal_event_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Membership renewal history is append-only';
end; $$;
drop trigger if exists renewal_event_immutable on public.membership_renewal_events;
create trigger renewal_event_immutable before update or delete
  on public.membership_renewal_events for each row execute function public.atom_renewal_event_immutable();

-- Transactional status/version audit: an event is always inserted with its request write.
create or replace function public.atom_renewal_audit_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.version <> old.version + 1 then raise exception 'Renewal version must increment by one'; end if;
    new.updated_at = now();
  end if;
  return new;
end; $$;
drop trigger if exists renewal_before_change on public.membership_renewal_requests;
create trigger renewal_before_change before update on public.membership_renewal_requests
  for each row execute function public.atom_renewal_audit_change();

create or replace function public.atom_renewal_log_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  insert into public.membership_renewal_events
    (request_id,actor_id,event_type,previous_status,next_status,member_summary,admin_details)
  values (new.id, coalesce(new.last_actor_id,new.requested_by),
    case when tg_op = 'INSERT' then 'submitted' when new.status <> old.status then 'status_changed' else 'edited' end,
    case when tg_op = 'INSERT' then null else old.status end,
    new.status, replace(new.status,'_',' '),
    jsonb_build_object('version',new.version,'plan',new.plan,'approved_price_egp',new.approved_price_egp));
  return new;
end; $$;
drop trigger if exists renewal_log_change on public.membership_renewal_requests;
create trigger renewal_log_change after insert or update on public.membership_renewal_requests
  for each row execute function public.atom_renewal_log_change();
