-- Member Consent 1A — Registration Consent & Legal Acceptance
-- Privacy Policy + Terms of Use are active/required.
-- Liability Waiver v1.0 is seeded as DRAFT and is NOT required until legal approval.

begin;

create table if not exists public.legal_document_versions (
  id uuid primary key default gen_random_uuid(),
  document_key text not null,
  title text not null,
  version_label text not null,
  primary_language text not null default 'en',
  published_url text not null,
  status text not null default 'draft',
  is_required boolean not null default false,
  effective_from timestamptz null,
  content_hash text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint legal_document_versions_key_check
    check (document_key in ('privacy_policy','terms_of_use','liability_waiver')),
  constraint legal_document_versions_status_check
    check (status in ('draft','active','retired')),
  constraint legal_document_versions_title_check
    check (char_length(btrim(title)) between 3 and 200),
  constraint legal_document_versions_version_check
    check (char_length(btrim(version_label)) between 1 and 40),
  constraint legal_document_versions_url_check
    check (published_url ~ '^https://'),
  unique (document_key, version_label)
);

create unique index if not exists legal_document_versions_one_active_per_key_idx
  on public.legal_document_versions (document_key)
  where status = 'active';

create index if not exists legal_document_versions_status_idx
  on public.legal_document_versions (status, is_required, document_key);

create table if not exists public.member_legal_acceptances (
  id uuid primary key default gen_random_uuid(),
  member_user_id uuid not null,
  document_version_id uuid not null references public.legal_document_versions(id) on delete restrict,
  document_key_snapshot text not null,
  document_title_snapshot text not null,
  document_version_snapshot text not null,
  document_url_snapshot text not null,
  accepted_at timestamptz not null default now(),
  acceptor_name text not null,
  acceptor_capacity text not null,
  guardian_relationship text null,
  member_date_of_birth_snapshot date not null,
  is_minor_snapshot boolean not null,
  recorded_by_user_id uuid not null,
  source text not null,
  ip_address text null,
  user_agent text null,
  created_at timestamptz not null default now(),
  constraint member_legal_acceptances_capacity_check
    check (acceptor_capacity in ('participant','parent','legal_guardian')),
  constraint member_legal_acceptances_source_check
    check (source in (
      'member_registration',
      'visitor_conversion',
      'prospect_conversion',
      'family_intake',
      'profile_reaccept',
      'manual_backfill'
    )),
  constraint member_legal_acceptances_acceptor_check
    check (char_length(btrim(acceptor_name)) between 2 and 200),
  unique (member_user_id, document_version_id)
);

create index if not exists member_legal_acceptances_member_idx
  on public.member_legal_acceptances (member_user_id, accepted_at desc);

create index if not exists member_legal_acceptances_document_idx
  on public.member_legal_acceptances (document_version_id, accepted_at desc);

alter table public.legal_document_versions enable row level security;
alter table public.member_legal_acceptances enable row level security;

grant select on public.legal_document_versions to authenticated;
grant select on public.member_legal_acceptances to authenticated;

revoke insert, update, delete on public.legal_document_versions from authenticated;
revoke insert, update, delete on public.member_legal_acceptances from authenticated;

drop policy if exists legal_document_versions_read_active on public.legal_document_versions;
create policy legal_document_versions_read_active
on public.legal_document_versions
for select to authenticated
using (status = 'active');

drop policy if exists member_legal_acceptances_read_own_or_staff on public.member_legal_acceptances;
create policy member_legal_acceptances_read_own_or_staff
on public.member_legal_acceptances
for select to authenticated
using (
  member_user_id = auth.uid()
  or exists (
    select 1
    from public.profiles me
    where me.user_id = auth.uid()
      and me.role::text in ('reception','admin','super_admin','head_coach')
  )
);

insert into public.legal_document_versions
  (document_key, title, version_label, primary_language, published_url, status, is_required, effective_from)
values
  (
    'privacy_policy',
    'ATOM Privacy Policy',
    '1.0',
    'en',
    'https://atomjiujitsuhq.com/privacy-policy/',
    'active',
    true,
    '2026-08-27T00:00:00+03:00'
  ),
  (
    'terms_of_use',
    'ATOM Terms of Use',
    '1.0',
    'en',
    'https://atomjiujitsuhq.com/terms-of-use/',
    'active',
    true,
    '2026-09-30T00:00:00+03:00'
  ),
  (
    'liability_waiver',
    'ATOM Liability Waiver & Assumption of Risk Agreement',
    '1.0',
    'en',
    'https://atomjiujitsuhq.com/liability-waiver-assumption-of-risk/',
    'draft',
    false,
    null
  )
on conflict (document_key, version_label) do update
set title = excluded.title,
    primary_language = excluded.primary_language,
    published_url = excluded.published_url,
    status = excluded.status,
    is_required = excluded.is_required,
    effective_from = excluded.effective_from,
    updated_at = now();

create or replace function public.record_member_legal_acceptances_v1(
  p_member_user_id uuid,
  p_document_version_ids uuid[],
  p_acceptor_name text,
  p_acceptor_capacity text,
  p_guardian_relationship text,
  p_recorded_by_user_id uuid,
  p_source text,
  p_user_agent text default null,
  p_ip_address text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dob date;
  v_today date := (now() at time zone 'Africa/Cairo')::date;
  v_is_minor boolean;
  v_age integer;
  v_required_count integer;
  v_accepted_required_count integer;
  v_inserted integer := 0;
begin
  select p.date_of_birth
  into v_dob
  from public.profiles p
  where p.user_id = p_member_user_id;

  if v_dob is null then
    raise exception 'LEGAL_CONSENT_DATE_OF_BIRTH_REQUIRED';
  end if;

  v_age := extract(year from age(v_today, v_dob))::integer;
  v_is_minor := v_age < 18;

  if nullif(btrim(coalesce(p_acceptor_name, '')), '') is null then
    raise exception 'LEGAL_CONSENT_ACCEPTOR_NAME_REQUIRED';
  end if;

  if v_is_minor then
    if p_acceptor_capacity is null or p_acceptor_capacity not in ('parent','legal_guardian') then
      raise exception 'LEGAL_CONSENT_GUARDIAN_REQUIRED';
    end if;
    if nullif(btrim(coalesce(p_guardian_relationship, '')), '') is null then
      raise exception 'LEGAL_CONSENT_GUARDIAN_RELATIONSHIP_REQUIRED';
    end if;
  else
    if p_acceptor_capacity is null or p_acceptor_capacity <> 'participant' then
      raise exception 'LEGAL_CONSENT_PARTICIPANT_REQUIRED';
    end if;
  end if;

  if p_source not in (
    'member_registration',
    'visitor_conversion',
    'prospect_conversion',
    'family_intake',
    'profile_reaccept',
    'manual_backfill'
  ) then
    raise exception 'LEGAL_CONSENT_INVALID_SOURCE';
  end if;

  select count(*)
  into v_required_count
  from public.legal_document_versions d
  where d.status = 'active'
    and d.is_required = true;

  select count(*)
  into v_accepted_required_count
  from public.legal_document_versions d
  where d.status = 'active'
    and d.is_required = true
    and d.id = any(coalesce(p_document_version_ids, array[]::uuid[]));

  if v_required_count <> v_accepted_required_count then
    raise exception 'LEGAL_CONSENT_REQUIRED_DOCUMENTS_MISSING';
  end if;

  insert into public.member_legal_acceptances (
    member_user_id,
    document_version_id,
    document_key_snapshot,
    document_title_snapshot,
    document_version_snapshot,
    document_url_snapshot,
    accepted_at,
    acceptor_name,
    acceptor_capacity,
    guardian_relationship,
    member_date_of_birth_snapshot,
    is_minor_snapshot,
    recorded_by_user_id,
    source,
    ip_address,
    user_agent
  )
  select
    p_member_user_id,
    d.id,
    d.document_key,
    d.title,
    d.version_label,
    d.published_url,
    now(),
    btrim(p_acceptor_name),
    p_acceptor_capacity,
    case when v_is_minor then nullif(btrim(coalesce(p_guardian_relationship, '')), '') else null end,
    v_dob,
    v_is_minor,
    p_recorded_by_user_id,
    p_source,
    nullif(btrim(coalesce(p_ip_address, '')), ''),
    nullif(btrim(coalesce(p_user_agent, '')), '')
  from public.legal_document_versions d
  where d.status = 'active'
    and d.id = any(coalesce(p_document_version_ids, array[]::uuid[]))
  on conflict (member_user_id, document_version_id) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

revoke all on function public.record_member_legal_acceptances_v1(
  uuid, uuid[], text, text, text, uuid, text, text, text
) from public, anon, authenticated;

grant execute on function public.record_member_legal_acceptances_v1(
  uuid, uuid[], text, text, text, uuid, text, text, text
) to service_role;

comment on table public.legal_document_versions is
  'Versioned legal documents used by ATOM registration and consent workflows.';

comment on table public.member_legal_acceptances is
  'Immutable evidence of member/guardian acceptance of a specific legal document version.';

commit;
