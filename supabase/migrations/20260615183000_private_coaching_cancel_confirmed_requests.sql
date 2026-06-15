-- Private Coaching: support safe cancellation of confirmed requests.
-- This keeps a lightweight link between a confirmed request and the pass created from it.

alter table if exists public.private_coaching_passes
  add column if not exists request_id uuid references public.private_coaching_requests(id) on delete set null;

create index if not exists private_coaching_passes_request_id_idx
  on public.private_coaching_passes(request_id);

comment on column public.private_coaching_passes.request_id is
  'Private coaching request that created this pass, used for safe cancellation/audit flows.';
