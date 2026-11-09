-- Staff Payroll: auditable adjustments to payroll expense basis, without altering ledger cash entries.
create table if not exists public.staff_payroll_expense_basis_exclusions (
 month_start date not null,
 expense_id uuid not null references public.expenses(id) on delete restrict,
 excluded_amount numeric(14,2) not null check (excluded_amount > 0),
 reason text not null check (char_length(btrim(reason)) >= 20 and char_length(reason) <= 1500),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 updated_by uuid not null references auth.users(id),
 updated_at timestamptz not null default now(),
 primary key(month_start,expense_id),
 constraint staff_payroll_basis_month_first_day check (month_start=date_trunc('month',month_start)::date)
);
create index if not exists staff_payroll_basis_month_idx on public.staff_payroll_expense_basis_exclusions(month_start);
alter table public.staff_payroll_expense_basis_exclusions enable row level security;
revoke all on public.staff_payroll_expense_basis_exclusions from anon, authenticated;
-- Only server-side Super Admin authorization can write via service-role API.
create or replace function public.staff_payroll_expense_basis_exclusion_guard()
returns trigger language plpgsql set search_path=public as $$
declare v_expense record;
begin
 select date,amount,category_key into v_expense from public.expenses where id=new.expense_id;
 if not found or v_expense.date < new.month_start
  or v_expense.date >= (new.month_start + interval '1 month')::date
  or v_expense.category_key in ('coaches','reception','assistants','bonuses')
  or new.excluded_amount > v_expense.amount
 then raise exception 'INVALID_PAYROLL_EXPENSE_BASIS_EXCLUSION'; end if;
 if exists(select 1 from public.staff_payroll_monthly_snapshots
           where month_start=new.month_start and status='approved')
 then raise exception 'PAYROLL_MONTH_APPROVED'; end if;
 return new;
end $$;
drop trigger if exists staff_payroll_expense_basis_exclusion_guard_trg on public.staff_payroll_expense_basis_exclusions;
create trigger staff_payroll_expense_basis_exclusion_guard_trg
before insert or update on public.staff_payroll_expense_basis_exclusions
for each row execute function public.staff_payroll_expense_basis_exclusion_guard();
