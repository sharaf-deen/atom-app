-- ATOM Banking — Direct Store Sales & Small Income Reconciliation
-- Ledger-only linking; no edits to historic Store sales, payment batches or bank credits.
begin;

create table public.bank_direct_income_matches (
  id uuid primary key default gen_random_uuid(),
  bank_transaction_id uuid not null references public.bank_transactions(id) on delete restrict,
  source_kind text not null check (source_kind in ('store_sale','external_income')),
  source_id uuid not null,
  matched_amount numeric(14,2) not null check (matched_amount > 0),
  note text not null check (char_length(btrim(note)) between 15 and 500),
  matched_by uuid not null references public.profiles(user_id) on delete restrict,
  matched_at timestamptz not null default now(),
  released_at timestamptz,
  released_by uuid references public.profiles(user_id),
  release_reason text,
  constraint bank_direct_income_release_reason_check check (
    (released_at is null and released_by is null and release_reason is null)
    or (released_at is not null and released_by is not null and char_length(btrim(coalesce(release_reason,''))) between 10 and 500)
  )
);
create unique index bank_direct_income_active_credit_uidx
  on public.bank_direct_income_matches(bank_transaction_id) where released_at is null;
create unique index bank_direct_income_active_source_uidx
  on public.bank_direct_income_matches(source_kind,source_id) where released_at is null;
create index bank_direct_income_history_idx
  on public.bank_direct_income_matches(bank_transaction_id,matched_at desc);

alter table public.bank_direct_income_matches enable row level security;
revoke all on public.bank_direct_income_matches from public,anon,authenticated;
grant select,insert,update on public.bank_direct_income_matches to service_role;

create or replace function public.bank_direct_income_match_v1(
  p_bank_transaction_id uuid, p_mode text, p_source_id uuid,
  p_title text, p_source_key text, p_note text, p_actor uuid
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_tx public.bank_transactions%rowtype;
  v_sale public.store_sales%rowtype;
  v_income public.external_income_entries%rowtype;
  v_kind text;
  v_id uuid;
  v_amount numeric(14,2);
  v_date date;
  v_method text;
  v_match_id uuid;
begin
  if p_actor is null or not public.is_super_admin(p_actor) then
    raise exception 'SUPER_ADMIN_REQUIRED';
  end if;
  if p_mode not in ('store_sale','external_income','new_small_income') then
    raise exception 'INVALID_SOURCE_MODE';
  end if;
  if char_length(btrim(coalesce(p_note,''))) not between 15 and 500 then
    raise exception 'EVIDENCE_NOTE_REQUIRED';
  end if;
  -- Serialize against the existing payment-batch match ledger and concurrent direct writes.
  lock table public.bank_payment_matches in share row exclusive mode;
  lock table public.bank_direct_income_matches in share row exclusive mode;
  select * into v_tx from public.bank_transactions
    where id=p_bank_transaction_id for update;
  if not found or v_tx.direction <> 'credit' or v_tx.currency <> 'EGP'
    or v_tx.amount <= 0 then
    raise exception 'INVALID_BANK_CREDIT';
  end if;
  if exists (select 1 from public.bank_payment_matches m
      where m.bank_transaction_id=v_tx.id and m.released_at is null)
    or exists (select 1 from public.bank_direct_income_matches m
      where m.bank_transaction_id=v_tx.id and m.released_at is null) then
    raise exception 'BANK_CREDIT_ALREADY_MATCHED';
  end if;

  if p_mode='store_sale' then
    select * into v_sale from public.store_sales where id=p_source_id for update;
    if not found or v_sale.status not in ('paid','delivered')
       or v_sale.payment_method not in ('instapay','bank_transfer')
       or v_sale.paid_cents <= 0 then
      raise exception 'STORE_SALE_NOT_ELIGIBLE';
    end if;
    v_kind := 'store_sale';
    v_id := v_sale.id;
    v_amount := (v_sale.paid_cents::numeric/100)::numeric(14,2);
    v_date := v_sale.purchase_date;
    v_method := v_sale.payment_method;
  elsif p_mode='external_income' then
    select * into v_income from public.external_income_entries where id=p_source_id for update;
    if not found or v_income.payment_method not in ('instapay','bank_transfer') then
      raise exception 'EXTERNAL_INCOME_NOT_ELIGIBLE';
    end if;
    v_kind := 'external_income';
    v_id := v_income.id;
    v_amount := v_income.amount;
    v_date := v_income.entry_date;
    v_method := v_income.payment_method;
  else
    if v_tx.amount > 500 or v_tx.category_code not in ('other_income','store_income')
       or v_tx.classification_status <> 'confirmed'
       or char_length(btrim(coalesce(p_title,''))) not between 5 and 140
       or p_source_key not in ('bar','store','other')
       or (v_tx.category_code='store_income' and p_source_key <> 'store')
       or (v_tx.category_code='other_income' and p_source_key = 'store') then
      raise exception 'SMALL_INCOME_REQUIRES_CONFIRMED_CATEGORY_AND_TITLE';
    end if;
    v_kind := 'external_income';
    v_amount := v_tx.amount;
    v_date := v_tx.transaction_date;
    v_method := 'instapay';
    -- No revenue is fabricated in a mere match: this mode explicitly books an actual,
    -- already-received small sale following Super Admin evidence confirmation.
    insert into public.external_income_entries
      (entry_date,source_key,title,amount,payment_method,note,created_by,updated_by)
    values
      (v_date,p_source_key,
       btrim(p_title),v_amount,v_method,
       'Bank-origin small income '||coalesce(v_tx.reference,v_tx.id::text)||' · '||btrim(p_note),
       p_actor,p_actor)
    returning id into v_id;
  end if;

  if v_amount <> v_tx.amount or v_date is null
     or abs(v_date-v_tx.transaction_date)>14 then
    raise exception 'AMOUNT_OR_DATE_MISMATCH';
  end if;
  if exists (select 1 from public.bank_direct_income_matches m
      where m.source_kind=v_kind and m.source_id=v_id and m.released_at is null) then
    raise exception 'SOURCE_ALREADY_MATCHED';
  end if;
  if v_kind='external_income' and exists (
    select 1 from public.payment_validation_batch_items i
    join public.payment_validation_batches b on b.id=i.batch_id
    where i.source_kind='external_income' and i.source_id=v_id
      and i.released_at is null and b.deleted_at is null
      and b.superseded_by_batch_id is null
  ) then
    raise exception 'INCOME_ALREADY_VALIDATED_IN_BATCH';
  end if;
  insert into public.bank_direct_income_matches
    (bank_transaction_id,source_kind,source_id,matched_amount,note,matched_by)
  values (v_tx.id,v_kind,v_id,v_amount,btrim(p_note),p_actor)
  returning id into v_match_id;
  return v_match_id;
end;
$$;
revoke all on function public.bank_direct_income_match_v1(uuid,text,uuid,text,text,text,uuid)
  from public,anon,authenticated;
grant execute on function public.bank_direct_income_match_v1(uuid,text,uuid,text,text,uuid)
  to service_role;

create or replace function public.bank_direct_income_release_v1(
  p_match_id uuid,p_reason text,p_actor uuid
) returns uuid language plpgsql security definer set search_path=''
as $$
declare v_id uuid;
begin
  if p_actor is null or not public.is_super_admin(p_actor) then
    raise exception 'SUPER_ADMIN_REQUIRED';
  end if;
  if char_length(btrim(coalesce(p_reason,''))) not between 10 and 500 then
    raise exception 'RELEASE_REASON_REQUIRED';
  end if;
  update public.bank_direct_income_matches set
    released_at=now(),released_by=p_actor,release_reason=btrim(p_reason)
    where id=p_match_id and released_at is null returning id into v_id;
  if v_id is null then raise exception 'MATCH_NOT_ACTIVE'; end if;
  return v_id;
end;
$$;
revoke all on function public.bank_direct_income_release_v1(uuid,text,uuid)
  from public,anon,authenticated;
grant execute on function public.bank_direct_income_release_v1(uuid,text,uuid)
  to service_role;

-- Prevent later legacy payment-batch allocation of the same credit.
create or replace function public.bank_direct_income_guard_batch_v1()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  if new.released_at is null and exists (
    select 1 from public.bank_direct_income_matches d
    where d.bank_transaction_id=new.bank_transaction_id and d.released_at is null
  ) then
    raise exception 'BANK_CREDIT_ALREADY_DIRECT_MATCHED';
  end if;
  return new;
end;
$$;
drop trigger if exists bank_direct_income_batch_guard on public.bank_payment_matches;
create trigger bank_direct_income_batch_guard
  before insert or update of bank_transaction_id,released_at
  on public.bank_payment_matches for each row
  execute function public.bank_direct_income_guard_batch_v1();

commit;
