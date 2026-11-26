alter table public.atom_invoice_corrections
  alter column recovery_id drop not null,
  add column replacement_invoice_id uuid references public.invoices(id),
  add constraint atom_invoice_corrections_source_check
    check (num_nonnulls(recovery_id, replacement_invoice_id) = 1);

create function public.atom_correct_amin_weekly(
  p_actor uuid, p_issued_at timestamptz, p_pdf_path text default null
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  c_member constant uuid := '7f76286a-56f9-49ae-9859-90851c5df79d';
  c_sub constant uuid := '95778a81-da35-4608-98ba-863f7bdf0c68';
  c_payment constant uuid := 'b9767807-6064-4874-81c1-54265f9f9b76';
  c_invoice constant uuid := '987a0ba0-101b-481f-aaab-e36df5ec238e';
  c_number constant text := 'INV-CORR-20261126-000607';
  c_start constant date := date '2026-11-26';
  c_old_end constant date := date '2026-12-26';
  c_new_end constant date := date '2026-12-02';
  c_reason constant text := 'Correct subscription entry from one month to one week. Original card payment retained.';
  v_subscription public.subscriptions%rowtype;
  v_payment public.subscription_payments%rowtype;
  v_invoice public.invoices%rowtype;
  v_replacement uuid;
  v_snapshot jsonb;
begin
  perform 1 from public.profiles where user_id = p_actor and role = 'super_admin' for share;
  if not found then
    raise exception 'SUPER_ADMIN_REQUIRED' using errcode = '42501';
  end if;

  select * into strict v_subscription from public.subscriptions where id = c_sub for update;

  select replacement_invoice_id into v_replacement
    from public.atom_invoice_corrections where invoice_id = c_invoice;
  if v_replacement is not null then
    return jsonb_build_object('invoice_number', c_number, 'applied', true);
  end if;

  select * into strict v_payment from public.subscription_payments where id = c_payment for update;
  select * into strict v_invoice from public.invoices where id = c_invoice for update;

  if not coalesce(
    v_subscription.member_id = c_member and v_subscription.subscription_type = 'time'
    and v_subscription.plan = '1m' and v_subscription.status in ('active', 'expired')
    and v_subscription.start_date = c_start and v_subscription.end_date = c_old_end
    and (v_subscription.paid_end_date is null or v_subscription.paid_end_date = c_old_end)
    and v_subscription.amount = 1000 and v_subscription.amount_due = 0
    and v_subscription.payment_method = 'card'
    and v_subscription.frozen_from is null and v_subscription.frozen_until is null
    and v_payment.member_id = c_member and v_payment.subscription_id = c_sub
    and v_payment.amount = 1000 and v_payment.payment_method = 'card'
    and (v_payment.paid_at at time zone 'Africa/Cairo')::date = c_start
    and v_invoice.member_id = c_member and v_invoice.subscription_id = c_sub
    and v_invoice.invoice_number = 'INV-20261126-3F7BDF0C68'
    and v_invoice.amount = 1000 and v_invoice.currency = 'EGP'
    and v_invoice.snapshot #>> '{transaction,plan}' = '1m'
    and v_invoice.snapshot #>> '{transaction,end_date}' = c_old_end::text, false
  ) or exists (select 1 from public.subscription_payments where subscription_id = c_sub and id <> c_payment)
    or exists (select 1 from public.invoices where subscription_id = c_sub and id <> c_invoice)
    or exists (select 1 from public.attendance where subscription_id = c_sub)
    or exists (select 1 from public.subscription_freezes where subscription_id = c_sub)
    or exists (select 1 from public.membership_refunds where subscription_id = c_sub)
    or exists (select 1 from public.membership_upgrades where c_sub in (from_subscription_id, to_subscription_id))
    or exists (select 1 from public.atom_payment_voids where payment_id = c_payment)
    or exists (select 1 from public.atom_invoice_corrections where invoice_id = c_invoice)
  then
    raise exception 'CORRECTION_SOURCE_CHANGED' using errcode = 'P0001';
  end if;

  v_snapshot := v_invoice.snapshot || jsonb_build_object(
    'invoice_number', c_number, 'issued_at', p_issued_at,
    'transaction', (v_invoice.snapshot -> 'transaction') || jsonb_build_object(
      'plan', '1w', 'start_date', c_start, 'end_date', c_new_end, 'amount', 1000,
      'amount_due', 0, 'payment_method', 'card', 'paid_at', v_payment.paid_at
    ),
    'recovery', jsonb_build_object(
      'id', c_sub, 'reason', c_reason,
      'superseded_invoice_numbers', jsonb_build_array(v_invoice.invoice_number),
      'false_payment_voided_egp', 0, 'outstanding_egp', 0
    )
  );

  if p_pdf_path is null then
    return jsonb_build_object('snapshot', v_snapshot, 'applied', false);
  end if;

  if p_pdf_path not like c_member::text || '/' || c_number || '-%.pdf'
    or not exists (select 1 from storage.objects where bucket_id = 'invoices' and name = p_pdf_path)
  then
    raise exception 'CORRECTIVE_PDF_MISSING' using errcode = 'P0001';
  end if;

  update public.subscriptions
    set plan = '1w', end_date = c_new_end,
        paid_end_date = case when paid_end_date is not null then c_new_end end,
        status = case when (now() at time zone 'Africa/Cairo')::date > c_new_end
                 then 'expired' else status end
    where id = c_sub;

  insert into public.invoices (
    member_id, subscription_id, invoice_number, amount, currency, paid_at, pdf_path, snapshot, created_by
  ) values (c_member, c_sub, c_number, 1000, 'EGP', v_payment.paid_at, p_pdf_path, v_snapshot, p_actor)
  returning id into v_replacement;

  insert into public.atom_invoice_corrections (invoice_id, replacement_invoice_id, reason, created_by)
    values (c_invoice, v_replacement, c_reason, p_actor);

  insert into public.audit_logs (actor_user_id, target_user_id, action, action_details)
    values (p_actor, c_member, 'subscription_duration_corrected', jsonb_build_object(
      'subscription_id', c_sub, 'payment_id', c_payment, 'original_invoice_id', c_invoice,
      'replacement_invoice_id', v_replacement, 'from_plan', '1m', 'to_plan', '1w',
      'from_end_date', c_old_end, 'to_end_date', c_new_end, 'reason', c_reason
    ));

  return jsonb_build_object('invoice_number', c_number, 'applied', true, 'pdf_path', p_pdf_path);
end;
$$;

revoke execute on function public.atom_correct_amin_weekly(uuid, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.atom_correct_amin_weekly(uuid, timestamptz, text) to service_role;
