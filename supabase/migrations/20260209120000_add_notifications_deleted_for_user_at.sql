-- Add per-recipient soft delete for notifications
-- This allows members/coaches to "delete" a message from their inbox without removing it from admin/sender views.

alter table public.notifications
  add column if not exists deleted_for_user_at timestamptz null;

-- Helpful index for inbox queries (optional but recommended)
create index if not exists notifications_user_deleted_idx
  on public.notifications (user_id, deleted_for_user_at, created_at desc);
