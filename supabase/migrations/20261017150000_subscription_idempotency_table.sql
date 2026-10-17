-- Functional 1C.5A.2: persistent idempotency receipts; no historical backfill.
CREATE TABLE IF NOT EXISTS public.atom_subscription_idempotency (
  request_key uuid PRIMARY KEY,
  operation text NOT NULL CHECK (operation IN ('create', 'renew')),
  member_id uuid NOT NULL REFERENCES public.profiles(user_id),
  actor_id uuid NOT NULL REFERENCES public.profiles(user_id),
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  subscription_id uuid NOT NULL REFERENCES public.subscriptions(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);
