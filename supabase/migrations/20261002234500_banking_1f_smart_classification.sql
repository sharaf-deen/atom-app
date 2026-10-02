-- Banking 1F — Smart Recognition & Classification
-- Adds confidence, explainability, learning and CIB-aware rules on top of Banking 1B.

alter table public.bank_classification_rules
  add column if not exists confidence_score numeric(5,4) not null default 0.7500,
  add column if not exists amount_min numeric(14,2) null,
  add column if not exists amount_max numeric(14,2) null,
  add column if not exists rule_origin text not null default 'system',
  add column if not exists learned_from_transaction_id uuid null,
  add column if not exists use_count integer not null default 0,
  add column if not exists last_used_at timestamptz null;

alter table public.bank_classification_rules
  drop constraint if exists bank_classification_rules_confidence_chk;
alter table public.bank_classification_rules
  add constraint bank_classification_rules_confidence_chk
  check (confidence_score >= 0 and confidence_score <= 1);

alter table public.bank_classification_rules
  drop constraint if exists bank_classification_rules_amount_chk;
alter table public.bank_classification_rules
  add constraint bank_classification_rules_amount_chk
  check (
    (amount_min is null or amount_min >= 0)
    and (amount_max is null or amount_max >= 0)
    and (amount_min is null or amount_max is null or amount_min <= amount_max)
  );

alter table public.bank_classification_rules
  drop constraint if exists bank_classification_rules_origin_chk;
alter table public.bank_classification_rules
  add constraint bank_classification_rules_origin_chk
  check (rule_origin in ('system','cib_seed','manual_learning'));

create index if not exists bank_classification_rules_smart_idx
  on public.bank_classification_rules(is_active, direction_scope, confidence_score desc, priority asc);

alter table public.bank_transactions
  add column if not exists classification_confidence numeric(5,4) null,
  add column if not exists classification_reason text null,
  add column if not exists classification_rule_id uuid null
    references public.bank_classification_rules(id) on delete set null;

alter table public.bank_transactions
  drop constraint if exists bank_transactions_classification_confidence_chk;
alter table public.bank_transactions
  add constraint bank_transactions_classification_confidence_chk
  check (classification_confidence is null or (classification_confidence >= 0 and classification_confidence <= 1));

create index if not exists bank_transactions_classification_rule_idx
  on public.bank_transactions(classification_rule_id)
  where classification_rule_id is not null;

update public.bank_classification_rules
set confidence_score = case
  when category_code = 'bank_fees' then 0.9900
  when category_code = 'federation' then 0.9800
  when category_code = 'rent' then 0.9700
  when category_code = 'taxes' then 0.9000
  when category_code = 'utilities' then 0.8500
  else confidence_score
end
where rule_origin = 'system';

insert into public.bank_classification_rules
  (name, category_code, direction_scope, match_field, pattern, priority, confidence_score, amount_min, amount_max, rule_origin)
values
  ('CIB · Rent / BOLD Real Estate','rent','debit','description','BOLD\s*FOR\s*REAL\s*ESTATE|Rent\s*Elite\s*Mall|ATOM\s*Rent|Atom\s*rent|September\s*Rent',5,0.9950,null,null,'cib_seed'),
  ('CIB · Bank transfer and account fees','bank_fees','debit','description','Fund\s*Transfer\s*Charges|Outward\s*Swift\s*Charges|MONTHLY\s*FEES|Quarterly\s*Administration\s*Fees|Monthly\s*Statement\s*Quarterly\s*Fees',5,0.9950,null,null,'cib_seed'),
  ('CIB · Egyptian Jiu-Jitsu Federation','federation','debit','description','EGYPTIAN\s*JIU\s*JITSU\s*FEDERATION|EGYPTIAN\s*JIUJITSU\s*FEDERATION',5,0.9950,null,null,'cib_seed'),
  ('CIB · Membership refund','refunds','debit','description','Membership\s*refund|Partial\s*Refund\s*Membership',5,0.9950,null,null,'cib_seed'),
  ('CIB · Lawyer / legal expense','legal_accounting','debit','description','Lawyer\s*Expenses',5,0.9900,null,null,'cib_seed'),
  ('CIB · ATM cash deposit','internal_transfer','credit','description','ATM\s*DEPOSIT',8,0.9800,null,null,'cib_seed'),
  ('CIB · ATM Switch File Upload','internal_transfer','credit','description','ATM\s*Switch\s*File\s*Upload|Switch\s*File\s*Upload',8,0.9800,null,null,'cib_seed'),
  ('CIB · Capital release','owner_contribution','credit','description','راس\s*مال|افراج\s*عن\s*راس\s*مال',8,0.9600,null,null,'cib_seed'),
  ('CIB · Membership amount 2,200','membership_income','credit','description','IPN\s*Inward',30,0.9200,2200.00,2200.00,'cib_seed'),
  ('CIB · Membership amount 5,250','membership_income','credit','description','IPN\s*Inward',30,0.9200,5250.00,5250.00,'cib_seed'),
  ('CIB · Membership amount 8,100','membership_income','credit','description','IPN\s*Inward',30,0.9200,8100.00,8100.00,'cib_seed'),
  ('CIB · Membership amount 1,000','membership_income','credit','description','IPN\s*Inward',35,0.8200,1000.00,1000.00,'cib_seed')
on conflict do nothing;

comment on column public.bank_classification_rules.confidence_score is
  '0..1 confidence displayed to Super Admin; suggestions remain non-final until confirmed.';
comment on column public.bank_classification_rules.rule_origin is
  'system = Banking 1B, cib_seed = observed CIB statement pattern, manual_learning = learned from a Super Admin confirmation.';
comment on column public.bank_transactions.classification_reason is
  'Human-readable explanation for a suggested classification.';
