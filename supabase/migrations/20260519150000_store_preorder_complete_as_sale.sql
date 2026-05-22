-- Store preorders: complete a preorder as a delivered paid sale.
-- This keeps preorders as reservations until the customer receives the item and pays in full.

alter table public.store_preorders
  add column if not exists converted_sale_id uuid;

do $$
begin
  if to_regclass('public.store_sales') is not null
     and not exists (
       select 1
       from pg_constraint
       where conname = 'store_preorders_converted_sale_id_fkey'
         and conrelid = 'public.store_preorders'::regclass
     ) then
    alter table public.store_preorders
      add constraint store_preorders_converted_sale_id_fkey
      foreign key (converted_sale_id)
      references public.store_sales(id)
      on delete set null;
  end if;
end $$;

create or replace function public.admin_complete_store_preorder_as_sale(
  _preorder_id uuid,
  _payment_method text,
  _actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pre record;
  v_product record;
  v_sale_id uuid;
  v_cols text[] := array[]::text[];
  v_vals text[] := array[]::text[];
  v_sql text;
  v_note text;
  v_now timestamptz := now();
  v_today date := (now() at time zone 'Africa/Cairo')::date;

  function_col_exists boolean;
begin
  if _payment_method not in ('cash', 'instapay', 'bank_transfer', 'card') then
    raise exception 'INVALID_PAYMENT_METHOD';
  end if;

  select *
    into v_pre
  from public.store_preorders
  where id = _preorder_id
  for update;

  if not found then
    raise exception 'PREORDER_NOT_FOUND';
  end if;

  if v_pre.converted_sale_id is not null then
    raise exception 'PREORDER_ALREADY_CONVERTED';
  end if;

  if v_pre.status in ('completed', 'canceled') then
    raise exception 'PREORDER_NOT_CONVERTIBLE';
  end if;

  if v_pre.product_id is null then
    raise exception 'PREORDER_PRODUCT_REQUIRED';
  end if;

  if coalesce(v_pre.qty, 0) <= 0 then
    raise exception 'PREORDER_QTY_INVALID';
  end if;

  select id, inventory_qty
    into v_product
  from public.store_products
  where id = v_pre.product_id
  for update;

  if not found then
    raise exception 'PRODUCT_NOT_FOUND';
  end if;

  if coalesce(v_product.inventory_qty, 0) < coalesce(v_pre.qty, 0) then
    raise exception 'INSUFFICIENT_STOCK';
  end if;

  v_note := trim(both from concat_ws(E'\n\n',
    nullif(v_pre.note, ''),
    'Converted automatically from preorder ' || v_pre.id::text || ' after full payment and delivery. Final payment method: ' || _payment_method || '.'
  ));

  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'store_sales' and column_name = 'buyer_user_id' and is_generated = 'NEVER') then
    v_cols := array_append(v_cols, quote_ident('buyer_user_id'));
    v_vals := array_append(v_vals, quote_nullable(v_pre.buyer_user_id));
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'store_sales' and column_name = 'buyer_full_name' and is_generated = 'NEVER') then
    v_cols := array_append(v_cols, quote_ident('buyer_full_name'));
    v_vals := array_append(v_vals, quote_nullable(v_pre.buyer_full_name));
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'store_sales' and column_name = 'buyer_email' and is_generated = 'NEVER') then
    v_cols := array_append(v_cols, quote_ident('buyer_email'));
    v_vals := array_append(v_vals, quote_nullable(v_pre.buyer_email));
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'store_sales' and column_name = 'buyer_phone' and is_generated = 'NEVER') then
    v_cols := array_append(v_cols, quote_ident('buyer_phone'));
    v_vals := array_append(v_vals, quote_nullable(v_pre.buyer_phone));
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'store_sales' and column_name = 'product_id' and is_generated = 'NEVER') then
    v_cols := array_append(v_cols, quote_ident('product_id'));
    v_vals := array_append(v_vals, quote_nullable(v_pre.product_id));
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'store_sales' and column_name = 'product_name' and is_generated = 'NEVER') then
    v_cols := array_append(v_cols, quote_ident('product_name'));
    v_vals := array_append(v_vals, quote_nullable(v_pre.product_name));
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'store_sales' and column_name = 'product_category' and is_generated = 'NEVER') then
    v_cols := array_append(v_cols, quote_ident('product_category'));
    v_vals := array_append(v_vals, quote_nullable(v_pre.product_category));
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'store_sales' and column_name = 'product_color' and is_generated = 'NEVER') then
    v_cols := array_append(v_cols, quote_ident('product_color'));
    v_vals := array_append(v_vals, quote_nullable(v_pre.product_color));
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'store_sales' and column_name = 'product_size' and is_generated = 'NEVER') then
    v_cols := array_append(v_cols, quote_ident('product_size'));
    v_vals := array_append(v_vals, quote_nullable(v_pre.product_size));
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'store_sales' and column_name = 'qty' and is_generated = 'NEVER') then
    v_cols := array_append(v_cols, quote_ident('qty'));
    v_vals := array_append(v_vals, quote_nullable(v_pre.qty));
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'store_sales' and column_name = 'unit_price_cents' and is_generated = 'NEVER') then
    v_cols := array_append(v_cols, quote_ident('unit_price_cents'));
    v_vals := array_append(v_vals, quote_nullable(v_pre.unit_price_cents));
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'store_sales' and column_name = 'line_total_cents' and is_generated = 'NEVER') then
    v_cols := array_append(v_cols, quote_ident('line_total_cents'));
    v_vals := array_append(v_vals, quote_nullable(coalesce(v_pre.qty, 0) * coalesce(v_pre.unit_price_cents, 0)));
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'store_sales' and column_name = 'discount_cents' and is_generated = 'NEVER') then
    v_cols := array_append(v_cols, quote_ident('discount_cents'));
    v_vals := array_append(v_vals, '0');
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'store_sales' and column_name = 'total_cents' and is_generated = 'NEVER') then
    v_cols := array_append(v_cols, quote_ident('total_cents'));
    v_vals := array_append(v_vals, quote_nullable(v_pre.total_cents));
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'store_sales' and column_name = 'paid_cents' and is_generated = 'NEVER') then
    v_cols := array_append(v_cols, quote_ident('paid_cents'));
    v_vals := array_append(v_vals, quote_nullable(v_pre.total_cents));
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'store_sales' and column_name = 'payment_method' and is_generated = 'NEVER') then
    v_cols := array_append(v_cols, quote_ident('payment_method'));
    v_vals := array_append(v_vals, quote_nullable(_payment_method));
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'store_sales' and column_name = 'status' and is_generated = 'NEVER') then
    v_cols := array_append(v_cols, quote_ident('status'));
    v_vals := array_append(v_vals, quote_literal('delivered'));
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'store_sales' and column_name = 'purchase_date' and is_generated = 'NEVER') then
    v_cols := array_append(v_cols, quote_ident('purchase_date'));
    v_vals := array_append(v_vals, quote_nullable(v_today));
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'store_sales' and column_name = 'delivered_at' and is_generated = 'NEVER') then
    v_cols := array_append(v_cols, quote_ident('delivered_at'));
    v_vals := array_append(v_vals, quote_nullable(v_now));
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'store_sales' and column_name = 'stock_applied_at' and is_generated = 'NEVER') then
    v_cols := array_append(v_cols, quote_ident('stock_applied_at'));
    v_vals := array_append(v_vals, quote_nullable(v_now));
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'store_sales' and column_name = 'currency' and is_generated = 'NEVER') then
    v_cols := array_append(v_cols, quote_ident('currency'));
    v_vals := array_append(v_vals, quote_literal('EGP'));
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'store_sales' and column_name = 'note' and is_generated = 'NEVER') then
    v_cols := array_append(v_cols, quote_ident('note'));
    v_vals := array_append(v_vals, quote_nullable(v_note));
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'store_sales' and column_name = 'preorder_id' and is_generated = 'NEVER') then
    v_cols := array_append(v_cols, quote_ident('preorder_id'));
    v_vals := array_append(v_vals, quote_nullable(v_pre.id));
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'store_sales' and column_name = 'source_preorder_id' and is_generated = 'NEVER') then
    v_cols := array_append(v_cols, quote_ident('source_preorder_id'));
    v_vals := array_append(v_vals, quote_nullable(v_pre.id));
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'store_sales' and column_name = 'created_by' and is_generated = 'NEVER') then
    v_cols := array_append(v_cols, quote_ident('created_by'));
    v_vals := array_append(v_vals, quote_nullable(_actor_id));
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'store_sales' and column_name = 'updated_by' and is_generated = 'NEVER') then
    v_cols := array_append(v_cols, quote_ident('updated_by'));
    v_vals := array_append(v_vals, quote_nullable(_actor_id));
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'store_sales' and column_name = 'created_at' and is_generated = 'NEVER') then
    v_cols := array_append(v_cols, quote_ident('created_at'));
    v_vals := array_append(v_vals, quote_nullable(v_now));
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'store_sales' and column_name = 'updated_at' and is_generated = 'NEVER') then
    v_cols := array_append(v_cols, quote_ident('updated_at'));
    v_vals := array_append(v_vals, quote_nullable(v_now));
  end if;

  if array_length(v_cols, 1) is null then
    raise exception 'SALE_INSERT_FAILED';
  end if;

  v_sql := 'insert into public.store_sales (' || array_to_string(v_cols, ', ') || ') values (' || array_to_string(v_vals, ', ') || ') returning id';
  execute v_sql into v_sale_id;

  if v_sale_id is null then
    raise exception 'SALE_INSERT_FAILED';
  end if;

  update public.store_products
  set inventory_qty = coalesce(inventory_qty, 0) - coalesce(v_pre.qty, 0)
  where id = v_pre.product_id;

  update public.store_preorders
  set
    status = 'completed',
    deposit_cents = coalesce(v_pre.total_cents, 0),
    deposit_payment_method = coalesce(v_pre.deposit_payment_method, _payment_method),
    note = v_note,
    converted_sale_id = v_sale_id,
    updated_by = _actor_id,
    updated_at = v_now
  where id = v_pre.id;

  return jsonb_build_object(
    'ok', true,
    'preorder_id', v_pre.id,
    'sale_id', v_sale_id,
    'qty', v_pre.qty,
    'total_cents', v_pre.total_cents
  );
end;
$$;

grant execute on function public.admin_complete_store_preorder_as_sale(uuid, text, uuid) to service_role;
