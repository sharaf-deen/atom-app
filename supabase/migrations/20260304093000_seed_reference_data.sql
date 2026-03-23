-- Seed essential reference data (idempotent)
-- Ensures roles + expense_categories exist in staging/prod (migrations-only deploy).
-- Safe to run multiple times.

begin;

do $$
begin
  if to_regclass('public.roles') is not null then
    insert into public.roles (id, label)
    values
      ('member', 'Member'),
      ('champion', 'Champion'),
      ('vip', 'VIP'),
      ('assistant_coach', 'Assistant Coach'),
      ('coach', 'Coach'),
      ('head_coach', 'Head Coach'),
      ('reception', 'Reception'),
      ('admin', 'Admin'),
      ('super_admin', 'Super Admin')
    on conflict (id) do update
      set label = excluded.label;
  end if;
end $$;

do $$
begin
  if to_regclass('public.expense_categories') is not null then
    -- key, label, group_name, is_active, sort_order
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
  end if;
end $$;

commit;
