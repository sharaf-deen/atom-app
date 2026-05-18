begin;

create table if not exists public.private_coaching_requests (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles(user_id) on delete cascade,
  coach_id uuid not null references public.profiles(user_id) on delete restrict,
  package_sessions integer not null check (package_sessions in (1, 5, 10)),
  amount_cents integer not null check (amount_cents > 0),
  currency text not null default 'EGP' check (currency = 'EGP'),
  payment_method text not null check (payment_method in ('cash', 'instapay')),
  status text not null default 'payment_pending' check (status in ('payment_pending', 'active', 'cancelled')),
  confirmed_at timestamptz null,
  confirmed_by uuid null references public.profiles(user_id) on delete set null,
  cancelled_at timestamptz null,
  cancelled_by uuid null references public.profiles(user_id) on delete set null,
  note text null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  created_by uuid null references public.profiles(user_id) on delete set null,
  updated_by uuid null references public.profiles(user_id) on delete set null,
  constraint private_coaching_requests_package_amount_check check (
    (package_sessions = 1 and amount_cents = 150000)
    or (package_sessions = 5 and amount_cents = 650000)
    or (package_sessions = 10 and amount_cents = 1100000)
  ),
  constraint private_coaching_requests_confirmed_when_active_check check (
    status <> 'active' or (confirmed_at is not null and confirmed_by is not null)
  )
);

create table if not exists public.private_coaching_passes (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique references public.private_coaching_requests(id) on delete cascade,
  member_id uuid not null references public.profiles(user_id) on delete cascade,
  coach_id uuid not null references public.profiles(user_id) on delete restrict,
  total_sessions integer not null check (total_sessions in (1, 5, 10)),
  used_sessions integer not null default 0 check (used_sessions >= 0),
  remaining_sessions integer generated always as (greatest(total_sessions - used_sessions, 0)) stored,
  status text not null default 'active' check (status in ('active', 'depleted', 'cancelled')),
  activated_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  created_by uuid null references public.profiles(user_id) on delete set null,
  updated_by uuid null references public.profiles(user_id) on delete set null,
  constraint private_coaching_passes_used_sessions_lte_total_check check (used_sessions <= total_sessions)
);

create index if not exists idx_private_coaching_requests_member_created_at
  on public.private_coaching_requests(member_id, created_at desc);

create index if not exists idx_private_coaching_requests_coach_status_created_at
  on public.private_coaching_requests(coach_id, status, created_at desc);

create index if not exists idx_private_coaching_requests_status_created_at
  on public.private_coaching_requests(status, created_at desc);

create index if not exists idx_private_coaching_passes_member_status_created_at
  on public.private_coaching_passes(member_id, status, created_at desc);

create index if not exists idx_private_coaching_passes_coach_status_created_at
  on public.private_coaching_passes(coach_id, status, created_at desc);

drop trigger if exists trg_private_coaching_requests_updated_at on public.private_coaching_requests;
create trigger trg_private_coaching_requests_updated_at
before update on public.private_coaching_requests
for each row execute function public.set_updated_at();

drop trigger if exists trg_private_coaching_passes_updated_at on public.private_coaching_passes;
create trigger trg_private_coaching_passes_updated_at
before update on public.private_coaching_passes
for each row execute function public.set_updated_at();

alter table public.private_coaching_requests enable row level security;
alter table public.private_coaching_passes enable row level security;

drop policy if exists private_coaching_requests_member_select_own on public.private_coaching_requests;
create policy private_coaching_requests_member_select_own
on public.private_coaching_requests
for select
to authenticated
using (member_id = auth.uid());

drop policy if exists private_coaching_requests_member_insert_own on public.private_coaching_requests;
create policy private_coaching_requests_member_insert_own
on public.private_coaching_requests
for insert
to authenticated
with check (
  member_id = auth.uid()
  and created_by = auth.uid()
  and status = 'payment_pending'
  and confirmed_at is null
  and confirmed_by is null
  and cancelled_at is null
  and cancelled_by is null
);

drop policy if exists private_coaching_requests_coach_select on public.private_coaching_requests;
create policy private_coaching_requests_coach_select
on public.private_coaching_requests
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.user_id = auth.uid()
      and (
        p.role = 'super_admin'
        or (p.role = 'head_coach' and private_coaching_requests.coach_id = auth.uid())
      )
  )
);

drop policy if exists private_coaching_requests_super_admin_all on public.private_coaching_requests;
create policy private_coaching_requests_super_admin_all
on public.private_coaching_requests
for all
to authenticated
using (public.is_super_admin(auth.uid()))
with check (public.is_super_admin(auth.uid()));

drop policy if exists private_coaching_passes_member_select_own on public.private_coaching_passes;
create policy private_coaching_passes_member_select_own
on public.private_coaching_passes
for select
to authenticated
using (member_id = auth.uid());

drop policy if exists private_coaching_passes_coach_select on public.private_coaching_passes;
create policy private_coaching_passes_coach_select
on public.private_coaching_passes
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.user_id = auth.uid()
      and (
        p.role = 'super_admin'
        or (p.role = 'head_coach' and private_coaching_passes.coach_id = auth.uid())
      )
  )
);

drop policy if exists private_coaching_passes_super_admin_all on public.private_coaching_passes;
create policy private_coaching_passes_super_admin_all
on public.private_coaching_passes
for all
to authenticated
using (public.is_super_admin(auth.uid()))
with check (public.is_super_admin(auth.uid()));

create or replace function public.private_coaching_confirm_payment(
  p_request_id uuid,
  p_actor_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_role text;
  v_request public.private_coaching_requests%rowtype;
  v_pass_id uuid;
begin
  select role into v_actor_role
  from public.profiles
  where user_id = p_actor_id;

  if coalesce(v_actor_role, '') not in ('head_coach', 'super_admin') then
    raise exception 'PRIVATE_COACHING_FORBIDDEN';
  end if;

  select * into v_request
  from public.private_coaching_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'PRIVATE_COACHING_REQUEST_NOT_FOUND';
  end if;

  if v_actor_role = 'head_coach' and v_request.coach_id <> p_actor_id then
    raise exception 'PRIVATE_COACHING_FORBIDDEN';
  end if;

  if v_request.status <> 'payment_pending' then
    select id into v_pass_id
    from public.private_coaching_passes
    where request_id = p_request_id;

    if v_pass_id is null then
      raise exception 'PRIVATE_COACHING_REQUEST_NOT_PENDING';
    end if;

    return v_pass_id;
  end if;

  update public.private_coaching_requests
  set status = 'active',
      confirmed_at = timezone('utc', now()),
      confirmed_by = p_actor_id,
      updated_by = p_actor_id
  where id = p_request_id;

  insert into public.private_coaching_passes (
    request_id,
    member_id,
    coach_id,
    total_sessions,
    used_sessions,
    status,
    created_by,
    updated_by
  ) values (
    v_request.id,
    v_request.member_id,
    v_request.coach_id,
    v_request.package_sessions,
    0,
    'active',
    p_actor_id,
    p_actor_id
  )
  on conflict (request_id) do update
    set status = 'active',
        updated_by = p_actor_id
  returning id into v_pass_id;

  return v_pass_id;
end;
$$;

revoke all on function public.private_coaching_confirm_payment(uuid, uuid) from public;
grant execute on function public.private_coaching_confirm_payment(uuid, uuid) to service_role;

revoke all on table public.private_coaching_requests from anon, authenticated;
revoke all on table public.private_coaching_passes from anon, authenticated;

grant select, insert, update, delete on table public.private_coaching_requests to authenticated;
grant select, insert, update, delete on table public.private_coaching_passes to authenticated;

grant select, insert, update, delete on table public.private_coaching_requests to service_role;
grant select, insert, update, delete on table public.private_coaching_passes to service_role;

commit;
