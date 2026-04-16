-- Freeze foundation hardening
-- Keep the existing subscription_freezes model, but add the minimum audit columns
-- required for future edit / clear / delete workflows.

alter table public.subscription_freezes
  add column if not exists updated_at timestamptz null,
  add column if not exists updated_by uuid null references public.profiles(user_id) on delete set null,
  add column if not exists cleared_by uuid null references public.profiles(user_id) on delete set null;

update public.subscription_freezes
set updated_at = coalesce(updated_at, created_at)
where updated_at is null;
