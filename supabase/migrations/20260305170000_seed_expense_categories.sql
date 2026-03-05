-- Seed/align expense_categories (idempotent)
-- This keeps reference data consistent across staging/prod.
-- It upserts the canonical list and deactivates only *unused* categories that are not in the list.

insert into public.expense_categories (key, label, group_name, is_active, sort_order)
values
  ('rent', 'Rent', 'Fixed & Admin', true, 10),
  ('utilities', 'Utilities', 'Fixed & Admin', true, 20),
  ('internet', 'Internet', 'Fixed & Admin', true, 30),
  ('cleaning', 'Cleaning', 'Fixed & Admin', true, 40),
  ('maintenance', 'Maintenance', 'Fixed & Admin', true, 50),
  ('security', 'Security', 'Fixed & Admin', true, 60),
  ('coaches', 'Coaches', 'HR', true, 110),
  ('reception', 'Reception', 'HR', true, 120),
  ('assistants', 'Assistants', 'HR', true, 130),
  ('bonuses', 'Bonuses', 'HR', true, 140),
  ('drinks', 'Drinks', 'Drinks & Consumables', true, 210),
  ('supplies', 'Supplies', 'Drinks & Consumables', true, 220),
  ('printing', 'Printing', 'Marketing', true, 310),
  ('social_media', 'Social Media', 'Marketing', true, 320),
  ('website', 'Website', 'Marketing', true, 330),
  ('design', 'Design', 'Marketing', true, 340),
  ('events', 'Events', 'Events', true, 410),
  ('competition', 'Competition', 'Events', true, 420),
  ('camps', 'Camps', 'Events', true, 430),
  ('transportation', 'Transportation', 'Other', true, 510),
  ('office', 'Office', 'Other', true, 520),
  ('food', 'Food', 'Other', true, 530),
  ('legal', 'Legal', 'Other', true, 540),
  ('other', 'Other', 'Other', true, 999)
on conflict (key) do update
set
  label      = excluded.label,
  group_name = excluded.group_name,
  is_active  = excluded.is_active,
  sort_order = excluded.sort_order;

-- Deactivate extra categories that are NOT in the canonical list,
-- but only if they are not referenced by any expenses (so we don't break historical data).
update public.expense_categories ec
set is_active = false
where ec.key not in ('rent', 'utilities', 'internet', 'cleaning', 'maintenance', 'security', 'coaches', 'reception', 'assistants', 'bonuses', 'drinks', 'supplies', 'printing', 'social_media', 'website', 'design', 'events', 'competition', 'camps', 'transportation', 'office', 'food', 'legal', 'other')
  and not exists (
    select 1
    from public.expenses e
    where e.category_key = ec.key
  );
