# ATOM Membership Upgrades — V1

## Business policy
- No arbitrary elapsed-time limit. A Super Admin authorizes each upgrade.
- Upgrade must be to a higher time-based membership plan; no automatic downgrade.
- Prorated unused value = (previous cash collected **plus prior carried upgrade credit**) × inclusive remaining days ÷ inclusive original coverage days.
- Current open dues, pending refunds, unresolved freezes, or open renewal requests trigger a finance-review block. No silent write-off or double-credit.
- A Super Admin may select **Payment Date**, including an actual date before today in Cairo. It is stored as the new payment's `subscription_payments.paid_at`. **Upgrade effective date** always uses Cairo's current date; it is never backdated merely because the payment was received earlier.
- Only the new supplemental cash/transfer is posted to the accounting ledger; transferred credit is separately recorded, **never** booked as a second payment.
- The Super Admin explicitly attests receipt, chooses payment method and provides an InstaPay/bank reference when appropriate. A reused bank reference is prevented at database level.
- Original membership/payment history remains, original subscription is marked cancelled, the new plan starts today and continues for the selected full duration.
- Exact selected payment date and immutable financial snapshots retained in `membership_upgrades`. Idempotency prevents duplicate approval.

## Implementation in branch
- Pure math `membershipUpgradeMath.ts` with inclusive date calculation.
- Read-only preview API `GET /api/admin/membership-upgrades/quote` and apply API `POST /api/admin/membership-upgrades/apply`, both Super Admin restricted.
- Admin page `/admin/membership-upgrades`, entry in navigation, and a contextual **Upgrade** link from current member subscription.
- Atomic Postgres function `apply_membership_upgrade_v1` (security definer, service-role-only) checks actor, eligibility, ledger consistency, refreshed quote, price uniqueness, dates, due and pending workflows inside one transaction.
- History table with RLS enabled, no client writes and immutable records.
- Backdated payment is saved as paid_at on both the new subscription's additional payment and subscription header. Existing receipts are unchanged.
- Receipt verification is **manual attestation** and does not mean the transfer was automatically matched to an imported bank statement.

## Staging verification
- Migration and bank-reference index were successfully applied on Supabase Staging only.
- A fictional payment on a Staging test member was simulated in a PostgreSQL transaction and **rolled back**. Confirmed original payment preserved, prorated credit 733.33 EGP, new supplemental payment 4516.67 EGP dated five days earlier, no duplicate booking, previous subscription cancelled, new active, and idempotent retry.
- A stale quote was rejected without side effects; **rollback confirmed** 0 fictional subscriptions, 0 fictional payments, 0 upgrade records.
- CI / DB Reset + Smoke / Vercel PR checks are separate release gates. No real HTTP/browser end-to-end approval has yet been accepted as verified.

## Release boundaries / remaining gates
1. Confirm CI, DB Reset + Smoke and Vercel build on the **final commit**.
2. Execute a fictional Staging **actual UI/API** upgrade end-to-end with approved financial verification and inspect ledger, dates and notifications; test denied roles and payment-date boundary cases. Never use a real bank statement for fake payments.
3. Validate manual Payment Reconciliation for an intentionally historical paid_at date. If the date falls in an already validated daily period, investigate/revalidate explicitly; this module does **not** silently adjust an old validated batch.
4. Review refund-after-upgrade handling, credit transfer across repeated upgrades, and invoice issuance with current accounting workflows.
5. Validate backup/rollback for schema migration, confirm Production has not applied the migration, obtain explicit Production approval, apply migration before PR merge, and run Production smoke.

**Do not merge or deploy to Production before gates 1–5 and explicit Production approval.**
