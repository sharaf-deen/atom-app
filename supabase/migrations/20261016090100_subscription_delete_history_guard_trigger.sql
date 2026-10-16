-- Functional 1B.6: protect subscription deletion independently of API/UI.
-- Includes cleared freeze rows and all linked refund statuses.
create trigger trg_prevent_subscription_history_deletion
before delete on public.subscriptions
for each row execute function public.prevent_subscription_history_deletion();
