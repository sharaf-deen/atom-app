-- supabase/seed.sql
-- Minimal & robust seed (safe to re-run).
-- Goal: ensure the app has essential reference data after any reset, without seeding business data.

begin;

-- 1) Roles (reference data)
insert into public.roles (id, label)
values
  ('member', 'Member'),
  ('assistant_coach', 'Assistant Coach'),
  ('coach', 'Coach'),
  ('reception', 'Reception'),
  ('admin', 'Admin'),
  ('super_admin', 'Super Admin')
on conflict (id) do update
set label = excluded.label;

-- 2) Expense categories (reference data)
-- Table schema (from drift_public.sql): key, label, group_name, is_active, sort_order
insert into public.expense_categories (key, label, group_name, is_active, sort_order)
values
  ('rent', 'Rent', 'Operations', true, 10),
  ('utilities', 'Utilities', 'Operations', true, 20),
  ('supplies', 'Supplies', 'Operations', true, 30),
  ('maintenance', 'Maintenance', 'Operations', true, 40),
  ('marketing', 'Marketing', 'Operations', true, 50),
  ('salary', 'Salaries', 'Operations', true, 60),
  ('other', 'Other', 'Operations', true, 999)
on conflict (key) do update
set
  label = excluded.label,
  group_name = excluded.group_name,
  is_active = excluded.is_active,
  sort_order = excluded.sort_order;

-- 3) Super admin bootstrap (NO password seeded)
-- We seed an allowlist email only.
-- If the allowlist table doesn't exist (e.g. migration skipped), we silently skip.
-- Table is created by migration: 20260228220000_super_admin_allowlist_bootstrap.sql

do $$
begin
  begin
    insert into public.super_admin_allowlist (email)
    values ('charaf.dellal@gmail.com')
    on conflict (email) do nothing;
  exception
    when undefined_table then
      -- ignore
      null;
  end;
end;
$$;

commit;
