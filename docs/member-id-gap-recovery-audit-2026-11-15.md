# ATOM Member ID Recovery — Production inventory audit

**Date:** 15 November 2026  
**Scope:** Gap inventory between ATOM-000001 and ATOM-000597  
**Source:** Read-only Supabase Production queries. No profile deletion or Member ID approval performed as part of this audit.

## Findings

- **24 missing numeric IDs** in the current `profiles` table.
- **2 already approved for reissue:** ATOM-000595, ATOM-000593. Both have separate release records, with 000595 first in FIFO order.
- **17 with historical deletion events in `audit_logs`:** ATOM-000002, ATOM-000005, ATOM-000034, ATOM-000044, ATOM-000046, ATOM-000047, ATOM-000051, ATOM-000077, ATOM-000095, ATOM-000118, ATOM-000120, ATOM-000122, ATOM-000136, ATOM-000138, ATOM-000148, ATOM-000184, ATOM-000237.
- **5 without evidence in checked databases:** ATOM-000014, ATOM-000052, ATOM-000312, ATOM-000472, ATOM-000504. Their absence from examined records **does not establish that they were never issued**.

## Evidence sources examined

`profiles`, `member_id_reissue_queue`, `audit_logs.action_details`, `scan_audit.member_code`, `store_sales.buyer_member_id`, `coach_member_incidents.member_code_snapshot`, `coach_staff_attendance.staff_member_id_snapshot`, and `family_duplicate_recovery_audit`.

Other outside-the-database evidence cannot be ruled out, including photographs, physical membership cards, QR codes, invoices, exports, messages, historic backups and external spreadsheets. Therefore the 5 unproven gaps require independent Super Admin review and documented attestation.

## Retention and release decision

1. Preserve the existing queue for ATOM-000595 then ATOM-000593. They were individually checked, deleted by a specific Super Admin-approved recovery procedure, and audited.
2. Do **not** automatically release the 17 IDs that show historical use/deletion. Mark `historical_do_not_reissue` and require bespoke investigation for any exception.
3. Mark the 5 zero-evidence gaps `manual_review` and do **not** automatically approve them. Only a Super Admin can approve after independent checks and a reason (35+ characters); evidence is checked again immediately before queue insertion.
4. Capture all future deleted `profiles` IDs and UUIDs in `member_id_deletion_events`. An archival error with no Auth, family, payment, scan or other FK/textual history can be released with an explicit Super Admin confirmation; complex records require a case-specific audited correction.
5. Audit the gaps automatically each day at **03:00 UTC** via `pg_cron`, and on Super Admin screen visits; never automatically delete, release or reissue on an audit scan.

## Acceptance / consolidated checks

- Staging: approved zero-evidence test gap consumed by a new member and marked used; fixture rolled back.
- Staging: archived errored member deleted via guarded RPC, deletion tombstone and queue recorded, refreshed scan recognizes queued status; fixture rolled back.
- RLS and service role: no direct anonymous or authenticated RPC execution; only Super Admin via server route.
- Final gates: GitHub CI, DB Reset + Smoke, Vercel Preview. Do not deploy or approve old IDs until all gates pass.

**Production at audit time:** all 22 older gaps remain unapproved. The existing 000595/000593 queue remains unchanged.
