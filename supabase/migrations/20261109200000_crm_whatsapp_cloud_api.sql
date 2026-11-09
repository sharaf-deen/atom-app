-- WhatsApp Cloud API inbox / transactional human-approval outbox. No automatic campaigns.
begin;
create table if not exists public.crm_whatsapp_conversations (
 id uuid primary key default gen_random_uuid(),
 phone_number_id text not null,
 wa_id text not null check (wa_id ~ '^[0-9]{8,20}$'),
 display_name text,
 prospect_id uuid references public.prospects(id) on delete set null,
 last_inbound_at timestamptz,
 last_message_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(phone_number_id,wa_id)
);
create index if not exists crm_whatsapp_conv_recent_idx on public.crm_whatsapp_conversations(last_message_at desc);
create index if not exists crm_whatsapp_conv_prospect_idx on public.crm_whatsapp_conversations(prospect_id);

create table if not exists public.crm_whatsapp_messages (
 id uuid primary key default gen_random_uuid(),
 conversation_id uuid not null references public.crm_whatsapp_conversations(id) on delete restrict,
 provider_message_id text unique,
 client_request_id uuid unique,
 direction text not null check(direction in ('inbound','outbound')),
 message_type text not null default 'text',
 body text not null default '' check(length(body)<=4096),
 status text not null check(status in ('received','queued','sending','sent','delivered','read','failed')),
 error_code text,
 sent_by uuid references auth.users(id),
 occurred_at timestamptz not null default now(),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check ((direction='inbound' and status='received') or (direction='outbound' and status<>'received')),
 check (direction='inbound' or client_request_id is not null)
);
create index if not exists crm_wa_msg_conversation_idx on public.crm_whatsapp_messages(conversation_id,occurred_at,id);
alter table public.crm_whatsapp_conversations enable row level security;
alter table public.crm_whatsapp_messages enable row level security;
revoke all on public.crm_whatsapp_conversations from anon,authenticated;
revoke all on public.crm_whatsapp_messages from anon,authenticated;
-- The service role is used by signed webhooks and authenticated server routes only.
commit;