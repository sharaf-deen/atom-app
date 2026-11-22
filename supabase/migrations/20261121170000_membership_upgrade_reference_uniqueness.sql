-- An actual bank or InstaPay transaction reference must not be reused to approve multiple upgrades.
-- Index uses case/whitespace normalization. Only new *supplemental cash receipts* are protected.
create unique index if not exists membership_upgrades_unique_bank_payment_ref
on public.membership_upgrades (lower(btrim(bank_reference)))
where payment_method in ('instapay','bank_transfer')
  and additional_payment_egp > 0
  and bank_reference is not null;
