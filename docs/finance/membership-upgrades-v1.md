# ATOM Membership Upgrades — V1 (design and safety gates)

**Current branch status:** Read-only quoting foundation; NOT a complete upgrade workflow. No Production changes.

## Authorized operating policy
- No fixed time-window limitation. Super Admin explicitly authorizes each upgrade.
- Determine unused credit from actual historical payments and days of unconsumed coverage (Cairo dates, inclusive).
- Previously received money is **credit**, NOT an additional bank/cash receipt. No copying original subscription payments into a second payment entry.
- New plan begins on *upgrade effective date*, independent of when the new payment was received.
- **Historical Payment Date** is selectable by the Super Admin, including dates before today's Cairo date; never auto-backdate effective membership dates.
- Actual payment history, refunds, outstanding dues, bank matches and freeze history must be reconciled before mutation.
- Upon any final transaction, preserve old subscription/payment ledger and an immutable audit with old/new plan, start/end dates, credit calculation, Super Admin, actual payment amount, payment method and payment date.

## Draft functionality in this PR
1. Pure inclusive-day, monetary upgrade quote helper; rejects non-higher plans and over-credit.
2. Read-only Super Admin quote route with package pricing from database and payment ledger from actual records.
3. Preview screen with editable historical payment date.
4. Blocks a quote when old dues, a refund, an unresolved freeze, mismatched ledger, inactive plan or ambiguous package price is detected.

## Release gates still pending
1. Approve/reject request state and record immutable old/new financial snapshots.
2. Create atomic, idempotent Postgres transaction to replace active coverage and record **only the real additional received money**, never the transferred credit.
3. Save historical `paid_at` on the additional ledger payment and use same accounting date in reconciliation/invoice workflow; explicit Super Admin permission for backdating.
4. Protect active refunds, allocations/bank matches, historical validated batches, freezes, concurrent renewal/upgrade operations, partial payments, overpayments, and accounting report integrity.
5. Build positive end-to-end functional UI and tests using fictional Staging member and post-transaction invariants, then Production sign-off separately.

**DO NOT MERGE this quote-foundation branch as a finished V1 or apply any migration to Production.**
