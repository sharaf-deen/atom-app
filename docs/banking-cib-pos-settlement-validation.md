# ATOM Banking — CIB POS Settlement: validation plan

## Scope
This migration adds a dedicated credit category `pos_settlement` and narrows the existing CIB ATM Switch File Upload rule to terminal `28276801`. It changes future suggestions only. **It does not import merchant statements, reconcile individual card payments, create income or fees, or recalculate payroll.**

## Checks before merge (Staging only)
1. Run the migration in Staging with standard migration workflow. Verify one active category `pos_settlement`, direction `credit`.
2. Verify the existing rule is active, has category `pos_settlement`, and its regex matches `ATM Switch File Upload ... 28276801`.
3. Verify that other merchant terminal numbers, cash deposits and IPN Inward credits do not match the new pattern.
4. Confirm existing `confirmed` bank classifications are unchanged, and historical `suggested` classifications are not silently rewritten.
5. Open Smart Recognition Rules as Super Admin. Ensure `POS Settlement` appears as a Category, and that the existing rule has the expected category.
6. Verify monthly Banking totals, Payments, Income reconciliation and Staff Payroll are unchanged.

## October 2026 financial reconciliation (separate implementation)
- Import both CIB transaction-level and merchant-statement reports with source fingerprints and file hashes; use explicit Super Admin dry-run preview.
- Date by `Trx Date` for sales and `Settlement Date` for bank deposits; do not treat settlement credits as new revenue.
- Match each card transaction to exactly one ATOM payment wherever reference and amount can be substantiated; use an exception list for ambiguous or missing matches.
- Match merchant batches' net totals to CIB bank credits without double-counting commissions. Merchant fees must be represented once.
- Keep any unmatched or cross-month batches open for review.
- No mass confirmation or mutation of previously confirmed transactions without an explicit authorized correction.

## Production release
Apply migration only after Staging validation and backup. Do not bulk reclassify the 36 existing suggestions without review.
