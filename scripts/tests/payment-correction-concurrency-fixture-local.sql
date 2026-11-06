-- Local CI fixture ONLY. Never apply to shared databases.
\set ON_ERROR_STOP on
INSERT INTO auth.users
(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
VALUES
('00000000-0000-0000-0000-000000000000','b173c140-164d-486e-a016-f039e7f02001','authenticated','authenticated','concurrency_admin@example.invalid','not-a-login',now(),now(),now()),
('00000000-0000-0000-0000-000000000000','b173c140-164d-486e-a016-f039e7f02002','authenticated','authenticated','concurrency_member@example.invalid','not-a-login',now(),now(),now());
INSERT INTO public.profiles(user_id,email,role)
VALUES
('b173c140-164d-486e-a016-f039e7f02001','concurrency_admin@example.invalid','super_admin'),
('b173c140-164d-486e-a016-f039e7f02002','concurrency_member@example.invalid','member')
ON CONFLICT(user_id) DO UPDATE SET role=excluded.role;

INSERT INTO public.subscriptions
(id,member_id,subscription_type,plan,status,start_date,end_date,amount,amount_due,payment_method,paid_at)
VALUES
('b173c140-164d-486e-a016-f039e7f02003','b173c140-164d-486e-a016-f039e7f02002',
'time','1m','active','2026-10-29','2026-11-29',2200,0,'card','2026-10-29T12:00:00Z');
INSERT INTO public.subscription_payments
(id,subscription_id,member_id,amount,payment_method,paid_at,note)
VALUES
('b173c140-164d-486e-a016-f039e7f02004','b173c140-164d-486e-a016-f039e7f02003',
'b173c140-164d-486e-a016-f039e7f02002',2200,'card','2026-10-29T12:00:00Z','Concurrent RPC fixture');
INSERT INTO public.payment_validation_batches
(id,payment_method,validation_mode,business_date,period_from,period_to,expected_amount,
 counted_amount,difference_amount,validated_by,created_by)
VALUES
('b173c140-164d-486e-a016-f039e7f02005','card','daily','2026-10-29',
'2026-10-29T11:59:00Z','2026-10-29T12:01:00Z',2200,2200,0,
'b173c140-164d-486e-a016-f039e7f02001','b173c140-164d-486e-a016-f039e7f02001');
INSERT INTO public.payment_validation_batch_items
(batch_id,source_kind,source_id,amount_snapshot,business_date_snapshot,event_at_snapshot,created_by)
VALUES
('b173c140-164d-486e-a016-f039e7f02005','subscription_payment',
'b173c140-164d-486e-a016-f039e7f02004',2200,'2026-10-29',
'2026-10-29T12:00:00Z','b173c140-164d-486e-a016-f039e7f02001');
