DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'freeze_request_status'
      AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public.freeze_request_status AS ENUM ('pending', 'approved', 'denied', 'canceled');
  END IF;
END
$$;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'freeze_request_status'
      AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public.freeze_request_status AS ENUM ('pending', 'approved', 'denied', 'canceled');
  END IF;
END
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'payment_method'
      AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public.payment_method AS ENUM ('cash', 'card', 'transfer', 'online');
  END IF;
END
$$;


DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'promo_discount_type'
      AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public.promo_discount_type AS ENUM ('percent', 'amount');
  END IF;
END
$$;


DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'user_role'
      AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public.user_role AS ENUM ('admin', 'coach', 'assistant_coach', 'member');
  END IF;
END
$$;


create sequence "public"."member_seq";


  create table "public"."app_schedule" (
    "key" text not null,
    "content" text not null,
    "updated_at" timestamp with time zone not null default now(),
    "updated_by" uuid
      );


alter table "public"."app_schedule" enable row level security;


  create table "public"."attendance" (
    "id" uuid not null default gen_random_uuid(),
    "date" date not null default CURRENT_DATE,
    "scan_time" timestamp with time zone default now(),
    "status" text not null default 'ok'::text,
    "member_id" uuid not null,
    "scanned_by" uuid,
    "device_tag" text,
    "valid" boolean default false,
    "scanned_at" timestamp with time zone default now(),
    "from_sessions" boolean not null default false,
    "subscription_id" uuid,
    "source" text not null default 'kiosk'::text
      );


alter table "public"."attendance" enable row level security;


  create table "public"."audit_logs" (
    "id" uuid not null default gen_random_uuid(),
    "actor_user_id" uuid,
    "target_user_id" uuid not null,
    "action" text not null,
    "action_details" jsonb,
    "created_at" timestamp with time zone default now()
      );


alter table "public"."audit_logs" enable row level security;


  create table "public"."expense_categories" (
    "key" text not null,
    "label" text not null,
    "group_name" text not null,
    "is_active" boolean not null default true,
    "sort_order" integer not null default 0,
    "created_at" timestamp with time zone not null default now()
      );


alter table "public"."expense_categories" enable row level security;


  create table "public"."expenses" (
    "id" uuid not null default extensions.uuid_generate_v4(),
    "date" date not null default CURRENT_DATE,
    "description" text,
    "amount" numeric(10,2) not null,
    "created_by" uuid,
    "created_at" timestamp with time zone default now(),
    "category_key" text not null
      );


alter table "public"."expenses" enable row level security;


  create table "public"."freeze_requests" (
    "id" uuid not null default gen_random_uuid(),
    "member_user_id" uuid not null,
    "requested_start_date" date not null,
    "reason" text not null,
    "status" public.freeze_request_status not null default 'pending'::public.freeze_request_status,
    "created_at" timestamp with time zone not null default now(),
    "processed_by" uuid,
    "processed_at" timestamp with time zone,
    "admin_note" text
      );


alter table "public"."freeze_requests" enable row level security;


  create table "public"."notifications" (
    "id" uuid not null default gen_random_uuid(),
    "member_id" uuid not null,
    "created_by" uuid,
    "kind" text not null default 'info'::text,
    "title" text,
    "body" text not null,
    "created_at" timestamp with time zone not null default now(),
    "read_at" timestamp with time zone,
    "user_id" uuid
      );


alter table "public"."notifications" enable row level security;


  create table "public"."notifications_outbox" (
    "id" uuid not null default gen_random_uuid(),
    "member_id" uuid not null,
    "subscription_id" uuid,
    "kind" text not null,
    "email" text not null,
    "subject" text not null,
    "body" text not null,
    "created_at" timestamp with time zone not null default now(),
    "sent_at" timestamp with time zone,
    "error" text
      );


alter table "public"."notifications_outbox" enable row level security;


  create table "public"."payments" (
    "id" uuid not null default gen_random_uuid(),
    "user_id" uuid not null,
    "subscription_id" uuid,
    "amount" numeric(10,2) not null,
    "currency" text not null default 'EGP'::text,
    "method" public.payment_method not null,
    "paid_at" timestamp with time zone not null default now(),
    "note" text,
    "created_at" timestamp with time zone not null default now()
      );


alter table "public"."payments" enable row level security;


  create table "public"."profiles" (
    "user_id" uuid not null,
    "email" text,
    "first_name" text,
    "last_name" text,
    "phone" text,
    "role" text default 'member'::text,
    "member_id" text,
    "created_at" timestamp with time zone default now(),
    "qr_code" text,
    "id_photo_path" text,
    "phone_digits" text generated always as (regexp_replace(COALESCE(phone, ''::text), '\D'::text, ''::text, 'g'::text)) stored,
    "date_of_birth" date
      );


alter table "public"."profiles" enable row level security;


  create table "public"."promotions" (
    "id" uuid not null default gen_random_uuid(),
    "title" text not null,
    "description" text,
    "discount_type" public.promo_discount_type not null,
    "discount_value" numeric not null,
    "applies_to" text[] not null default '{}'::text[],
    "min_months" integer,
    "start_date" date,
    "end_date" date,
    "created_by" uuid,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
      );


alter table "public"."promotions" enable row level security;


  create table "public"."roles" (
    "id" text not null,
    "label" text not null
      );



  create table "public"."store_order_items" (
    "id" uuid not null default gen_random_uuid(),
    "order_id" uuid not null,
    "product_id" uuid not null,
    "qty" integer not null,
    "unit_price_cents" integer not null,
    "discount_percent" integer not null default 0,
    "final_price_cents" integer not null,
    "currency" text default 'EGP'::text,
    "name" text default 'Item'::text,
    "stock_deducted" boolean not null default false,
    "owner_uid" uuid
      );


alter table "public"."store_order_items" enable row level security;


  create table "public"."store_order_messages" (
    "id" uuid not null default gen_random_uuid(),
    "order_id" uuid not null,
    "sender_id" uuid,
    "body" text not null,
    "created_at" timestamp with time zone not null default now()
      );


alter table "public"."store_order_messages" enable row level security;


  create table "public"."store_orders" (
    "id" uuid not null default gen_random_uuid(),
    "member_id" uuid not null,
    "status" text not null default 'pending'::text,
    "payment_method" text,
    "notes" text,
    "discount_percent" integer not null default 0,
    "role_snapshot" text,
    "total_cents" integer not null default 0,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now(),
    "user_id" uuid not null,
    "discount_pct" integer not null default 0,
    "preferred_payment" text,
    "note" text,
    "created_by" uuid not null,
    "owner_uid" uuid generated always as (COALESCE(created_by, user_id)) stored
      );


alter table "public"."store_orders" enable row level security;


  create table "public"."store_products" (
    "id" uuid not null default gen_random_uuid(),
    "category" text not null,
    "name" text not null,
    "color" text,
    "size" text,
    "price_cents" integer not null,
    "inventory_qty" integer not null default 0,
    "is_active" boolean not null default true,
    "created_by" uuid,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now(),
    "currency" text default 'EGP'::text
      );


alter table "public"."store_products" enable row level security;


  create table "public"."subscriptions" (
    "id" uuid not null default gen_random_uuid(),
    "subscription_type" text not null default 'time'::text,
    "remaining_classes" integer,
    "start_date" date not null default CURRENT_DATE,
    "end_date" date,
    "status" text not null default 'active'::text,
    "created_at" timestamp with time zone default now(),
    "member_id" uuid not null,
    "plan" text not null,
    "sessions_total" integer,
    "sessions_used" integer default 0,
    "amount" numeric(10,2),
    "paid_at" timestamp with time zone default now(),
    "frozen_until" date
      );


alter table "public"."subscriptions" enable row level security;

CREATE UNIQUE INDEX app_schedule_pkey ON public.app_schedule USING btree (key);

CREATE INDEX attendance_member_date_idx ON public.attendance USING btree (member_id, date);

CREATE UNIQUE INDEX attendance_pkey ON public.attendance USING btree (id);

CREATE INDEX attendance_scanned_by_idx ON public.attendance USING btree (scanned_by);

CREATE INDEX attendance_source_idx ON public.attendance USING btree (source);

CREATE UNIQUE INDEX audit_logs_pkey ON public.audit_logs USING btree (id);

CREATE UNIQUE INDEX expense_categories_pkey ON public.expense_categories USING btree (key);

CREATE UNIQUE INDEX expenses_pkey ON public.expenses USING btree (id);

CREATE UNIQUE INDEX freeze_requests_one_pending_per_member ON public.freeze_requests USING btree (member_user_id) WHERE (status = 'pending'::public.freeze_request_status);

CREATE UNIQUE INDEX freeze_requests_pkey ON public.freeze_requests USING btree (id);

CREATE INDEX idx_attendance_date ON public.attendance USING btree (date);

CREATE INDEX idx_attendance_member ON public.attendance USING btree (member_id);

CREATE INDEX idx_attendance_subscription ON public.attendance USING btree (subscription_id);

CREATE INDEX idx_freeze_requests_status_created_at ON public.freeze_requests USING btree (status, created_at DESC);

CREATE INDEX idx_notifications_created_at ON public.notifications USING btree (created_at DESC);

CREATE INDEX idx_notifications_created_by_created_at ON public.notifications USING btree (created_by, created_at DESC);

CREATE INDEX idx_notifications_kind ON public.notifications USING btree (kind);

CREATE INDEX idx_notifications_member ON public.notifications USING btree (member_id);

CREATE INDEX idx_notifications_user_created ON public.notifications USING btree (user_id, created_at DESC);

CREATE INDEX idx_notifications_user_created_at ON public.notifications USING btree (user_id, created_at DESC);

CREATE INDEX idx_notify_member ON public.notifications_outbox USING btree (member_id);

CREATE INDEX idx_notify_sent_at ON public.notifications_outbox USING btree (sent_at);

CREATE INDEX idx_profiles_email_trgm ON public.profiles USING gin (email public.gin_trgm_ops);

CREATE INDEX idx_profiles_first_name_trgm ON public.profiles USING gin (first_name public.gin_trgm_ops);

CREATE INDEX idx_profiles_last_name_trgm ON public.profiles USING gin (last_name public.gin_trgm_ops);

CREATE INDEX idx_profiles_phone_digits ON public.profiles USING btree (phone_digits);

CREATE INDEX idx_profiles_phone_trgm ON public.profiles USING gin (phone public.gin_trgm_ops);

CREATE INDEX idx_profiles_role_by_user ON public.profiles USING btree (user_id, role);

CREATE INDEX idx_profiles_user_id ON public.profiles USING btree (user_id);

CREATE INDEX idx_store_order_items_order ON public.store_order_items USING btree (order_id);

CREATE INDEX idx_store_order_items_order_id ON public.store_order_items USING btree (order_id);

CREATE INDEX idx_store_order_items_owner_uid ON public.store_order_items USING btree (owner_uid);

CREATE INDEX idx_store_order_items_owner_uid_order ON public.store_order_items USING btree (owner_uid, order_id);

CREATE INDEX idx_store_order_items_product_id ON public.store_order_items USING btree (product_id);

CREATE INDEX idx_store_order_messages_order ON public.store_order_messages USING btree (order_id);

CREATE INDEX idx_store_orders_created_at ON public.store_orders USING btree (created_at);

CREATE INDEX idx_store_orders_created_by ON public.store_orders USING btree (created_by);

CREATE INDEX idx_store_orders_member ON public.store_orders USING btree (member_id);

CREATE INDEX idx_store_orders_owner_uid ON public.store_orders USING btree (owner_uid);

CREATE INDEX idx_store_orders_owner_uid_created_at ON public.store_orders USING btree (owner_uid, created_at DESC);

CREATE INDEX idx_store_orders_status ON public.store_orders USING btree (status);

CREATE INDEX idx_store_orders_user ON public.store_orders USING btree (user_id);

CREATE INDEX idx_store_orders_user_id ON public.store_orders USING btree (user_id);

CREATE INDEX idx_store_products_active ON public.store_products USING btree (is_active);

CREATE INDEX idx_store_products_cat ON public.store_products USING btree (category);

CREATE INDEX idx_subscriptions_end_date ON public.subscriptions USING btree (end_date);

CREATE INDEX idx_subscriptions_member ON public.subscriptions USING btree (member_id);

CREATE INDEX idx_subscriptions_status ON public.subscriptions USING btree (status);

CREATE UNIQUE INDEX notifications_outbox_pkey ON public.notifications_outbox USING btree (id);

CREATE UNIQUE INDEX notifications_pkey ON public.notifications USING btree (id);

CREATE UNIQUE INDEX payments_pkey ON public.payments USING btree (id);

CREATE INDEX payments_subscription_id_idx ON public.payments USING btree (subscription_id);

CREATE INDEX payments_user_id_idx ON public.payments USING btree (user_id);

CREATE UNIQUE INDEX profiles_email_key ON public.profiles USING btree (email);

CREATE UNIQUE INDEX profiles_member_id_key ON public.profiles USING btree (member_id);

CREATE UNIQUE INDEX profiles_pkey ON public.profiles USING btree (user_id);

CREATE UNIQUE INDEX profiles_qr_code_key ON public.profiles USING btree (qr_code);

CREATE UNIQUE INDEX profiles_user_id_key ON public.profiles USING btree (user_id);

CREATE INDEX promotions_dates_idx ON public.promotions USING btree (start_date, end_date);

CREATE UNIQUE INDEX promotions_pkey ON public.promotions USING btree (id);

CREATE UNIQUE INDEX roles_pkey ON public.roles USING btree (id);

CREATE UNIQUE INDEX store_order_items_pkey ON public.store_order_items USING btree (id);

CREATE UNIQUE INDEX store_order_messages_pkey ON public.store_order_messages USING btree (id);

CREATE UNIQUE INDEX store_orders_pkey ON public.store_orders USING btree (id);

CREATE INDEX store_products_active_created_at_desc_idx ON public.store_products USING btree (created_at DESC) WHERE (is_active = true);

CREATE INDEX store_products_active_created_at_id_desc_idx ON public.store_products USING btree (created_at DESC, id DESC) WHERE (is_active = true);

CREATE UNIQUE INDEX store_products_pkey ON public.store_products USING btree (id);

CREATE INDEX subscriptions_frozen_until_idx ON public.subscriptions USING btree (frozen_until);

CREATE UNIQUE INDEX subscriptions_pkey ON public.subscriptions USING btree (id);

CREATE UNIQUE INDEX uniq_notify_kind_sub ON public.notifications_outbox USING btree (kind, subscription_id);

alter table "public"."app_schedule" add constraint "app_schedule_pkey" PRIMARY KEY using index "app_schedule_pkey";

alter table "public"."attendance" add constraint "attendance_pkey" PRIMARY KEY using index "attendance_pkey";

alter table "public"."audit_logs" add constraint "audit_logs_pkey" PRIMARY KEY using index "audit_logs_pkey";

alter table "public"."expense_categories" add constraint "expense_categories_pkey" PRIMARY KEY using index "expense_categories_pkey";

alter table "public"."expenses" add constraint "expenses_pkey" PRIMARY KEY using index "expenses_pkey";

alter table "public"."freeze_requests" add constraint "freeze_requests_pkey" PRIMARY KEY using index "freeze_requests_pkey";

alter table "public"."notifications" add constraint "notifications_pkey" PRIMARY KEY using index "notifications_pkey";

alter table "public"."notifications_outbox" add constraint "notifications_outbox_pkey" PRIMARY KEY using index "notifications_outbox_pkey";

alter table "public"."payments" add constraint "payments_pkey" PRIMARY KEY using index "payments_pkey";

alter table "public"."profiles" add constraint "profiles_pkey" PRIMARY KEY using index "profiles_pkey";

alter table "public"."promotions" add constraint "promotions_pkey" PRIMARY KEY using index "promotions_pkey";

alter table "public"."roles" add constraint "roles_pkey" PRIMARY KEY using index "roles_pkey";

alter table "public"."store_order_items" add constraint "store_order_items_pkey" PRIMARY KEY using index "store_order_items_pkey";

alter table "public"."store_order_messages" add constraint "store_order_messages_pkey" PRIMARY KEY using index "store_order_messages_pkey";

alter table "public"."store_orders" add constraint "store_orders_pkey" PRIMARY KEY using index "store_orders_pkey";

alter table "public"."store_products" add constraint "store_products_pkey" PRIMARY KEY using index "store_products_pkey";

alter table "public"."subscriptions" add constraint "subscriptions_pkey" PRIMARY KEY using index "subscriptions_pkey";

alter table "public"."app_schedule" add constraint "app_schedule_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL not valid;

alter table "public"."app_schedule" validate constraint "app_schedule_updated_by_fkey";

alter table "public"."attendance" add constraint "attendance_member_fk" FOREIGN KEY (member_id) REFERENCES public.profiles(user_id) not valid;

alter table "public"."attendance" validate constraint "attendance_member_fk";

alter table "public"."attendance" add constraint "attendance_scanned_by_fkey" FOREIGN KEY (scanned_by) REFERENCES auth.users(id) ON DELETE SET NULL not valid;

alter table "public"."attendance" validate constraint "attendance_scanned_by_fkey";

alter table "public"."attendance" add constraint "attendance_status_check" CHECK ((status = ANY (ARRAY['ok'::text, 'invalid'::text]))) not valid;

alter table "public"."attendance" validate constraint "attendance_status_check";

alter table "public"."attendance" add constraint "attendance_subscription_id_fkey" FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE SET NULL not valid;

alter table "public"."attendance" validate constraint "attendance_subscription_id_fkey";

alter table "public"."expenses" add constraint "expenses_category_fk" FOREIGN KEY (category_key) REFERENCES public.expense_categories(key) not valid;

alter table "public"."expenses" validate constraint "expenses_category_fk";

alter table "public"."expenses" add constraint "expenses_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL not valid;

alter table "public"."expenses" validate constraint "expenses_created_by_fkey";

alter table "public"."freeze_requests" add constraint "freeze_date_not_past" CHECK ((requested_start_date >= CURRENT_DATE)) not valid;

alter table "public"."freeze_requests" validate constraint "freeze_date_not_past";

alter table "public"."freeze_requests" add constraint "freeze_requests_member_fk" FOREIGN KEY (member_user_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE not valid;

alter table "public"."freeze_requests" validate constraint "freeze_requests_member_fk";

alter table "public"."freeze_requests" add constraint "freeze_requests_processed_fk" FOREIGN KEY (processed_by) REFERENCES public.profiles(user_id) not valid;

alter table "public"."freeze_requests" validate constraint "freeze_requests_processed_fk";

alter table "public"."notifications" add constraint "notifications_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(user_id) ON DELETE SET NULL not valid;

alter table "public"."notifications" validate constraint "notifications_created_by_fkey";

alter table "public"."notifications" add constraint "notifications_kind_check" CHECK ((kind = ANY (ARRAY['info'::text, 'order_update'::text, 'billing'::text, 'promo'::text, 'member_contact'::text, 'system'::text]))) not valid;

alter table "public"."notifications" validate constraint "notifications_kind_check";

alter table "public"."notifications" add constraint "notifications_member_id_fkey" FOREIGN KEY (member_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE not valid;

alter table "public"."notifications" validate constraint "notifications_member_id_fkey";

alter table "public"."notifications" add constraint "notifications_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;

alter table "public"."notifications" validate constraint "notifications_user_id_fkey";

alter table "public"."notifications_outbox" add constraint "notifications_outbox_kind_check" CHECK ((kind = ANY (ARRAY['expire_7d'::text, 'sessions_low'::text]))) not valid;

alter table "public"."notifications_outbox" validate constraint "notifications_outbox_kind_check";

alter table "public"."notifications_outbox" add constraint "notifications_outbox_member_id_fkey" FOREIGN KEY (member_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE not valid;

alter table "public"."notifications_outbox" validate constraint "notifications_outbox_member_id_fkey";

alter table "public"."notifications_outbox" add constraint "notifications_outbox_subscription_id_fkey" FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE SET NULL not valid;

alter table "public"."notifications_outbox" validate constraint "notifications_outbox_subscription_id_fkey";

alter table "public"."profiles" add constraint "profiles_email_key" UNIQUE using index "profiles_email_key";

alter table "public"."profiles" add constraint "profiles_member_id_key" UNIQUE using index "profiles_member_id_key";

alter table "public"."profiles" add constraint "profiles_qr_code_key" UNIQUE using index "profiles_qr_code_key";

alter table "public"."profiles" add constraint "profiles_role_check" CHECK ((role = ANY (ARRAY['member'::text, 'assistant_coach'::text, 'coach'::text, 'reception'::text, 'admin'::text, 'super_admin'::text]))) not valid;

alter table "public"."profiles" validate constraint "profiles_role_check";

alter table "public"."profiles" add constraint "profiles_user_id_key" UNIQUE using index "profiles_user_id_key";

alter table "public"."promotions" add constraint "promotions_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(user_id) ON DELETE SET NULL not valid;

alter table "public"."promotions" validate constraint "promotions_created_by_fkey";

alter table "public"."promotions" add constraint "promotions_discount_value_check" CHECK ((discount_value > (0)::numeric)) not valid;

alter table "public"."promotions" validate constraint "promotions_discount_value_check";

alter table "public"."store_order_items" add constraint "store_order_items_discount_percent_check" CHECK ((discount_percent = ANY (ARRAY[0, 20, 30]))) not valid;

alter table "public"."store_order_items" validate constraint "store_order_items_discount_percent_check";

alter table "public"."store_order_items" add constraint "store_order_items_final_price_cents_check" CHECK ((final_price_cents >= 0)) not valid;

alter table "public"."store_order_items" validate constraint "store_order_items_final_price_cents_check";

alter table "public"."store_order_items" add constraint "store_order_items_order_id_fkey" FOREIGN KEY (order_id) REFERENCES public.store_orders(id) ON DELETE CASCADE not valid;

alter table "public"."store_order_items" validate constraint "store_order_items_order_id_fkey";

alter table "public"."store_order_items" add constraint "store_order_items_product_id_fkey" FOREIGN KEY (product_id) REFERENCES public.store_products(id) ON DELETE RESTRICT not valid;

alter table "public"."store_order_items" validate constraint "store_order_items_product_id_fkey";

alter table "public"."store_order_items" add constraint "store_order_items_qty_check" CHECK ((qty > 0)) not valid;

alter table "public"."store_order_items" validate constraint "store_order_items_qty_check";

alter table "public"."store_order_items" add constraint "store_order_items_qty_positive" CHECK ((qty > 0)) not valid;

alter table "public"."store_order_items" validate constraint "store_order_items_qty_positive";

alter table "public"."store_order_items" add constraint "store_order_items_unit_price_cents_check" CHECK ((unit_price_cents >= 0)) not valid;

alter table "public"."store_order_items" validate constraint "store_order_items_unit_price_cents_check";

alter table "public"."store_order_messages" add constraint "store_order_messages_order_id_fkey" FOREIGN KEY (order_id) REFERENCES public.store_orders(id) ON DELETE CASCADE not valid;

alter table "public"."store_order_messages" validate constraint "store_order_messages_order_id_fkey";

alter table "public"."store_order_messages" add constraint "store_order_messages_sender_id_fkey" FOREIGN KEY (sender_id) REFERENCES public.profiles(user_id) ON DELETE SET NULL not valid;

alter table "public"."store_order_messages" validate constraint "store_order_messages_sender_id_fkey";

alter table "public"."store_orders" add constraint "store_orders_discount_percent_check" CHECK ((discount_percent = ANY (ARRAY[0, 20, 30]))) not valid;

alter table "public"."store_orders" validate constraint "store_orders_discount_percent_check";

alter table "public"."store_orders" add constraint "store_orders_member_id_fkey" FOREIGN KEY (member_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE not valid;

alter table "public"."store_orders" validate constraint "store_orders_member_id_fkey";

alter table "public"."store_orders" add constraint "store_orders_payment_check" CHECK ((preferred_payment = ANY (ARRAY['cash'::text, 'card'::text, 'bank_transfer'::text, 'instapay'::text]))) not valid;

alter table "public"."store_orders" validate constraint "store_orders_payment_check";

alter table "public"."store_orders" add constraint "store_orders_payment_method_check" CHECK ((payment_method = ANY (ARRAY['cash'::text, 'visa_in_gym'::text, 'bank_transfer'::text, 'instapay'::text]))) not valid;

alter table "public"."store_orders" validate constraint "store_orders_payment_method_check";

alter table "public"."store_orders" add constraint "store_orders_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'confirmed'::text, 'ready'::text, 'delivered'::text, 'canceled'::text]))) not valid;

alter table "public"."store_orders" validate constraint "store_orders_status_check";

alter table "public"."store_orders" add constraint "store_orders_total_cents_check" CHECK ((total_cents >= 0)) not valid;

alter table "public"."store_orders" validate constraint "store_orders_total_cents_check";

alter table "public"."store_orders" add constraint "store_orders_user_fk" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE RESTRICT not valid;

alter table "public"."store_orders" validate constraint "store_orders_user_fk";

alter table "public"."store_products" add constraint "store_products_category_check" CHECK ((category = ANY (ARRAY['kimono'::text, 'rashguard'::text, 'short'::text, 'belt'::text]))) not valid;

alter table "public"."store_products" validate constraint "store_products_category_check";

alter table "public"."store_products" add constraint "store_products_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(user_id) ON DELETE SET NULL not valid;

alter table "public"."store_products" validate constraint "store_products_created_by_fkey";

alter table "public"."store_products" add constraint "store_products_inventory_non_negative" CHECK ((inventory_qty >= 0)) not valid;

alter table "public"."store_products" validate constraint "store_products_inventory_non_negative";

alter table "public"."store_products" add constraint "store_products_inventory_qty_check" CHECK ((inventory_qty >= 0)) not valid;

alter table "public"."store_products" validate constraint "store_products_inventory_qty_check";

alter table "public"."store_products" add constraint "store_products_price_cents_check" CHECK ((price_cents >= 0)) not valid;

alter table "public"."store_products" validate constraint "store_products_price_cents_check";

alter table "public"."subscriptions" add constraint "subscriptions_member_id_fkey" FOREIGN KEY (member_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE not valid;

alter table "public"."subscriptions" validate constraint "subscriptions_member_id_fkey";

alter table "public"."subscriptions" add constraint "subscriptions_plan_check" CHECK ((plan = ANY (ARRAY['1m'::text, '3m'::text, '6m'::text, '12m'::text, 'sessions'::text]))) not valid;

alter table "public"."subscriptions" validate constraint "subscriptions_plan_check";

alter table "public"."subscriptions" add constraint "subscriptions_sessions_duration_check" CHECK (((plan <> 'sessions'::text) OR (end_date = (start_date + '45 days'::interval)))) not valid;

alter table "public"."subscriptions" validate constraint "subscriptions_sessions_duration_check";

alter table "public"."subscriptions" add constraint "subscriptions_sessions_total_check" CHECK (((plan <> 'sessions'::text) OR ((sessions_total >= 1) AND (sessions_total <= 10)))) not valid;

alter table "public"."subscriptions" validate constraint "subscriptions_sessions_total_check";

alter table "public"."subscriptions" add constraint "subscriptions_status_check" CHECK ((status = ANY (ARRAY['active'::text, 'paused'::text, 'cancelled'::text, 'expired'::text]))) not valid;

alter table "public"."subscriptions" validate constraint "subscriptions_status_check";

alter table "public"."subscriptions" add constraint "subscriptions_subscription_type_check" CHECK ((subscription_type = ANY (ARRAY['time'::text, 'sessions'::text]))) not valid;

alter table "public"."subscriptions" validate constraint "subscriptions_subscription_type_check";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.atom_active_by_type_today()
 RETURNS TABLE(monthly bigint, quarterly bigint, yearly bigint, dropin bigint)
 LANGUAGE sql
 STABLE
AS $function$
  with
  m as (
    select distinct user_id
    from public.subscriptions
    where subscription_type = 'monthly'
      and status = 'active'
      and end_date >= current_date
  ),
  q as (
    select distinct user_id
    from public.subscriptions
    where subscription_type = 'quarterly'
      and status = 'active'
      and end_date >= current_date
  ),
  y as (
    select distinct user_id
    from public.subscriptions
    where subscription_type = 'yearly'
      and status = 'active'
      and end_date >= current_date
  ),
  d as (
    select distinct user_id
    from public.subscriptions
    where subscription_type = 'pay_per_class'
      and coalesce(remaining_classes,0) > 0
      and (start_date + interval '45 days')::date >= current_date
  )
  select
    (select count(*) from m)::bigint as monthly,
    (select count(*) from q)::bigint as quarterly,
    (select count(*) from y)::bigint as yearly,
    (select count(*) from d)::bigint as dropin;
$function$
;

CREATE OR REPLACE FUNCTION public.atom_active_members(p_today date)
 RETURNS TABLE(count bigint)
 LANGUAGE sql
 STABLE
AS $function$
  with standard as (
    select user_id
    from public.subscriptions
    where subscription_type in ('monthly','quarterly','yearly')
      and status = 'active'
      and end_date >= p_today
  ),
  dropin as (
    select user_id
    from public.subscriptions
    where subscription_type = 'pay_per_class'
      and coalesce(remaining_classes,0) > 0
      and (start_date + interval '45 days')::date >= p_today
  ),
  unioned as (
    select user_id from standard
    union
    select user_id from dropin
  )
  select count(distinct user_id)::bigint as count
  from unioned;
$function$
;

CREATE OR REPLACE FUNCTION public.atom_active_members_today()
 RETURNS TABLE(count bigint)
 LANGUAGE sql
 STABLE
AS $function$
  with standard as (
    select user_id
    from public.subscriptions
    where subscription_type in ('monthly','quarterly','yearly')
      and status = 'active'
      and end_date >= current_date
  ),
  dropin as (
    select user_id
    from public.subscriptions
    where subscription_type = 'pay_per_class'
      and coalesce(remaining_classes,0) > 0
      and (start_date + interval '45 days')::date >= current_date
  ),
  unioned as (
    select user_id from standard
    union
    select user_id from dropin
  )
  select count(distinct user_id)::bigint as count
  from unioned;
$function$
;

CREATE OR REPLACE FUNCTION public.atom_dropin_with_credits(p_today date)
 RETURNS TABLE(count bigint)
 LANGUAGE sql
 STABLE
AS $function$
  select count(*)::bigint as count
  from public.subscriptions s
  where s.subscription_type = 'pay_per_class'
    and coalesce(s.remaining_classes,0) > 0
    and (s.start_date + interval '45 days')::date >= p_today;
$function$
;

CREATE OR REPLACE FUNCTION public.atom_dropin_with_credits_today()
 RETURNS TABLE(count bigint)
 LANGUAGE sql
 STABLE
AS $function$
  select count(*)::bigint as count
  from public.subscriptions s
  where s.subscription_type = 'pay_per_class'
    and coalesce(s.remaining_classes,0) > 0
    and (s.start_date + interval '45 days')::date >= current_date;
$function$
;

CREATE OR REPLACE FUNCTION public.atom_expiring_in_7_days(p_today date)
 RETURNS TABLE(count bigint)
 LANGUAGE sql
 STABLE
AS $function$
  select count(distinct user_id)::bigint as count
  from public.subscriptions
  where subscription_type in ('monthly','quarterly','yearly')
    and status = 'active'
    and end_date >= p_today
    and end_date < (p_today + interval '7 days')::date;
$function$
;

CREATE OR REPLACE FUNCTION public.atom_expiring_in_7_days_from_today()
 RETURNS TABLE(count bigint)
 LANGUAGE sql
 STABLE
AS $function$
  select count(distinct user_id)::bigint as count
  from public.subscriptions
  where subscription_type in ('monthly','quarterly','yearly')
    and status = 'active'
    and end_date >= current_date
    and end_date < (current_date + interval '7 days')::date;
$function$
;

CREATE OR REPLACE FUNCTION public.atom_todays_checkins(p_today date)
 RETURNS TABLE(count bigint)
 LANGUAGE sql
 STABLE
AS $function$
  select count(*)::bigint as count
  from public.attendance
  where (scan_time)::date = p_today
    and status = 'allowed';
$function$
;

CREATE OR REPLACE FUNCTION public.atom_todays_checkins_today()
 RETURNS TABLE(count bigint)
 LANGUAGE sql
 STABLE
AS $function$
  select count(*)::bigint as count
  from public.attendance
  where (scan_time)::date = current_date
    and status = 'allowed';
$function$
;

create or replace view "public"."attendance_with_day" as  SELECT id,
    date,
    scan_time,
    status,
    member_id,
    scanned_by,
    device_tag,
    valid,
    scanned_at,
    from_sessions,
    subscription_id,
    date AS attended_on
   FROM public.attendance a;


CREATE OR REPLACE FUNCTION public.consume_one_session(p_member_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_sub_id_text text;
  v_updated int;
begin
  -- Prend le pack 'sessions' actif, le plus proche d'expirer, avec sÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â©ances restantes
  select id::text into v_sub_id_text
  from public.subscriptions
  where member_id = p_member_id
    and plan = 'sessions'
    and status = 'active'
    and end_date >= current_date
    and coalesce(sessions_total,0) > coalesce(sessions_used,0)
  order by end_date asc, id asc
  limit 1;

  if v_sub_id_text is null then
    return null;
  end if;

  -- IncrÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â©mente de faÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§on atomique (marche pour uuid/bigint via cast en text)
  update public.subscriptions
  set sessions_used = coalesce(sessions_used,0) + 1
  where id::text = v_sub_id_text
    and coalesce(sessions_total,0) > coalesce(sessions_used,0);

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  if v_updated = 1 then
    return v_sub_id_text;
  else
    return null;
  end if;
end$function$
;

CREATE OR REPLACE FUNCTION public.expire_subscriptions()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  d date := current_date;
  c_time int := 0;
  c_sess int := 0;
begin
  -- 1) Expire TIME plans : end_date < today
  update public.subscriptions
     set status = 'expired'
   where subscription_type = 'time'
     and status = 'active'
     and end_date < d;
  get diagnostics c_time = row_count;

  -- 2) Expire SESSIONS : end_date < today OU plus de sÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â©ances utilisÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â©es
  update public.subscriptions
     set status = 'expired'
   where subscription_type = 'sessions'
     and status = 'active'
     and (
       end_date < d
       or coalesce(sessions_used,0) >= coalesce(sessions_total,0)
     );
  get diagnostics c_sess = row_count;

  return jsonb_build_object(
    'ok', true,
    'ran_at', now(),
    'time_expired', c_time,
    'sessions_expired', c_sess
  );
end
$function$
;

CREATE OR REPLACE FUNCTION public.f_store_order_adjust_stock()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
  it record;
  current_qty integer;
begin
  -- Passage vers READY ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ dÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â©duction
  if (TG_OP = 'UPDATE'
      and new.status = 'ready'
      and (old.status is distinct from 'ready')) then

    for it in
      select id, product_id, qty
      from public.store_order_items
      where order_id = new.id
        and stock_deducted = false
    loop
      -- verrouille la ligne produit pour concurrence sÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â»re
      select inventory_qty
        into current_qty
      from public.store_products
      where id = it.product_id
      for update;

      if current_qty is null then
        raise exception 'PRODUCT_NOT_FOUND: %', it.product_id using errcode = 'P0001';
      end if;

      if current_qty < it.qty then
        raise exception 'INSUFFICIENT_STOCK: product %, stock %, requested %',
          it.product_id, current_qty, it.qty using errcode = 'P0001';
      end if;

      update public.store_products
         set inventory_qty = inventory_qty - it.qty
       where id = it.product_id;

      update public.store_order_items
         set stock_deducted = true
       where id = it.id;
    end loop;

    return new;
  end if;

  -- Sortie de READY ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ restitution
  if (TG_OP = 'UPDATE'
      and old.status = 'ready'
      and (new.status is distinct from 'ready')) then

    for it in
      select id, product_id, qty
      from public.store_order_items
      where order_id = old.id
        and stock_deducted = true
    loop
      update public.store_products
         set inventory_qty = inventory_qty + it.qty
       where id = it.product_id;

      update public.store_order_items
         set stock_deducted = false
       where id = it.id;
    end loop;

    return new;
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.fill_member_id()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.member_id is null then
    new.member_id := public.generate_member_id();
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.generate_member_id()
 RETURNS text
 LANGUAGE plpgsql
AS $function$
  declare n int := nextval('member_seq');
  begin return 'ATOM-' || lpad(n::text, 6, '0'); end;
$function$
;

CREATE OR REPLACE FUNCTION public.guard_notifications_kind()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  allowed text[] := ARRAY['info','order_update','billing','promo','member_contact','system'];
  raw text;
  norm text;
BEGIN
  raw := NEW.kind;

  -- Normalisation agressive
  IF raw IS NULL THEN
    norm := NULL;
  ELSE
    norm := lower(btrim(raw));
    norm := replace(norm, U&'\00A0', '');  -- NBSP
    norm := replace(norm, U&'\FEFF', '');  -- ZWNBSP/BOM
    norm := replace(norm, U&'\200B', '');  -- zero-width space
    norm := regexp_replace(norm, '\s+', ' ', 'g');
    norm := replace(norm, ' ', '_');
  END IF;

  NEW.kind := norm;

  -- ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã¢â‚¬Å“ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¦ condition corrigÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â©e
  IF NEW.kind IS NULL OR NOT (NEW.kind = ANY(allowed)) THEN
    RAISE EXCEPTION 'Invalid notifications.kind="%" (bytes=%) (allowed=%)',
      NEW.kind,
      encode(convert_to(coalesce(NEW.kind, ''), 'UTF8'), 'escape'),
      allowed
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  new_role user_role := 'member';
begin
  -- RÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â©cupÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¨re role depuis les mÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â©tadonnÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â©es si fourni (et valide)
  if (new.raw_user_meta_data ? 'role') then
    begin
      new_role := (new.raw_user_meta_data->>'role')::user_role;
    exception when others then
      -- si cast impossible, on restera sur 'member'
      new_role := 'member';
    end;
  end if;

  insert into public.profiles (user_id, email, role)
  values (new.id, new.email, new_role)
  on conflict (user_id) do nothing;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.is_admin(p_uid uuid DEFAULT auth.uid())
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  select exists (
    select 1
    from public.profiles p
    where p.user_id = coalesce(p_uid, auth.uid())
      and p.role in ('admin','super_admin')
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_admin_or_super_admin(uid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  select exists (
    select 1
    from public.profiles
    where user_id = uid
      and role in ('admin','super_admin')
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_ops()
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  select public.is_ops(auth.uid());
$function$
;

CREATE OR REPLACE FUNCTION public.is_ops(uid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.profiles p
    where p.user_id = uid
      and p.role = any (array['reception','admin','super_admin'])
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_staff(uid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.profiles
    where user_id = uid
      and role in ('reception','admin','super_admin')
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_super_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  select public.is_super_admin(auth.uid());
$function$
;

CREATE OR REPLACE FUNCTION public.is_super_admin(uid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.profiles p
    where p.user_id = uid
      and p.role = 'super_admin'
  );
$function$
;

CREATE OR REPLACE FUNCTION public.notifications_fill_member_id()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.member_id is null then
    new.member_id := new.user_id;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_subscription_insert()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  insert into public.notifications(member_id, created_by, kind, title, body)
  values (
    new.member_id,
    null,
    'system',
    'Subscription created',
    case
      when new.subscription_type = 'time' then
        format('Your %s plan is active from %s to %s.',
          coalesce(new.plan,'time'),
          coalesce(to_char(new.start_date::date,'YYYY-MM-DD'),'N/A'),
          coalesce(to_char(new.end_date::date,'YYYY-MM-DD'),'N/A'))
      else
        format('Your sessions pack: %s used / %s total. Valid until %s.',
          coalesce(new.sessions_used,0),
          coalesce(new.sessions_total,0),
          coalesce(to_char(new.end_date::date,'YYYY-MM-DD'),'N/A'))
    end
  );
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.scan_and_record(p_member_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  today date := current_date;
  v_time_sub_id uuid;
  v_session_sub_id uuid;
  v_total int;
  v_used int;
  v_remaining int;
begin
  -- 0) dÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â©jÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â  pointÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â© aujourd'hui ?
  if exists (
    select 1 from public.attendance
    where member_id = p_member_id and date = today and valid is true
  ) then
    return jsonb_build_object(
      'ok', true, 'valid', true, 'type', 'already',
      'message', 'Already checked in today.'
    );
  end if;

  -- 1) abonnement TEMPS actif prioritaire
  select id into v_time_sub_id
  from public.subscriptions
  where member_id = p_member_id
    and plan <> 'sessions'
    and status = 'active'
    and start_date <= today and end_date >= today
  order by end_date asc, id asc
  limit 1;

  if v_time_sub_id is not null then
    begin
      insert into public.attendance(member_id, date, valid, subscription_id, from_sessions)
      values (p_member_id, today, true, v_time_sub_id, false);
      return jsonb_build_object(
        'ok', true, 'valid', true, 'type', 'time',
        'subscription_id', v_time_sub_id,
        'message', 'Access granted (time plan active).'
      );
    exception when unique_violation then
      return jsonb_build_object(
        'ok', true, 'valid', true, 'type', 'already',
        'message', 'Already checked in today.'
      );
    end;
  end if;

  -- 2) sinon, choisir un pack sessions actif avec reste
  select id into v_session_sub_id
  from public.subscriptions
  where member_id = p_member_id
    and plan = 'sessions'
    and status = 'active'
    and end_date >= today
    and coalesce(sessions_total,0) > coalesce(sessions_used,0)
  order by end_date asc, id asc
  limit 1;

  if v_session_sub_id is null then
    -- aucune offre valide -> on loggue invalid=false (optionnel)
    begin
      insert into public.attendance(member_id, date, valid, subscription_id, from_sessions)
      values (p_member_id, today, false, null, false);
    exception when unique_violation then
      return jsonb_build_object(
        'ok', true, 'valid', true, 'type', 'already',
        'message', 'Already checked in today.'
      );
    end;
    return jsonb_build_object(
      'ok', true, 'valid', false, 'type', 'none',
      'message', 'No active subscription.'
    );
  end if;

  -- 3) consommer 1 sÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â©ance de faÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§on atomique
  update public.subscriptions
  set sessions_used = coalesce(sessions_used,0) + 1
  where id = v_session_sub_id
    and coalesce(sessions_total,0) > coalesce(sessions_used,0);

  if not found then
    -- plus de sÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â©ances (race) -> on enregistre invalid
    begin
      insert into public.attendance(member_id, date, valid, subscription_id, from_sessions)
      values (p_member_id, today, false, null, false);
    exception when unique_violation then
      return jsonb_build_object(
        'ok', true, 'valid', true, 'type', 'already',
        'message', 'Already checked in today.'
      );
    end;
    return jsonb_build_object(
      'ok', true, 'valid', false, 'type', 'none',
      'message', 'No active subscription.'
    );
  end if;

  -- 4) lire le reste
  select sessions_total, sessions_used
    into v_total, v_used
  from public.subscriptions
  where id = v_session_sub_id;

  v_remaining := greatest(coalesce(v_total,0) - coalesce(v_used,0), 0);

  -- 5) insÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â©rer attendance (from_sessions=true)
  begin
    insert into public.attendance(member_id, date, valid, subscription_id, from_sessions)
    values (p_member_id, today, true, v_session_sub_id, true);
  exception when unique_violation then
    -- revert la conso si quelqu'un a insÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â©rÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â© en parallÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¨le
    update public.subscriptions
    set sessions_used = greatest(coalesce(sessions_used,0) - 1, 0)
    where id = v_session_sub_id;
    return jsonb_build_object(
      'ok', true, 'valid', true, 'type', 'already',
      'message', 'Already checked in today.'
    );
  end;

  return jsonb_build_object(
    'ok', true, 'valid', true, 'type', 'sessions',
    'subscription_id', v_session_sub_id,
    'remaining', v_remaining,
    'message', 'Access granted (session consumed).'
  );
end
$function$
;

CREATE OR REPLACE FUNCTION public.set_created_by()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.created_by is null then
    new.created_by := auth.uid();
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at := now();
  return new;
end$function$
;

CREATE OR REPLACE FUNCTION public.tg_soi_set_owner_uid()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if (TG_OP = 'INSERT') or (TG_OP = 'UPDATE' and NEW.order_id is distinct from OLD.order_id) then
    select o.owner_uid into NEW.owner_uid
    from public.store_orders o
    where o.id = NEW.order_id;
  end if;
  return NEW;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.tg_store_orders_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at := now();
  return new;
end; $function$
;

CREATE OR REPLACE FUNCTION public.tg_store_products_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at := now();
  return new;
end; $function$
;

grant delete on table "public"."app_schedule" to "anon";

grant insert on table "public"."app_schedule" to "anon";

grant references on table "public"."app_schedule" to "anon";

grant select on table "public"."app_schedule" to "anon";

grant trigger on table "public"."app_schedule" to "anon";

grant truncate on table "public"."app_schedule" to "anon";

grant update on table "public"."app_schedule" to "anon";

grant delete on table "public"."app_schedule" to "authenticated";

grant insert on table "public"."app_schedule" to "authenticated";

grant references on table "public"."app_schedule" to "authenticated";

grant select on table "public"."app_schedule" to "authenticated";

grant trigger on table "public"."app_schedule" to "authenticated";

grant truncate on table "public"."app_schedule" to "authenticated";

grant update on table "public"."app_schedule" to "authenticated";

grant delete on table "public"."app_schedule" to "service_role";

grant insert on table "public"."app_schedule" to "service_role";

grant references on table "public"."app_schedule" to "service_role";

grant select on table "public"."app_schedule" to "service_role";

grant trigger on table "public"."app_schedule" to "service_role";

grant truncate on table "public"."app_schedule" to "service_role";

grant update on table "public"."app_schedule" to "service_role";

grant delete on table "public"."attendance" to "anon";

grant insert on table "public"."attendance" to "anon";

grant references on table "public"."attendance" to "anon";

grant select on table "public"."attendance" to "anon";

grant trigger on table "public"."attendance" to "anon";

grant truncate on table "public"."attendance" to "anon";

grant update on table "public"."attendance" to "anon";

grant delete on table "public"."attendance" to "authenticated";

grant insert on table "public"."attendance" to "authenticated";

grant references on table "public"."attendance" to "authenticated";

grant select on table "public"."attendance" to "authenticated";

grant trigger on table "public"."attendance" to "authenticated";

grant truncate on table "public"."attendance" to "authenticated";

grant update on table "public"."attendance" to "authenticated";

grant delete on table "public"."attendance" to "service_role";

grant insert on table "public"."attendance" to "service_role";

grant references on table "public"."attendance" to "service_role";

grant select on table "public"."attendance" to "service_role";

grant trigger on table "public"."attendance" to "service_role";

grant truncate on table "public"."attendance" to "service_role";

grant update on table "public"."attendance" to "service_role";

grant references on table "public"."audit_logs" to "authenticated";

grant select on table "public"."audit_logs" to "authenticated";

grant trigger on table "public"."audit_logs" to "authenticated";

grant truncate on table "public"."audit_logs" to "authenticated";

grant delete on table "public"."audit_logs" to "service_role";

grant insert on table "public"."audit_logs" to "service_role";

grant references on table "public"."audit_logs" to "service_role";

grant select on table "public"."audit_logs" to "service_role";

grant trigger on table "public"."audit_logs" to "service_role";

grant truncate on table "public"."audit_logs" to "service_role";

grant update on table "public"."audit_logs" to "service_role";

grant delete on table "public"."expense_categories" to "authenticated";

grant insert on table "public"."expense_categories" to "authenticated";

grant references on table "public"."expense_categories" to "authenticated";

grant select on table "public"."expense_categories" to "authenticated";

grant trigger on table "public"."expense_categories" to "authenticated";

grant truncate on table "public"."expense_categories" to "authenticated";

grant update on table "public"."expense_categories" to "authenticated";

grant delete on table "public"."expense_categories" to "service_role";

grant insert on table "public"."expense_categories" to "service_role";

grant references on table "public"."expense_categories" to "service_role";

grant select on table "public"."expense_categories" to "service_role";

grant trigger on table "public"."expense_categories" to "service_role";

grant truncate on table "public"."expense_categories" to "service_role";

grant update on table "public"."expense_categories" to "service_role";

grant delete on table "public"."expenses" to "authenticated";

grant insert on table "public"."expenses" to "authenticated";

grant references on table "public"."expenses" to "authenticated";

grant select on table "public"."expenses" to "authenticated";

grant trigger on table "public"."expenses" to "authenticated";

grant truncate on table "public"."expenses" to "authenticated";

grant update on table "public"."expenses" to "authenticated";

grant delete on table "public"."expenses" to "service_role";

grant insert on table "public"."expenses" to "service_role";

grant references on table "public"."expenses" to "service_role";

grant select on table "public"."expenses" to "service_role";

grant trigger on table "public"."expenses" to "service_role";

grant truncate on table "public"."expenses" to "service_role";

grant update on table "public"."expenses" to "service_role";

grant delete on table "public"."freeze_requests" to "anon";

grant insert on table "public"."freeze_requests" to "anon";

grant references on table "public"."freeze_requests" to "anon";

grant select on table "public"."freeze_requests" to "anon";

grant trigger on table "public"."freeze_requests" to "anon";

grant truncate on table "public"."freeze_requests" to "anon";

grant update on table "public"."freeze_requests" to "anon";

grant delete on table "public"."freeze_requests" to "authenticated";

grant insert on table "public"."freeze_requests" to "authenticated";

grant references on table "public"."freeze_requests" to "authenticated";

grant select on table "public"."freeze_requests" to "authenticated";

grant trigger on table "public"."freeze_requests" to "authenticated";

grant truncate on table "public"."freeze_requests" to "authenticated";

grant update on table "public"."freeze_requests" to "authenticated";

grant delete on table "public"."freeze_requests" to "service_role";

grant insert on table "public"."freeze_requests" to "service_role";

grant references on table "public"."freeze_requests" to "service_role";

grant select on table "public"."freeze_requests" to "service_role";

grant trigger on table "public"."freeze_requests" to "service_role";

grant truncate on table "public"."freeze_requests" to "service_role";

grant update on table "public"."freeze_requests" to "service_role";

grant delete on table "public"."notifications" to "anon";

grant insert on table "public"."notifications" to "anon";

grant references on table "public"."notifications" to "anon";

grant select on table "public"."notifications" to "anon";

grant trigger on table "public"."notifications" to "anon";

grant truncate on table "public"."notifications" to "anon";

grant update on table "public"."notifications" to "anon";

grant delete on table "public"."notifications" to "authenticated";

grant insert on table "public"."notifications" to "authenticated";

grant references on table "public"."notifications" to "authenticated";

grant select on table "public"."notifications" to "authenticated";

grant trigger on table "public"."notifications" to "authenticated";

grant truncate on table "public"."notifications" to "authenticated";

grant update on table "public"."notifications" to "authenticated";

grant delete on table "public"."notifications" to "service_role";

grant insert on table "public"."notifications" to "service_role";

grant references on table "public"."notifications" to "service_role";

grant select on table "public"."notifications" to "service_role";

grant trigger on table "public"."notifications" to "service_role";

grant truncate on table "public"."notifications" to "service_role";

grant update on table "public"."notifications" to "service_role";

grant delete on table "public"."notifications_outbox" to "anon";

grant insert on table "public"."notifications_outbox" to "anon";

grant references on table "public"."notifications_outbox" to "anon";

grant select on table "public"."notifications_outbox" to "anon";

grant trigger on table "public"."notifications_outbox" to "anon";

grant truncate on table "public"."notifications_outbox" to "anon";

grant update on table "public"."notifications_outbox" to "anon";

grant delete on table "public"."notifications_outbox" to "authenticated";

grant insert on table "public"."notifications_outbox" to "authenticated";

grant references on table "public"."notifications_outbox" to "authenticated";

grant select on table "public"."notifications_outbox" to "authenticated";

grant trigger on table "public"."notifications_outbox" to "authenticated";

grant truncate on table "public"."notifications_outbox" to "authenticated";

grant update on table "public"."notifications_outbox" to "authenticated";

grant delete on table "public"."notifications_outbox" to "service_role";

grant insert on table "public"."notifications_outbox" to "service_role";

grant references on table "public"."notifications_outbox" to "service_role";

grant select on table "public"."notifications_outbox" to "service_role";

grant trigger on table "public"."notifications_outbox" to "service_role";

grant truncate on table "public"."notifications_outbox" to "service_role";

grant update on table "public"."notifications_outbox" to "service_role";

grant delete on table "public"."payments" to "authenticated";

grant insert on table "public"."payments" to "authenticated";

grant references on table "public"."payments" to "authenticated";

grant select on table "public"."payments" to "authenticated";

grant trigger on table "public"."payments" to "authenticated";

grant truncate on table "public"."payments" to "authenticated";

grant update on table "public"."payments" to "authenticated";

grant delete on table "public"."payments" to "service_role";

grant insert on table "public"."payments" to "service_role";

grant references on table "public"."payments" to "service_role";

grant select on table "public"."payments" to "service_role";

grant trigger on table "public"."payments" to "service_role";

grant truncate on table "public"."payments" to "service_role";

grant update on table "public"."payments" to "service_role";

grant delete on table "public"."profiles" to "anon";

grant insert on table "public"."profiles" to "anon";

grant references on table "public"."profiles" to "anon";

grant select on table "public"."profiles" to "anon";

grant trigger on table "public"."profiles" to "anon";

grant truncate on table "public"."profiles" to "anon";

grant update on table "public"."profiles" to "anon";

grant delete on table "public"."profiles" to "authenticated";

grant insert on table "public"."profiles" to "authenticated";

grant references on table "public"."profiles" to "authenticated";

grant select on table "public"."profiles" to "authenticated";

grant trigger on table "public"."profiles" to "authenticated";

grant truncate on table "public"."profiles" to "authenticated";

grant update on table "public"."profiles" to "authenticated";

grant delete on table "public"."profiles" to "service_role";

grant insert on table "public"."profiles" to "service_role";

grant references on table "public"."profiles" to "service_role";

grant select on table "public"."profiles" to "service_role";

grant trigger on table "public"."profiles" to "service_role";

grant truncate on table "public"."profiles" to "service_role";

grant update on table "public"."profiles" to "service_role";

grant delete on table "public"."promotions" to "anon";

grant insert on table "public"."promotions" to "anon";

grant references on table "public"."promotions" to "anon";

grant select on table "public"."promotions" to "anon";

grant trigger on table "public"."promotions" to "anon";

grant truncate on table "public"."promotions" to "anon";

grant update on table "public"."promotions" to "anon";

grant delete on table "public"."promotions" to "authenticated";

grant insert on table "public"."promotions" to "authenticated";

grant references on table "public"."promotions" to "authenticated";

grant select on table "public"."promotions" to "authenticated";

grant trigger on table "public"."promotions" to "authenticated";

grant truncate on table "public"."promotions" to "authenticated";

grant update on table "public"."promotions" to "authenticated";

grant delete on table "public"."promotions" to "service_role";

grant insert on table "public"."promotions" to "service_role";

grant references on table "public"."promotions" to "service_role";

grant select on table "public"."promotions" to "service_role";

grant trigger on table "public"."promotions" to "service_role";

grant truncate on table "public"."promotions" to "service_role";

grant update on table "public"."promotions" to "service_role";

grant delete on table "public"."roles" to "anon";

grant insert on table "public"."roles" to "anon";

grant references on table "public"."roles" to "anon";

grant select on table "public"."roles" to "anon";

grant trigger on table "public"."roles" to "anon";

grant truncate on table "public"."roles" to "anon";

grant update on table "public"."roles" to "anon";

grant delete on table "public"."roles" to "authenticated";

grant insert on table "public"."roles" to "authenticated";

grant references on table "public"."roles" to "authenticated";

grant select on table "public"."roles" to "authenticated";

grant trigger on table "public"."roles" to "authenticated";

grant truncate on table "public"."roles" to "authenticated";

grant update on table "public"."roles" to "authenticated";

grant delete on table "public"."roles" to "service_role";

grant insert on table "public"."roles" to "service_role";

grant references on table "public"."roles" to "service_role";

grant select on table "public"."roles" to "service_role";

grant trigger on table "public"."roles" to "service_role";

grant truncate on table "public"."roles" to "service_role";

grant update on table "public"."roles" to "service_role";

grant delete on table "public"."store_order_items" to "anon";

grant insert on table "public"."store_order_items" to "anon";

grant references on table "public"."store_order_items" to "anon";

grant select on table "public"."store_order_items" to "anon";

grant trigger on table "public"."store_order_items" to "anon";

grant truncate on table "public"."store_order_items" to "anon";

grant update on table "public"."store_order_items" to "anon";

grant delete on table "public"."store_order_items" to "authenticated";

grant insert on table "public"."store_order_items" to "authenticated";

grant references on table "public"."store_order_items" to "authenticated";

grant select on table "public"."store_order_items" to "authenticated";

grant trigger on table "public"."store_order_items" to "authenticated";

grant truncate on table "public"."store_order_items" to "authenticated";

grant update on table "public"."store_order_items" to "authenticated";

grant delete on table "public"."store_order_items" to "service_role";

grant insert on table "public"."store_order_items" to "service_role";

grant references on table "public"."store_order_items" to "service_role";

grant select on table "public"."store_order_items" to "service_role";

grant trigger on table "public"."store_order_items" to "service_role";

grant truncate on table "public"."store_order_items" to "service_role";

grant update on table "public"."store_order_items" to "service_role";

grant delete on table "public"."store_order_messages" to "anon";

grant insert on table "public"."store_order_messages" to "anon";

grant references on table "public"."store_order_messages" to "anon";

grant select on table "public"."store_order_messages" to "anon";

grant trigger on table "public"."store_order_messages" to "anon";

grant truncate on table "public"."store_order_messages" to "anon";

grant update on table "public"."store_order_messages" to "anon";

grant delete on table "public"."store_order_messages" to "authenticated";

grant insert on table "public"."store_order_messages" to "authenticated";

grant references on table "public"."store_order_messages" to "authenticated";

grant select on table "public"."store_order_messages" to "authenticated";

grant trigger on table "public"."store_order_messages" to "authenticated";

grant truncate on table "public"."store_order_messages" to "authenticated";

grant update on table "public"."store_order_messages" to "authenticated";

grant delete on table "public"."store_order_messages" to "service_role";

grant insert on table "public"."store_order_messages" to "service_role";

grant references on table "public"."store_order_messages" to "service_role";

grant select on table "public"."store_order_messages" to "service_role";

grant trigger on table "public"."store_order_messages" to "service_role";

grant truncate on table "public"."store_order_messages" to "service_role";

grant update on table "public"."store_order_messages" to "service_role";

grant delete on table "public"."store_orders" to "anon";

grant insert on table "public"."store_orders" to "anon";

grant references on table "public"."store_orders" to "anon";

grant select on table "public"."store_orders" to "anon";

grant trigger on table "public"."store_orders" to "anon";

grant truncate on table "public"."store_orders" to "anon";

grant update on table "public"."store_orders" to "anon";

grant delete on table "public"."store_orders" to "authenticated";

grant insert on table "public"."store_orders" to "authenticated";

grant references on table "public"."store_orders" to "authenticated";

grant select on table "public"."store_orders" to "authenticated";

grant trigger on table "public"."store_orders" to "authenticated";

grant truncate on table "public"."store_orders" to "authenticated";

grant update on table "public"."store_orders" to "authenticated";

grant delete on table "public"."store_orders" to "service_role";

grant insert on table "public"."store_orders" to "service_role";

grant references on table "public"."store_orders" to "service_role";

grant select on table "public"."store_orders" to "service_role";

grant trigger on table "public"."store_orders" to "service_role";

grant truncate on table "public"."store_orders" to "service_role";

grant update on table "public"."store_orders" to "service_role";

grant delete on table "public"."store_products" to "authenticated";

grant insert on table "public"."store_products" to "authenticated";

grant references on table "public"."store_products" to "authenticated";

grant select on table "public"."store_products" to "authenticated";

grant trigger on table "public"."store_products" to "authenticated";

grant truncate on table "public"."store_products" to "authenticated";

grant update on table "public"."store_products" to "authenticated";

grant delete on table "public"."store_products" to "service_role";

grant insert on table "public"."store_products" to "service_role";

grant references on table "public"."store_products" to "service_role";

grant select on table "public"."store_products" to "service_role";

grant trigger on table "public"."store_products" to "service_role";

grant truncate on table "public"."store_products" to "service_role";

grant update on table "public"."store_products" to "service_role";

grant delete on table "public"."subscriptions" to "anon";

grant insert on table "public"."subscriptions" to "anon";

grant references on table "public"."subscriptions" to "anon";

grant select on table "public"."subscriptions" to "anon";

grant trigger on table "public"."subscriptions" to "anon";

grant truncate on table "public"."subscriptions" to "anon";

grant update on table "public"."subscriptions" to "anon";

grant delete on table "public"."subscriptions" to "authenticated";

grant insert on table "public"."subscriptions" to "authenticated";

grant references on table "public"."subscriptions" to "authenticated";

grant select on table "public"."subscriptions" to "authenticated";

grant trigger on table "public"."subscriptions" to "authenticated";

grant truncate on table "public"."subscriptions" to "authenticated";

grant update on table "public"."subscriptions" to "authenticated";

grant delete on table "public"."subscriptions" to "service_role";

grant insert on table "public"."subscriptions" to "service_role";

grant references on table "public"."subscriptions" to "service_role";

grant select on table "public"."subscriptions" to "service_role";

grant trigger on table "public"."subscriptions" to "service_role";

grant truncate on table "public"."subscriptions" to "service_role";

grant update on table "public"."subscriptions" to "service_role";


  create policy "schedule_select_authenticated"
  on "public"."app_schedule"
  as permissive
  for select
  to authenticated
using (true);



  create policy "schedule_super_admin_delete"
  on "public"."app_schedule"
  as permissive
  for delete
  to authenticated
using ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.user_id = auth.uid()) AND (p.role = 'super_admin'::text)))));



  create policy "schedule_super_admin_insert"
  on "public"."app_schedule"
  as permissive
  for insert
  to authenticated
with check ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.user_id = auth.uid()) AND (p.role = 'super_admin'::text)))));



  create policy "schedule_super_admin_update"
  on "public"."app_schedule"
  as permissive
  for update
  to authenticated
using ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.user_id = auth.uid()) AND (p.role = 'super_admin'::text)))))
with check ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.user_id = auth.uid()) AND (p.role = 'super_admin'::text)))));



  create policy "attendance_admin_read"
  on "public"."attendance"
  as permissive
  for select
  to authenticated
using (((auth.jwt() ->> 'role'::text) = ANY (ARRAY['admin'::text, 'super_admin'::text])));



  create policy "attendance_insert_staff"
  on "public"."attendance"
  as permissive
  for insert
  to authenticated
with check (public.is_staff(auth.uid()));



  create policy "attendance_member_read"
  on "public"."attendance"
  as permissive
  for select
  to authenticated
using ((member_id = auth.uid()));



  create policy "attendance_read_self_or_staff"
  on "public"."attendance"
  as permissive
  for select
  to authenticated
using (((member_id = auth.uid()) OR public.is_staff(auth.uid())));



  create policy "attendance_staff_insert"
  on "public"."attendance"
  as permissive
  for insert
  to authenticated
with check (public.is_staff(auth.uid()));



  create policy "attendance_staff_read"
  on "public"."attendance"
  as permissive
  for select
  to authenticated
using (public.is_staff(auth.uid()));



  create policy "attendance_staff_update"
  on "public"."attendance"
  as permissive
  for update
  to authenticated
using (public.is_staff(auth.uid()))
with check (public.is_staff(auth.uid()));



  create policy "audit_logs_select_super_admin"
  on "public"."audit_logs"
  as permissive
  for select
  to authenticated
using (public.is_super_admin(auth.uid()));



  create policy "expense_categories_select_ops"
  on "public"."expense_categories"
  as permissive
  for select
  to authenticated
using (public.is_ops(auth.uid()));



  create policy "expense_categories_write_admin"
  on "public"."expense_categories"
  as permissive
  for all
  to authenticated
using (public.is_admin_or_super_admin(auth.uid()))
with check (public.is_admin_or_super_admin(auth.uid()));



  create policy "expense_categories_write_super_admin"
  on "public"."expense_categories"
  as permissive
  for all
  to authenticated
using (public.is_super_admin(auth.uid()))
with check (public.is_super_admin(auth.uid()));



  create policy "expenses_delete_admin"
  on "public"."expenses"
  as permissive
  for delete
  to authenticated
using (public.is_admin_or_super_admin(auth.uid()));



  create policy "expenses_insert_ops"
  on "public"."expenses"
  as permissive
  for insert
  to authenticated
with check (public.is_ops(auth.uid()));



  create policy "expenses_select_ops"
  on "public"."expenses"
  as permissive
  for select
  to authenticated
using (public.is_ops(auth.uid()));



  create policy "expenses_update_ops"
  on "public"."expenses"
  as permissive
  for update
  to authenticated
using (public.is_ops(auth.uid()))
with check (public.is_ops(auth.uid()));



  create policy "admins manage all freeze requests"
  on "public"."freeze_requests"
  as permissive
  for all
  to authenticated
using ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.user_id = auth.uid()) AND (p.role = ANY (ARRAY['admin'::text, 'super_admin'::text]))))))
with check ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.user_id = auth.uid()) AND (p.role = ANY (ARRAY['admin'::text, 'super_admin'::text]))))));



  create policy "members insert own freeze request"
  on "public"."freeze_requests"
  as permissive
  for insert
  to authenticated
with check ((auth.uid() = member_user_id));



  create policy "members read own freeze requests"
  on "public"."freeze_requests"
  as permissive
  for select
  to authenticated
using ((auth.uid() = member_user_id));



  create policy "notif_insert_admin"
  on "public"."notifications"
  as permissive
  for insert
  to authenticated
with check ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.user_id = auth.uid()) AND (p.role = ANY (ARRAY['admin'::text, 'super_admin'::text]))))));



  create policy "notif_read_own"
  on "public"."notifications"
  as permissive
  for select
  to authenticated
using (((user_id = auth.uid()) OR ((created_by = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.user_id = auth.uid()) AND (p.role = ANY (ARRAY['admin'::text, 'super_admin'::text]))))))));



  create policy "notif_update_read_own"
  on "public"."notifications"
  as permissive
  for update
  to authenticated
using ((user_id = auth.uid()))
with check ((user_id = auth.uid()));



  create policy "notifications_insert_admin"
  on "public"."notifications"
  as permissive
  for insert
  to public
with check ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.user_id = auth.uid()) AND (p.role = ANY (ARRAY['admin'::text, 'super_admin'::text]))))));



  create policy "notifications_select_admin"
  on "public"."notifications"
  as permissive
  for select
  to public
using ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.user_id = auth.uid()) AND (p.role = ANY (ARRAY['admin'::text, 'super_admin'::text]))))));



  create policy "notifications_select_self"
  on "public"."notifications"
  as permissive
  for select
  to public
using ((auth.uid() = member_id));



  create policy "notifications_update_read"
  on "public"."notifications"
  as permissive
  for update
  to public
using ((auth.uid() = member_id))
with check ((auth.uid() = member_id));



  create policy "reception_insert_subscription_billing_notification"
  on "public"."notifications"
  as permissive
  for insert
  to authenticated
with check (((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.user_id = auth.uid()) AND (p.role = 'reception'::text)))) AND (kind = 'billing'::text) AND (title = 'Subscription updated'::text) AND (created_by = auth.uid()) AND (user_id IS NOT NULL) AND (member_id = user_id)));



  create policy "notify_select"
  on "public"."notifications_outbox"
  as permissive
  for select
  to public
using (false);



  create policy "notify_write"
  on "public"."notifications_outbox"
  as permissive
  for all
  to public
using (false)
with check (false);



  create policy "payments_delete_admin"
  on "public"."payments"
  as permissive
  for delete
  to authenticated
using (public.is_admin_or_super_admin(auth.uid()));



  create policy "payments_insert_ops"
  on "public"."payments"
  as permissive
  for insert
  to authenticated
with check (public.is_ops(auth.uid()));



  create policy "payments_select_ops_all"
  on "public"."payments"
  as permissive
  for select
  to authenticated
using (public.is_ops(auth.uid()));



  create policy "payments_select_own"
  on "public"."payments"
  as permissive
  for select
  to authenticated
using ((user_id = auth.uid()));



  create policy "payments_update_ops"
  on "public"."payments"
  as permissive
  for update
  to authenticated
using (public.is_ops(auth.uid()))
with check (public.is_ops(auth.uid()));



  create policy "profiles_select_ops_all"
  on "public"."profiles"
  as permissive
  for select
  to authenticated
using (public.is_ops(auth.uid()));



  create policy "profiles_select_self"
  on "public"."profiles"
  as permissive
  for select
  to authenticated
using ((user_id = auth.uid()));



  create policy "profiles_update_self"
  on "public"."profiles"
  as permissive
  for update
  to authenticated
using ((user_id = auth.uid()))
with check ((user_id = auth.uid()));



  create policy "allow_admins_select_promotions"
  on "public"."promotions"
  as permissive
  for select
  to authenticated
using (public.is_admin_or_super_admin(auth.uid()));



  create policy "allow_admins_write_promotions"
  on "public"."promotions"
  as permissive
  for all
  to authenticated
using (public.is_admin_or_super_admin(auth.uid()))
with check (public.is_admin_or_super_admin(auth.uid()));



  create policy "delete promotions (super_admin)"
  on "public"."promotions"
  as permissive
  for delete
  to authenticated
using ((EXISTS ( SELECT 1
   FROM public.profiles pr
  WHERE ((pr.user_id = auth.uid()) AND (pr.role = 'super_admin'::text)))));



  create policy "insert promotions (super_admin)"
  on "public"."promotions"
  as permissive
  for insert
  to authenticated
with check ((EXISTS ( SELECT 1
   FROM public.profiles pr
  WHERE ((pr.user_id = auth.uid()) AND (pr.role = 'super_admin'::text)))));



  create policy "promotions_delete_admin"
  on "public"."promotions"
  as permissive
  for delete
  to authenticated
using (public.is_admin_or_super_admin(auth.uid()));



  create policy "promotions_insert_admin"
  on "public"."promotions"
  as permissive
  for insert
  to authenticated
with check (public.is_admin_or_super_admin(auth.uid()));



  create policy "promotions_select_admin"
  on "public"."promotions"
  as permissive
  for select
  to authenticated
using (public.is_admin_or_super_admin(auth.uid()));



  create policy "promotions_update_admin"
  on "public"."promotions"
  as permissive
  for update
  to authenticated
using (public.is_admin_or_super_admin(auth.uid()))
with check (public.is_admin_or_super_admin(auth.uid()));



  create policy "select promotions (any authenticated)"
  on "public"."promotions"
  as permissive
  for select
  to authenticated
using (true);



  create policy "update promotions (super_admin)"
  on "public"."promotions"
  as permissive
  for update
  to authenticated
using ((EXISTS ( SELECT 1
   FROM public.profiles pr
  WHERE ((pr.user_id = auth.uid()) AND (pr.role = 'super_admin'::text)))))
with check ((EXISTS ( SELECT 1
   FROM public.profiles pr
  WHERE ((pr.user_id = auth.uid()) AND (pr.role = 'super_admin'::text)))));



  create policy "soi_select_fast"
  on "public"."store_order_items"
  as permissive
  for select
  to authenticated
using (((owner_uid = auth.uid()) OR public.is_super_admin(auth.uid())));



  create policy "store_order_items_delete_staff"
  on "public"."store_order_items"
  as permissive
  for delete
  to public
using ((EXISTS ( SELECT 1
   FROM public.store_orders o
  WHERE ((o.id = store_order_items.order_id) AND public.is_staff(auth.uid())))));



  create policy "store_order_items_insert"
  on "public"."store_order_items"
  as permissive
  for insert
  to public
with check ((EXISTS ( SELECT 1
   FROM public.store_orders o
  WHERE ((o.id = store_order_items.order_id) AND (o.member_id = auth.uid())))));



  create policy "store_order_items_insert_own"
  on "public"."store_order_items"
  as permissive
  for insert
  to public
with check ((EXISTS ( SELECT 1
   FROM public.store_orders o
  WHERE ((o.id = store_order_items.order_id) AND ((o.user_id = auth.uid()) OR public.is_staff(auth.uid()))))));



  create policy "store_order_items_insert_self"
  on "public"."store_order_items"
  as permissive
  for insert
  to public
with check ((EXISTS ( SELECT 1
   FROM public.store_orders o
  WHERE ((o.id = store_order_items.order_id) AND (o.member_id = auth.uid()) AND (o.created_by = auth.uid())))));



  create policy "store_order_items_update_staff"
  on "public"."store_order_items"
  as permissive
  for update
  to public
using ((EXISTS ( SELECT 1
   FROM public.store_orders o
  WHERE ((o.id = store_order_items.order_id) AND public.is_staff(auth.uid())))));



  create policy "store_order_messages_insert_admin"
  on "public"."store_order_messages"
  as permissive
  for insert
  to public
with check ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.user_id = auth.uid()) AND (p.role = ANY (ARRAY['admin'::text, 'super_admin'::text]))))));



  create policy "store_order_messages_select"
  on "public"."store_order_messages"
  as permissive
  for select
  to public
using ((EXISTS ( SELECT 1
   FROM public.store_orders o
  WHERE ((o.id = store_order_messages.order_id) AND ((o.member_id = auth.uid()) OR (EXISTS ( SELECT 1
           FROM public.profiles p
          WHERE ((p.user_id = auth.uid()) AND (p.role = ANY (ARRAY['admin'::text, 'super_admin'::text]))))))))));



  create policy "so_select_base"
  on "public"."store_orders"
  as permissive
  for select
  to authenticated
using (((owner_uid = auth.uid()) OR public.is_super_admin(auth.uid())));



  create policy "so_update_admin"
  on "public"."store_orders"
  as permissive
  for update
  to authenticated
using ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.user_id = auth.uid()) AND (p.role = 'super_admin'::text)))))
with check (true);



  create policy "so_update_super_admin"
  on "public"."store_orders"
  as permissive
  for update
  to authenticated
using (public.is_super_admin())
with check (true);



  create policy "store_orders_delete_staff"
  on "public"."store_orders"
  as permissive
  for delete
  to public
using (public.is_staff(auth.uid()));



  create policy "store_orders_insert"
  on "public"."store_orders"
  as permissive
  for insert
  to public
with check ((member_id = auth.uid()));



  create policy "store_orders_insert_own"
  on "public"."store_orders"
  as permissive
  for insert
  to public
with check ((user_id = auth.uid()));



  create policy "store_orders_insert_self"
  on "public"."store_orders"
  as permissive
  for insert
  to public
with check (((member_id = auth.uid()) AND (created_by = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.user_id = auth.uid()) AND (p.role = ANY (ARRAY['member'::text, 'assistant_coach'::text, 'coach'::text])))))));



  create policy "store_orders_update_admin"
  on "public"."store_orders"
  as permissive
  for update
  to public
using ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.user_id = auth.uid()) AND (p.role = ANY (ARRAY['admin'::text, 'super_admin'::text]))))))
with check ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.user_id = auth.uid()) AND (p.role = ANY (ARRAY['admin'::text, 'super_admin'::text]))))));



  create policy "store_orders_update_staff"
  on "public"."store_orders"
  as permissive
  for update
  to public
using (public.is_staff(auth.uid()));



  create policy "store_orders_update_super_admin"
  on "public"."store_orders"
  as permissive
  for update
  to authenticated
using ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.user_id = auth.uid()) AND (p.role = 'super_admin'::text)))))
with check (true);



  create policy "store_products_select_auth"
  on "public"."store_products"
  as permissive
  for select
  to authenticated
using (((is_active = true) OR public.is_super_admin(auth.uid())));



  create policy "store_products_write_super_admin"
  on "public"."store_products"
  as permissive
  for all
  to authenticated
using (public.is_super_admin(auth.uid()))
with check (public.is_super_admin(auth.uid()));



  create policy "subscriptions_insert_staff"
  on "public"."subscriptions"
  as permissive
  for insert
  to authenticated
with check (public.is_staff(auth.uid()));



  create policy "subscriptions_read_member_or_staff"
  on "public"."subscriptions"
  as permissive
  for select
  to authenticated
using (((member_id = auth.uid()) OR public.is_staff(auth.uid())));



  create policy "subscriptions_update_staff"
  on "public"."subscriptions"
  as permissive
  for update
  to authenticated
using (public.is_staff(auth.uid()))
with check (public.is_staff(auth.uid()));


CREATE TRIGGER trg_expenses_set_created_by BEFORE INSERT ON public.expenses FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

CREATE TRIGGER a00_guard_notifications_kind BEFORE INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION public.guard_notifications_kind();

CREATE TRIGGER trg_notifications_fill_member_id BEFORE INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION public.notifications_fill_member_id();

CREATE TRIGGER trg_fill_member_id BEFORE INSERT ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.fill_member_id();

CREATE TRIGGER trg_promotions_updated_at BEFORE UPDATE ON public.promotions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_soi_set_owner_uid BEFORE INSERT OR UPDATE OF order_id ON public.store_order_items FOR EACH ROW EXECUTE FUNCTION public.tg_soi_set_owner_uid();

CREATE TRIGGER trg_store_order_adjust_stock AFTER UPDATE OF status ON public.store_orders FOR EACH ROW EXECUTE FUNCTION public.f_store_order_adjust_stock();

CREATE TRIGGER trg_store_orders_updated_at BEFORE UPDATE ON public.store_orders FOR EACH ROW EXECUTE FUNCTION public.tg_store_orders_updated_at();

CREATE TRIGGER trg_store_products_updated_at BEFORE UPDATE ON public.store_products FOR EACH ROW EXECUTE FUNCTION public.tg_store_products_updated_at();

CREATE TRIGGER trg_notify_subscription_insert AFTER INSERT ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION public.notify_subscription_insert();


