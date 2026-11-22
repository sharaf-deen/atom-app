# ATOM Subscription Edit — Financial & Contract Integrity Hardening

## Policy

The generic **Edit subscription** control is an administrative-correction tool, not a
payment, upgrade, refund, freeze or financial-invoice workflow.

| Operation | Authorized workflow |
| --- | --- |
| Payment or outstanding balance | Payment / settle due |
| Payment method correction | Correct payment method |
| Upgrade to a longer subscription | Membership Upgrade (Super Admin) |
| Renew membership | Membership Renewals |
| Freeze or unfreeze | Freeze tokens |
| Refund | Membership Refunds |
| Reissue a financial invoice | Audited invoice-specific correction (not Edit) |
| Change package/date on financially committed plan | Separate audited exceptional correction (not Edit) |
| Correct package/date on uncommitted plan | Super Admin Edit, reason required |

## Server-side, not just UI

- Reject financial amount, amount_due and payment-method edits **unconditionally**.
- Reject plan/date/session/status edits when the subscription has a paid or due
  amount, is cancelled, or has linked ledger payments, invoices, upgrades,
  refunds, freeze history or a pending renewal.
- A Super Admin can correct an uncommitted subscription only with a
  12–1000 character reason. The intended change is logged before mutation.
- Any history lookup error fails closed. No direct invoice rewrite from Edit.
- An optimistic compare-and-swap checks the original plan, dates, status, paid
  and due amounts, payment method, freeze state and session counters. A
  concurrent payment or upgrade cannot be silently overwritten.

## Explicit limitations

The generic Edit form is intentionally *read-only* for financially committed
subscriptions. A future purpose-built exceptional correction flow must handle
necessary changes to existing contracts, with immutable old/new snapshots,
explicit reason and linked finance/invoice reconciliation. It must not be
implemented by bypassing these checks.

This PR is code-only. No Supabase migrations or Production writes.

## Regression acceptance

- CI executable pure-field classification and source contract tests.
- Existing payment-correction regression retained with stronger Edit rule.
- Typecheck/build, Vercel Preview, DB Reset + Smoke PASS.
- Manual Staging review should confirm that a 12m subscription with 7,100 EGP
  received and 7,300 EGP due displays read-only financial/contract data.
- Manual Staging zero-value fixture may test a reasoned correction; ensure
  audit records and no unintended invoice or income event.
- Final Production deploy only after PR approval and checks.
