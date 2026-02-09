-- Adds sender-side soft delete for notifications "Sent" view

alter table public.notifications
  add column if not exists deleted_for_sender_at timestamp with time zone;

-- Helpful partial index for Sent list (created_by + not deleted)
create index if not exists idx_notifications_created_by_not_deleted_sender
  on public.notifications (created_by, created_at desc)
  where deleted_for_sender_at is null;
