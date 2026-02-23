# Patch: Membership Activity Log - write audit logs for subscriptions

This patch adds best-effort inserts into `audit_logs` when:
- a subscription is created (`subscription_create`)
- a subscription is updated (`subscription_update`)
- a due is settled (`subscription_due_settle`)

## Apply
Unzip at the project root so files are replaced.

## Then
- npm run build
- git add -A
- git commit -m "Audit: log subscription actions"
- git push origin main
