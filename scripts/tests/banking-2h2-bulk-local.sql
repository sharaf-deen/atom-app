-- Isolated local Supabase DB only; runs after reset and versioned migrations.
\set ON_ERROR_STOP on
BEGIN;
DO $test$
DECLARE
  actor uuid := gen_random_uuid();
  member uuid := gen_random_uuid();
  acct uuid := gen_random_uuid();
  tx1 uuid := gen_random_uuid();
  tx2 uuid := gen_random_uuid();
  tx3 uuid := gen_random_uuid();
  tx4 uuid := gen_random_uuid();
  b1 uuid := gen_random_uuid();
  b2 uuid := gen_random_uuid();
  b3 uuid := gen_random_uuid();
  result jsonb;
  rejected boolean;
BEGIN
  insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
  values
   ('00000000-0000-0000-0000-000000000000',actor,'authenticated','authenticated','bulk_2h2_admin@example.invalid','not-login',now(),now(),now()),
   ('00000000-0000-0000-0000-000000000000',member,'authenticated','authenticated','bulk_2h2_member@example.invalid','not-login',now(),now(),now());
  insert into public.profiles(user_id,email,role) values
   (actor,'bulk_2h2_admin@example.invalid','super_admin'),
   (member,'bulk_2h2_member@example.invalid','member')
   on conflict(user_id) do update set role=excluded.role;
  insert into public.bank_accounts(id,code,display_name) values(acct,'test-2h2','Fictional test only');

  insert into public.bank_transactions(id,account_id,transaction_date,description,reference,amount,direction,fingerprint,category_code,classification_status)
  values
   (tx1,acct,'2026-10-04','Fictional membership','DEMO-UNIQUE',1111,'credit','bulk-2h2-fixture-unique','membership_income','suggested'),
   (tx2,acct,'2026-10-05','Fictional member A','DEMO-AMBIG-A',2222,'credit','bulk-2h2-fixture-amb-a','membership_income','suggested'),
   (tx3,acct,'2026-10-05','Fictional member B','DEMO-AMBIG-B',2222,'credit','bulk-2h2-fixture-amb-b','membership_income','suggested'),
   (tx4,acct,'2026-10-06','Internal transfer','DEMO-INTERNAL',3333,'credit','bulk-2h2-fixture-internal','internal_transfer','suggested');

  insert into public.payment_validation_batches(id,payment_method,validation_mode,business_date,period_from,period_to,expected_amount,counted_amount,difference_amount,validated_by,created_by)
  values
   (b1,'instapay','daily','2026-10-04','2026-10-04 12:00Z','2026-10-04 13:00Z',1111,1111,0,actor,actor),
   (b2,'instapay','daily','2026-10-05','2026-10-05 12:00Z','2026-10-05 13:00Z',2222,2222,0,actor,actor),
   (b3,'instapay','daily','2026-10-06','2026-10-06 12:00Z','2026-10-06 13:00Z',3333,3333,0,actor,actor);

  if not has_function_privilege('service_role','public.bulk_match_instapay_income_v1(jsonb,uuid,text,boolean)','execute')
   or has_function_privilege('anon','public.bulk_match_instapay_income_v1(jsonb,uuid,text,boolean)','execute')
   or has_function_privilege('authenticated','public.bulk_match_instapay_income_v1(jsonb,uuid,text,boolean)','execute')
  then raise exception 'BULK_RPC_GRANT_INVALID'; end if;

  rejected:=false;
  begin
    perform public.bulk_match_instapay_income_v1(
      jsonb_build_array(jsonb_build_object('bank_transaction_id',tx1,'batch_id',b1)),
      member,'Unauthorized sample',true);
  exception when others then rejected:=true;
  end;
  if not rejected then raise exception 'UNAUTHORIZED_BULK_SUCCEEDED'; end if;

  rejected:=false;
  begin
    perform public.bulk_match_instapay_income_v1(
      jsonb_build_array(jsonb_build_object('bank_transaction_id',tx1,'batch_id',b1),
                        jsonb_build_object('bank_transaction_id',tx2,'batch_id',b2)),
      actor,'Atomic rollback scenario',true);
  exception when others then rejected:=true;
  end;
  if not rejected then raise exception 'AMBIGUOUS_PAIR_ACCEPTED'; end if;
  if exists (select 1 from public.bank_payment_matches where bank_transaction_id in (tx1,tx2)) then
    raise exception 'PARTIAL_MATCH_LEFT_AFTER_ATOMIC_REJECTION';
  end if;

  rejected:=false;
  begin
    perform public.bulk_match_instapay_income_v1(
      jsonb_build_array(jsonb_build_object('bank_transaction_id',tx4,'batch_id',b3)),
      actor,'Internal transfers must be excluded',true);
  exception when others then rejected:=true;
  end;
  if not rejected then raise exception 'INTERNAL_TRANSFER_ACCEPTED'; end if;

  result:=public.bulk_match_instapay_income_v1(
    jsonb_build_array(jsonb_build_object('bank_transaction_id',tx1,'batch_id',b1)),
    actor,'Verified fictional bank reference and validation batch',true);
  if (result->>'matched_count')::int<>1
     or (result->>'total_amount')::numeric<>1111
     or (select count(*) from public.bank_payment_matches
           where bank_transaction_id=tx1 and batch_id=b1 and matched_amount=1111
                 and matched_by=actor and released_at is null)<>1
  then raise exception 'BULK_VALID_MATCH_FAILED'; end if;

  rejected:=false;
  begin
    perform public.bulk_match_instapay_income_v1(
      jsonb_build_array(jsonb_build_object('bank_transaction_id',tx1,'batch_id',b1)),
      actor,'Retry must be refused',true);
  exception when others then rejected:=true;
  end;
  if not rejected then raise exception 'DUPLICATE_RETRY_ACCEPTED'; end if;
  raise notice 'BANKING_2H2_ATOMIC_SECURITY_BUSINESS_PASS';
END;
$test$;
ROLLBACK;
select 'BANKING_2H2_ALL_FIXTURES_ROLLED_BACK' as result;
