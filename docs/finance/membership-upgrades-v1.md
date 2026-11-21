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


## Comprehensive security and staging functional audit — 2026-11-21

**Database/financial acceptance: PASS (rollback-only, Staging).**
- Executed `scripts/tests/membership-upgrades-v1-local.sql` against Staging. It uses fictional identities and runs entirely inside `BEGIN/ROLLBACK` with post-test 0 fake users/subscriptions/receipts/upgrades.
- Actual 1-month -> 3-month approval, unused credit EGP 733.33, additional payment EGP 4,516.67; historical `paid_at` five days earlier while coverage starts today.
- Original receipt and contractual history retained. One new supplemental payment in `subscription_payments`; `admin_income_events_v1` sees exactly two real receipts on their respective Cairo business dates, no phantom credit payment.
- Repeated upgrade chain carries previously transferred credit once, without cloning historical receipt rows.
- Actor not Super Admin rejected; DB grants deny `anon`/`authenticated` calling RPC or reading audit table; RLS enabled and no public table policies, intentionally service-role only.
- Sequential idempotent retry and changed-payload rejection; duplicate bank reference rejected; stale quote rejected without side effects.
- Pending refund, active freeze, outstanding dues, open renewal, overlapping active coverage rejected.
- Future payment date and receipt without Super Admin attestation rejected.
- Backdated receipt in *already validated daily batch* and *cash-period batch* rejected without changing historical reconciliation. The finance operator must address already-validated periods separately.
- Upgrade history immutability trigger enforced.
- Production remains untouched.

**CI:** Executable TypeScript math cases include plan ordering, 10/30 prorata, leap-year/inclusive date, invalid date and over-credit. The GitHub `CI` job and isolated `DB Reset + Smoke` job now run these tests on every PR push; rely on the **latest** commit's check status, not older green runs.

**Staging web deployment:** Custom Staging Vercel environment was deployed from the feature branch, with Staging-specific environment variables. Protected deployment URLs currently require interactive Vercel authentication; automated GET requests were blocked at the Vercel protection layer. Thus no claim of a completed authenticated in-browser positive approval, forbidden-role HTTP 403, or actual manual bank reconciliation.

**Remaining release blockers:**
1. Successful latest-com-mit CI/DB Reset + Smoke/Vercel, then authenticated Staging UI approval with a fictional member and a verified accounting inspection.
2. Actual Staging bank reconciliation on the chosen historical business date. No actual bank statement may be imported for a fake receipt.
3. End-to-end invoice and refund-after-upgrade policy: current refund workflows can see only new supplemental receipt on the replacement subscription; transferred credit needs an explicit refund calculation policy and audit before releasing financial refunds on upgraded contracts.
4. Concurrency with two truly simultaneous HTTP approvals has not been load-tested (Postgres old-subscription row lock, unique index and idempotency provide structural protection).
5. Obtain explicit Production migration approval and separate Production smoke. Do not merge PR #1425 on CI status alone.

## Release boundaries / remaining gates
1. Confirm CI, DB Reset + Smoke and Vercel build on the **final commit**.
2. Execute a fictional Staging **actual UI/API** upgrade end-to-end with approved financial verification and inspect ledger, dates and notifications; test denied roles and payment-date boundary cases. Never use a real bank statement for fake payments.
3. Validate manual Payment Reconciliation for an intentionally historical paid_at date. If the date falls in an already validated daily period, investigate/revalidate explicitly; this module does **not** silently adjust an old validated batch.
4. Review refund-after-upgrade handling, credit transfer across repeated upgrades, and invoice issuance with current accounting workflows.
5. Validate backup/rollback for schema migration, confirm Production has not applied the migration, obtain explicit Production approval, apply migration before PR merge, and run Production smoke.

**Do not merge or deploy to Production before gates 1–5 and explicit Production approval.**
