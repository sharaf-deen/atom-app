-- Staff Payroll 2B — Required Actual Hours
--
-- Quantity remains an operational count (classes, meetings, events, etc.).
-- Payroll compensation always uses actual hours, weighted by task importance.
-- Existing incomplete rows are preserved for correction or audited removal.

begin;

alter table public.staff_monthly_task_logs
  add constraint staff_monthly_task_logs_active_actual_hours_required_chk
  check (voided_at is not null or actual_hours is not null)
  not valid;

comment on constraint staff_monthly_task_logs_active_actual_hours_required_chk
  on public.staff_monthly_task_logs is
  'Requires actual hours for every active payroll task. NOT VALID preserves older incomplete rows until they are corrected or voided.';

commit;
