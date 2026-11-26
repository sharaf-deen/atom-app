\set ON_ERROR_STOP on
begin;
do $fixture$
declare
  actor constant uuid := 'cba63ac2-a0bf-4389-a71d-181350ca179b';
  member constant uuid := '7f76286a-56f9-49ae-9859-90851c5df79d';
  sub constant uuid := '95778a81-da35-4608-98ba-863f7bdf0c68';
  payment constant uuid := 'b9767807-6064-4874-81c1-54265f9f9b76';
  original constant uuid := '987a0ba0-101b-481f-aaab-e36df5ec238e';
  pdf constant text := member::text || '/INV-CORR-20261126-000607-test.pdf';
  preview jsonb;
begin
  insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
    values ('00000000-0000-0000-0000-000000000000',actor,'authenticated','authenticated','amin-correction-admin@example.invalid','unused',now(),now(),now()),
           ('00000000-0000-0000-0000-000000000000',member,'authenticated','authenticated','amin-correction-member@example.invalid','unused',now(),now(),now());
  update public.profiles set role='super_admin' where user_id=actor;
  update public.profiles set role='member' where user_id=member;
  insert into public.subscriptions (id,member_id,subscription_type,plan,status,start_date,end_date,amount,amount_due,payment_method,paid_at)
    values (sub,member,'time','1m','active','2026-11-26','2026-12-26',1000,0,'card','2026-11-26 12:00+00');
  insert into public.subscription_payments (id,subscription_id,member_id,amount,payment_method,paid_at,created_by)
    values (payment,sub,member,1000,'card','2026-11-26 12:00+00',actor);
  insert into public.invoices (id,member_id,subscription_id,invoice_number,amount,currency,paid_at,pdf_path,snapshot)
    values (original,member,sub,'INV-20261126-3F7BDF0C68',1000,'EGP','2026-11-26 12:00+00','test/original.pdf',
      '{"transaction":{"plan":"1m","end_date":"2026-12-26"}}');
  begin
    perform public.atom_correct_amin_weekly(member,now());
    raise exception 'Expected role rejection';
  exception when insufficient_privilege then null;
  end;
  preview := public.atom_correct_amin_weekly(actor,now());
  if preview #>> '{snapshot,transaction,plan}' is distinct from '1w'
    or (select plan from public.subscriptions where id=sub) is distinct from '1m'
  then raise exception 'Preview failed'; end if;
  begin
    perform public.atom_correct_amin_weekly(actor,now(),pdf);
    raise exception 'Expected missing PDF rejection';
  exception when raise_exception then
    if sqlerrm <> 'CORRECTIVE_PDF_MISSING' then raise; end if;
  end;
  insert into storage.buckets (id,name) values ('invoices','invoices') on conflict (id) do nothing;
  insert into storage.objects (bucket_id,name) values ('invoices',pdf);
  perform public.atom_correct_amin_weekly(actor,now(),pdf);
  perform public.atom_correct_amin_weekly(actor,now(),pdf);
  if (select plan from public.subscriptions where id=sub) is distinct from '1w'
    or (select end_date from public.subscriptions where id=sub) is distinct from date '2026-12-02'
    or (select total from (select sum(amount) total from public.subscription_payments where subscription_id=sub) p) is distinct from 1000::numeric
    or (select count(*) from public.subscription_payments where subscription_id=sub) <> 1
    or (select count(*) from public.invoices where subscription_id=sub) <> 2
    or not exists (select 1 from public.atom_invoice_corrections where invoice_id=original and replacement_invoice_id is not null)
    or (select count(*) from public.audit_logs where target_user_id=member and action='subscription_duration_corrected') <> 1
  then raise exception 'Correction postcheck failed'; end if;
end;
$fixture$;
rollback;
