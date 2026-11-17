# ATOM Banking — CIB individual card payment candidate review

## Included
A second section on `/admin/banking/cib-preview` accepts the CIB Daily Transactions CSV. Super Admin sees read-only candidate links between each CIB card transaction and existing ATOM records:
- subscription_payments with `payment_method = card`
- store_sales with `payment_method = card` and positive paid amount
- external_income_entries with `payment_method = card`

Each comparison requires an exact gross amount and dates within one Cairo-local calendar day. A unique ATOM record with an approval code in its note is a **reference candidate**, not an automatic accounting match. One amount/date possibility is marked **unverified**. Multiple possibilities or reuse of one ATOM record are **ambiguous**. Missing matches are **unmatched**.

## Safety
- Server checks Super Admin role on every request; client view is role-gated separately.
- Files are parsed in memory with no persistent upload.
- No database writes, no automatic transaction/payment assignment, no classifications or payroll changes.
- The response omits card numbers. ATOM IDs are truncated in the UI.
- Invalid account, terminal, batch, duplicate CIB transactions, overly long periods and overly large files fail closed.
- Date and amount alone do **not** establish receipt ownership.

## Staging acceptance
1. Open the existing CIB preview and upload the previously verified `ATOM_CIB_Transactions_2026-10_to_11-07.csv` to the new payment review section.
2. Verify 73 CIB transactions and 166388.21 EGP in the **October** portion of the previous preview. This new report covers all three months in the file and reports that wider total.
3. Review status filters: reference candidate, single unverified candidate, ambiguous, unmatched.
4. Confirm that a payment shared as candidate by two CIB rows is never silently declared matched.
5. As another role, verify page and API both deny access.
6. Verify no changes in Supabase payment balances, reconciliations or Staff Payroll.

## Remaining before October closure
The module is deliberately read-only. Full final reconciliation still needs an audited manual approval or source-supported matching workflow and a check of card payments recorded in other ATOM modules (including split purchases, adjusted payments, refunds or non-member revenue). Do not classify the gross gap as missing cash until those are reviewed.
