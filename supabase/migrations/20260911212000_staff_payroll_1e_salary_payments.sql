-- Staff Payroll 1E — Salary Payments & Payment Tracking
-- Scope:
--   * Salary payments are linked to immutable 1D approval versions/calculations.
--   * Multiple payments per staff member are supported.
--   * Status is derived from active payments: unpaid / partially paid / paid.
--   * Payments are never deleted. Incorrect entries are reversed with a mandatory reason.
--   * Approved payroll cannot be reopened while active salary payments exist.
--   * No automatic Expenses/Reconciliation entry is created.

begin;

create table if not exists public.staff_payroll_salary_payments (
  id uuid primary key default gen_random_uuid(),
  approval_version_id uuid not null
    references public.staff_payroll_approval_versions(id)
    on delete restrict,
  approval_calculation_id uuid not null
    references public.staff_payroll_approval_calculations(id)
    on delete restrict,
  snapshot_id uuid not null
    references public.staff_payroll_monthly_snapshots(id)
    on delete restrict,
  month_start date not null,
  approval_version_no integer not null,
  staff_user_id uuid not null
    references public.profiles(user_id)
    on delete restrict,
  staff_name_snapshot text not null,
  approved_salary_amount numeric(14,2) not null,
  amount numeric(14,2) not null,
  payment_method text not null,
  payment_date date not null,
  reference text null,
  note text null,
  status text not null default 'active',
  recorded_at timestamptz not null default now(),
  recorded_by uuid null references public.profiles(user_id) on delete set null,
  recorded_by_name_snapshot text not null,
  reversed_at timestamptz null,
  reversed_by uuid null references public.profiles(user_id) on delete set null,
  reversed_by_name_snapshot text null,
  reversal_reason text null,

  constraint staff_payroll_salary_payments_month_chk
    check (month_start = date_trunc('month', month_start)::date),
  constraint staff_payroll_salary_payments_version_chk
    check (approval_version_no >= 1),
  constraint staff_payroll_salary_payments_approved_amount_chk
    check (approved_salary_amount >= 0),
  constraint staff_payroll_salary_payments_amount_chk
    check (amount > 0),
  constraint staff_payroll_salary_payments_method_chk
    check (payment_method in ('cash','instapay','bank_transfer')),
  constraint staff_payroll_salary_payments_reference_chk
    check (reference is null or char_length(reference) <= 300),
  constraint staff_payroll_salary_payments_note_chk
    check (note is null or char_length(note) <= 2000),
  constraint staff_payroll_salary_payments_status_chk
    check (status in ('active','reversed')),
  constraint staff_payroll_salary_payments_staff_name_chk
    check (char_length(btrim(staff_name_snapshot)) between 1 and 200),
  constraint staff_payroll_salary_payments_recorder_name_chk
    check (char_length(btrim(recorded_by_name_snapshot)) between 1 and 200),
  constraint staff_payroll_salary_payments_reversal_reason_chk
    check (reversal_reason is null or char_length(btrim(reversal_reason)) between 3 and 1000),
  constraint staff_payroll_salary_payments_reversal_state_chk
    check (
      (status = 'active' and reversed_at is null and reversed_by is null and reversed_by_name_snapshot is null and reversal_reason is null)
      or
      (status = 'reversed' and reversed_at is not null and reversed_by_name_snapshot is not null and reversal_reason is not null)
    )
);

create index if not exists staff_payroll_salary_payments_month_idx
  on public.staff_payroll_salary_payments(month_start desc, recorded_at desc);

create index if not exists staff_payroll_salary_payments_staff_idx
  on public.staff_payroll_salary_payments(staff_user_id, month_start desc, recorded_at desc);

create index if not exists staff_payroll_salary_payments_version_active_idx
  on public.staff_payroll_salary_payments(approval_version_id, staff_user_id, status);

alter table public.staff_payroll_salary_payments enable row level security;

drop policy if exists "admin read staff payroll salary payments"
  on public.staff_payroll_salary_payments;
create policy "admin read staff payroll salary payments"
  on public.staff_payroll_salary_payments
  for select
  using (public.is_admin_or_super_admin(auth.uid()));

revoke all on table public.staff_payroll_salary_payments from authenticated;
grant select on table public.staff_payroll_salary_payments to authenticated;
grant all on table public.staff_payroll_salary_payments to service_role;

-- Payment rows are append-only. The only allowed update is an audited reversal through the dedicated RPC.
create or replace function public.staff_payroll_guard_salary_payment_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if coalesce(current_setting('atom.staff_payroll_payment_record', true), '') <> '1' then
      raise exception 'STAFF_PAYROLL_PAYMENT_RPC_REQUIRED';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'STAFF_PAYROLL_PAYMENT_IMMUTABLE';
  end if;

  if coalesce(current_setting('atom.staff_payroll_payment_reverse', true), '') <> '1' then
    raise exception 'STAFF_PAYROLL_PAYMENT_IMMUTABLE';
  end if;

  if old.status <> 'active' or new.status <> 'reversed' then
    raise exception 'STAFF_PAYROLL_PAYMENT_INVALID_REVERSAL';
  end if;

  if new.id <> old.id
     or new.approval_version_id <> old.approval_version_id
     or new.approval_calculation_id <> old.approval_calculation_id
     or new.snapshot_id <> old.snapshot_id
     or new.month_start <> old.month_start
     or new.approval_version_no <> old.approval_version_no
     or new.staff_user_id <> old.staff_user_id
     or new.staff_name_snapshot <> old.staff_name_snapshot
     or new.approved_salary_amount <> old.approved_salary_amount
     or new.amount <> old.amount
     or new.payment_method <> old.payment_method
     or new.payment_date <> old.payment_date
     or new.reference is distinct from old.reference
     or new.note is distinct from old.note
     or new.recorded_at <> old.recorded_at
     or new.recorded_by is distinct from old.recorded_by
     or new.recorded_by_name_snapshot <> old.recorded_by_name_snapshot then
    raise exception 'STAFF_PAYROLL_PAYMENT_CORE_FIELDS_IMMUTABLE';
  end if;

  return new;
end;
$$;

drop trigger if exists staff_payroll_salary_payments_guard_mutation
  on public.staff_payroll_salary_payments;
create trigger staff_payroll_salary_payments_guard_mutation
before insert or update or delete on public.staff_payroll_salary_payments
for each row
execute function public.staff_payroll_guard_salary_payment_mutation();

create or replace function public.staff_payroll_record_salary_payment(
  p_approval_calculation_id uuid,
  p_actor_id uuid,
  p_amount numeric,
  p_payment_method text,
  p_payment_date date,
  p_reference text,
  p_note text
)
returns table(payment_id uuid, paid_total numeric, remaining_due numeric, payment_status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_calc public.staff_payroll_approval_calculations%rowtype;
  v_version public.staff_payroll_approval_versions%rowtype;
  v_snapshot public.staff_payroll_monthly_snapshots%rowtype;
  v_actor_name text;
  v_amount numeric(14,2) := round(coalesce(p_amount, 0), 2);
  v_method text := lower(btrim(coalesce(p_payment_method, '')));
  v_reference text := nullif(btrim(coalesce(p_reference, '')), '');
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_paid_before numeric(14,2) := 0;
  v_paid_after numeric(14,2) := 0;
  v_remaining numeric(14,2) := 0;
  v_status text := 'unpaid';
  v_payment_id uuid;
begin
  if v_amount <= 0 then
    raise exception 'STAFF_PAYROLL_PAYMENT_AMOUNT_INVALID';
  end if;

  if v_method not in ('cash','instapay','bank_transfer') then
    raise exception 'STAFF_PAYROLL_PAYMENT_METHOD_INVALID';
  end if;

  if p_payment_date is null then
    raise exception 'STAFF_PAYROLL_PAYMENT_DATE_REQUIRED';
  end if;

  if p_payment_date > (now() at time zone 'Africa/Cairo')::date then
    raise exception 'STAFF_PAYROLL_PAYMENT_DATE_FUTURE';
  end if;

  if v_reference is not null and char_length(v_reference) > 300 then
    raise exception 'STAFF_PAYROLL_PAYMENT_REFERENCE_TOO_LONG';
  end if;

  if v_note is not null and char_length(v_note) > 2000 then
    raise exception 'STAFF_PAYROLL_PAYMENT_NOTE_TOO_LONG';
  end if;

  select * into v_calc
  from public.staff_payroll_approval_calculations
  where id = p_approval_calculation_id
  for update;

  if not found then
    raise exception 'STAFF_PAYROLL_APPROVAL_CALCULATION_NOT_FOUND';
  end if;

  select * into v_version
  from public.staff_payroll_approval_versions
  where id = v_calc.approval_version_id
  for update;

  if not found then
    raise exception 'STAFF_PAYROLL_APPROVAL_VERSION_NOT_FOUND';
  end if;

  select * into v_snapshot
  from public.staff_payroll_monthly_snapshots
  where id = v_version.snapshot_id
  for update;

  if not found then
    raise exception 'STAFF_PAYROLL_SNAPSHOT_NOT_FOUND';
  end if;

  if v_snapshot.status <> 'approved'
     or v_snapshot.approval_version_no <> v_version.version_no
     or v_snapshot.month_start <> v_version.month_start then
    raise exception 'STAFF_PAYROLL_PAYMENT_NOT_CURRENT_APPROVAL';
  end if;

  if v_calc.snapshot_id <> v_snapshot.id
     or v_calc.month_start <> v_snapshot.month_start then
    raise exception 'STAFF_PAYROLL_PAYMENT_APPROVAL_MISMATCH';
  end if;

  select coalesce(sum(amount), 0)::numeric(14,2)
  into v_paid_before
  from public.staff_payroll_salary_payments
  where approval_calculation_id = v_calc.id
    and status = 'active';

  v_remaining := round(greatest(v_calc.calculated_salary - v_paid_before, 0), 2);

  if v_remaining <= 0 then
    raise exception 'STAFF_PAYROLL_PAYMENT_ALREADY_PAID';
  end if;

  if v_amount > v_remaining then
    raise exception 'STAFF_PAYROLL_PAYMENT_EXCEEDS_REMAINING';
  end if;

  select coalesce(
    nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
    nullif(btrim(p.email), ''),
    p_actor_id::text
  ) into v_actor_name
  from public.profiles p
  where p.user_id = p_actor_id;

  v_actor_name := coalesce(v_actor_name, p_actor_id::text);

  perform set_config('atom.staff_payroll_payment_record', '1', true);

  insert into public.staff_payroll_salary_payments (
    approval_version_id,
    approval_calculation_id,
    snapshot_id,
    month_start,
    approval_version_no,
    staff_user_id,
    staff_name_snapshot,
    approved_salary_amount,
    amount,
    payment_method,
    payment_date,
    reference,
    note,
    status,
    recorded_by,
    recorded_by_name_snapshot
  ) values (
    v_version.id,
    v_calc.id,
    v_snapshot.id,
    v_snapshot.month_start,
    v_version.version_no,
    v_calc.staff_user_id,
    v_calc.staff_name_snapshot,
    v_calc.calculated_salary,
    v_amount,
    v_method,
    p_payment_date,
    v_reference,
    v_note,
    'active',
    p_actor_id,
    v_actor_name
  ) returning id into v_payment_id;

  v_paid_after := round(v_paid_before + v_amount, 2);
  v_remaining := round(greatest(v_calc.calculated_salary - v_paid_after, 0), 2);

  if v_remaining <= 0 then
    v_status := 'paid';
  elsif v_paid_after > 0 then
    v_status := 'partially_paid';
  else
    v_status := 'unpaid';
  end if;

  return query
  select v_payment_id, v_paid_after, v_remaining, v_status;
end;
$$;

create or replace function public.staff_payroll_reverse_salary_payment(
  p_payment_id uuid,
  p_actor_id uuid,
  p_reason text
)
returns table(payment_id uuid, reversed_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment public.staff_payroll_salary_payments%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_actor_name text;
  v_now timestamptz := now();
begin
  if char_length(v_reason) < 3 then
    raise exception 'STAFF_PAYROLL_PAYMENT_REVERSAL_REASON_REQUIRED';
  end if;

  select * into v_payment
  from public.staff_payroll_salary_payments
  where id = p_payment_id
  for update;

  if not found then
    raise exception 'STAFF_PAYROLL_PAYMENT_NOT_FOUND';
  end if;

  if v_payment.status <> 'active' then
    raise exception 'STAFF_PAYROLL_PAYMENT_ALREADY_REVERSED';
  end if;

  select coalesce(
    nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
    nullif(btrim(p.email), ''),
    p_actor_id::text
  ) into v_actor_name
  from public.profiles p
  where p.user_id = p_actor_id;

  v_actor_name := coalesce(v_actor_name, p_actor_id::text);

  perform set_config('atom.staff_payroll_payment_reverse', '1', true);

  update public.staff_payroll_salary_payments
  set status = 'reversed',
      reversed_at = v_now,
      reversed_by = p_actor_id,
      reversed_by_name_snapshot = v_actor_name,
      reversal_reason = v_reason
  where id = p_payment_id;

  return query select v_payment.id, v_now;
end;
$$;

revoke all on function public.staff_payroll_record_salary_payment(uuid,uuid,numeric,text,date,text,text) from public;
revoke all on function public.staff_payroll_reverse_salary_payment(uuid,uuid,text) from public;
grant execute on function public.staff_payroll_record_salary_payment(uuid,uuid,numeric,text,date,text,text) to service_role;
grant execute on function public.staff_payroll_reverse_salary_payment(uuid,uuid,text) to service_role;

-- A payroll with real active salary payments cannot be reopened.
-- To correct an erroneous payment, reverse it first; the audit row remains preserved.
create or replace function public.staff_payroll_block_reopen_with_active_payments()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_version_id uuid;
begin
  if old.status = 'approved' and new.status = 'draft' then
    select id into v_current_version_id
    from public.staff_payroll_approval_versions
    where snapshot_id = old.id
      and version_no = old.approval_version_no;

    if v_current_version_id is not null and exists (
      select 1
      from public.staff_payroll_salary_payments p
      where p.approval_version_id = v_current_version_id
        and p.status = 'active'
    ) then
      raise exception 'STAFF_PAYROLL_ACTIVE_PAYMENTS_BLOCK_REOPEN';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists staff_payroll_monthly_snapshots_block_reopen_payments
  on public.staff_payroll_monthly_snapshots;
create trigger staff_payroll_monthly_snapshots_block_reopen_payments
before update of status on public.staff_payroll_monthly_snapshots
for each row
execute function public.staff_payroll_block_reopen_with_active_payments();

comment on table public.staff_payroll_salary_payments is
  'Immutable salary-payment ledger linked to Staff Payroll approval versions. Incorrect payments are reversed, never deleted.';

commit;
