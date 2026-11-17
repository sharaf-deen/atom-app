-- ATOM Banking — CIB POS Settlement classification (phase 1)
-- Classification only: this migration does not create payments, reconcile income,
-- modify confirmed bank transactions or alter payroll.

insert into public.bank_categories (code, label, direction_scope, sort_order, is_active)
values ('pos_settlement', 'POS Settlement', 'credit', 305, true)
on conflict (code) do update
set label = excluded.label,
    direction_scope = excluded.direction_scope,
    sort_order = excluded.sort_order,
    is_active = true;

-- Restrict the existing broad ATM Switch rule to ATOM's verified CIB merchant terminal.
-- Do not change existing bank_transactions; only future suggestions use the revised rule.
update public.bank_classification_rules
set category_code = 'pos_settlement',
    pattern = '(ATM\\s*Switch\\s*File\\s*Upload|Switch\\s*File\\s*Upload).*28276801',
    direction_scope = 'credit',
    match_field = 'description',
    updated_at = now()
where name = 'CIB · ATM Switch File Upload'
  and rule_origin = 'cib_seed';

-- Ensure a fresh install does not silently lack the narrowly scoped CIB rule.
insert into public.bank_classification_rules
  (name, category_code, direction_scope, match_field, pattern, priority, confidence_score, rule_origin)
select
  'CIB · ATM Switch File Upload',
  'pos_settlement', 'credit', 'description',
  '(ATM\\s*Switch\\s*File\\s*Upload|Switch\\s*File\\s*Upload).*28276801',
  8, 0.9800, 'cib_seed'
where not exists (
  select 1 from public.bank_classification_rules
  where name = 'CIB · ATM Switch File Upload' and rule_origin = 'cib_seed'
);

comment on table public.bank_categories is
  'Super Admin banking categories, including POS settlements as bank clearing transfers, not new customer revenue.';
