-- Expenses 5C — Expense Categories Cleanup & Classification
--
-- Goals:
--   * make expense entry easier with clearer operational groups;
--   * preserve all historical expense rows and category keys;
--   * keep Staff Payroll exclusion keys unchanged:
--       coaches, reception, assistants, bonuses;
--   * add missing ATOM-specific categories for mall charges, technology,
--     federation/government fees, professional services, and payment fees.
--
-- This migration changes reference data only. It does not update public.expenses.

begin;

insert into public.expense_categories (key, label, group_name, is_active, sort_order)
values
  -- Premises & Facilities
  ('rent', 'Rent', 'Premises & Facilities', true, 10),
  ('mall_service_charges', 'Mall / Service Charges', 'Premises & Facilities', true, 20),
  ('utilities', 'Utilities', 'Premises & Facilities', true, 30),
  ('internet', 'Internet & Phone', 'Premises & Facilities', true, 40),
  ('cleaning', 'Cleaning & Hygiene', 'Premises & Facilities', true, 50),
  ('maintenance', 'Maintenance & Repairs', 'Premises & Facilities', true, 60),
  ('security', 'Security', 'Premises & Facilities', true, 70),

  -- Staff / Payroll
  -- IMPORTANT: these four keys are intentionally unchanged because Staff Payroll
  -- excludes them from operating expenses to prevent double counting.
  ('coaches', 'Coaches', 'Staff / Payroll', true, 110),
  ('reception', 'Reception', 'Staff / Payroll', true, 120),
  ('assistants', 'Assistants', 'Staff / Payroll', true, 130),
  ('bonuses', 'Bonuses', 'Staff / Payroll', true, 140),

  -- Operations & Supplies
  ('training_equipment', 'Training Equipment', 'Operations & Supplies', true, 210),
  ('cleaning_supplies', 'Cleaning Supplies', 'Operations & Supplies', true, 220),
  ('office', 'Office Supplies', 'Operations & Supplies', true, 230),
  ('drinks', 'Drinks & Refreshments', 'Operations & Supplies', true, 240),
  ('food', 'Food / Staff Meals', 'Operations & Supplies', true, 250),
  ('transportation', 'Transportation & Delivery', 'Operations & Supplies', true, 260),

  -- Technology
  ('software_online_services', 'Software & Online Services', 'Technology', true, 310),
  ('website', 'Website & Domains', 'Technology', true, 320),

  -- Marketing
  ('social_media', 'Advertising & Social Media', 'Marketing', true, 410),
  ('printing', 'Printing', 'Marketing', true, 420),
  ('design', 'Design & Content', 'Marketing', true, 430),

  -- Events & Competition
  ('events', 'Events', 'Events & Competition', true, 510),
  ('competition', 'Competitions', 'Events & Competition', true, 520),
  ('camps', 'Camps', 'Events & Competition', true, 530),

  -- Administration & Compliance
  ('federation_fees', 'Federation Fees', 'Administration & Compliance', true, 610),
  ('government_licensing_fees', 'Government / Licensing Fees', 'Administration & Compliance', true, 620),
  ('legal', 'Legal', 'Administration & Compliance', true, 630),
  ('accounting_professional_services', 'Accounting & Professional Services', 'Administration & Compliance', true, 640),

  -- Finance
  ('bank_fees', 'Bank Fees', 'Finance', true, 710),
  ('pos_payment_fees', 'POS / Payment Fees', 'Finance', true, 720),

  -- Other
  ('other', 'Miscellaneous Operating Expense', 'Other', true, 990)
on conflict (key) do update
set
  label = excluded.label,
  group_name = excluded.group_name,
  is_active = excluded.is_active,
  sort_order = excluded.sort_order;

-- `supplies` was historically a broad catch-all. Keep the row for historical
-- joins/exports, but stop offering it for new entries now that more precise
-- categories exist. No public.expenses row is changed.
update public.expense_categories
set is_active = false,
    group_name = 'Legacy',
    sort_order = 9990
where key = 'supplies';

-- Do not unexpectedly activate or rename any other custom categories that may
-- have been created outside this canonical list. Existing custom data remains
-- untouched.

commit;
