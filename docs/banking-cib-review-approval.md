# CIB Reconciliation — Review & Approval

## Implementation
- Super Admin review panel on the existing CIB transaction preview after the CSV has been analyzed.
- Select one CIB transaction and 1–4 individually or group-suggested ATOM card payments.
- Explicit evidence note required. An approval records the CIB batch, transaction and settlement dates, authorization code, gross amount, actor, evidence, source IDs and amounts.
- Read-only audit history with explicit release and mandatory reason. The original record is not deleted.
- Approval is an **audit assertion only**. No bank or revenue entries are changed.

## Database safeguards
- All-or-nothing PostgreSQL RPC with advisory lock, active CIB transaction uniqueness and active ATOM source uniqueness.
- Server-side cross-check of exact gross in integer cents; source exists, card method, paid Store status, and Cairo-local source date within ±1 day.
- Service-role-only SQL functions; RLS enabled and direct client table access revoked.
- Releasing an allocation unblocks its sources, retaining the historical item snapshots.

## Required release order
1. Migration is already applied and inspected in **Staging only**.
2. CI, DB Reset + Smoke and manual Staging functional tests must pass. Test that 9,000 and 19,500 grouped candidates can be prepared, an evidence note is required and no accounting write occurs.
3. Merge PR, apply migration in **Production** through the approved deployment procedure, then deploy app.
4. Confirm the migration is present before using the approval panel.
5. Approve only with independent supporting documentation. A combination suggested by equal date/sum is insufficient alone. For Oct 1, the 9,000 CIB transaction conflicts with another 4,500 CIB candidate; do not approve by inference alone.

## Explicit limitations
- CIB card transaction identity comes from the CSV supplied by the Super Admin, not from a bank-signed API.
- There is no external validation of receipt authenticity. The manual reviewer bears responsibility for evidence review.
- The panel is not a replacement for existing merchant settlement/bank transaction matching or payment validation.
- Audit listing is capped at the latest 300 approvals; older entries remain in the database.
