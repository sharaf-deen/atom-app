# CIB merchant report preview — release notes

This increment introduces a **read-only**, Super Admin-only preview at `/admin/banking/cib-preview`. It compares CSV exports from CIB Daily Transactions List and Merchant Statements Enquiry, aggregated by settlement date and account, while also grouping card sales by transaction month.

## Safeguards
- No Supabase write or import in this increment.
- Only authenticated Super Admin can access the page and API.
- CSV files (UTF-8, up to 2 MB each), CIB columns validated, max 10,000 rows.
- Only terminal `28276801` accepted in transaction file.
- Invalid arithmetic, duplicate transactions or mismatched settlement totals fail closed or are flagged.
- No card numbers or approval codes are returned to the browser in the response.
- Date columns accept Excel serial dates, YYYY-MM-DD and DD/MM/YYYY.

## Acceptance on Staging
1. Download CIB Daily Transactions and Daily Merchants reports; save as separate CSV UTF-8 exports. Combine multiple transactions date-range exports without repeating headers.
2. Open `/admin/banking/cib-preview` as Super Admin; import both CSV files.
3. Confirm 73 transactions, 22 merchant settlement dates, all 22 totals matched on the supplied October/November sample (if the same source reports are used).
4. Verify by-sale-month totals for October: 52 transactions, 166388.21 EGP gross, -2919.73 EGP commission, 163468.48 EGP net.
5. Modify a test CSV amount by one EGP; confirm validation fails due to row arithmetic or a settlement difference appears.
6. Verify ordinary member/admin roles cannot use endpoint.
7. Verify Production Banking, Payments, Banking reconciliation and Staff Payroll remain unchanged.

## Out of scope — required before October close
- Direct XLSX upload, persistent CIB import history, transaction-to-payment matching, bank-settlement reconciliation, refunds/chargebacks, individual commission accounting and explicit Super Admin approval for updates.
- Do not count merchant settlement credits as new revenue.
