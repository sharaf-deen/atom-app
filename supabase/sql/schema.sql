-- Enable necessary extensions
create extension if not exists "uuid-ossp";
create extension if not exists pgcrypto;

-- PROFILES (linked to auth.users)
create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text unique,
  name text,
  role text not null default 'member' check (role in ('admin','coach','assistant_coach','member')),
  qr_code text unique not null default encode(gen_random_bytes(12), 'hex'),
  created_at timestamptz not null default now()
);

-- keep email in sync from auth.users
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (user_id, email, name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'name', ''));
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- SUBSCRIPTIONS
create table if not exists public.subscriptions (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  subscription_type text not null check (subscription_type in ('monthly','quarterly','yearly','pay_per_class')),
  remaining_days int,
  remaining_classes int,
  expiry_date date,
  start_date date not null default current_date,
  end_date date,
  status text not null default 'active' check (status in ('active','expired','suspended')),
  created_at timestamptz not null default now()
);

-- Auto-calc 45-day expiry for pay_per_class if not provided
create or replace function public.set_dropin_expiry()
returns trigger as $$
begin
  if new.subscription_type = 'pay_per_class' and new.expiry_date is null then
    new.expiry_date := (new.start_date + interval '45 days')::date;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_set_dropin_expiry on public.subscriptions;
create trigger trg_set_dropin_expiry
before insert or update on public.subscriptions
for each row execute function public.set_dropin_expiry();

-- Update remaining_days for standard subscriptions if end_date is provided
create or replace function public.compute_remaining_days()
returns trigger as $$
begin
  if new.subscription_type <> 'pay_per_class' and new.end_date is not null then
    new.remaining_days := greatest(0, (new.end_date - current_date));
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_compute_remaining_days on public.subscriptions;
create trigger trg_compute_remaining_days
before insert or update on public.subscriptions
for each row execute function public.compute_remaining_days();

-- ATTENDANCE
create table if not exists public.attendance (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.profiles(user_id) on delete set null,
  scanned_at timestamptz not null default now(),
  result text not null check (result in ('allowed','denied')),
  reason text
);

-- EQUIPMENT RESERVATIONS
create table if not exists public.equipment_reservations (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  item_name text not null,
  advance_paid numeric(10,2) not null,
  reservation_date timestamptz not null default now(),
  status text not null default 'reserved' check (status in ('reserved','collected','cancelled'))
);

-- NOTIFICATIONS
create table if not exists public.notifications (
  id uuid primary key default uuid_generate_v4(),
  title text not null,
  message text not null,
  created_at timestamptz not null default now(),
  audience text not null check (audience in ('all','members','coaches','assistant_coaches','admins'))
);

-- RLS
alter table public.profiles enable row level security;
alter table public.subscriptions enable row level security;
alter table public.attendance enable row level security;
alter table public.equipment_reservations enable row level security;
alter table public.notifications enable row level security;

-- Helper: is_admin()
create or replace function public.is_admin(uid uuid)
returns boolean as $$
  select exists (
    select 1 from public.profiles p
    where p.user_id = uid and p.role = 'admin'
  );
$$ language sql stable;

-- Profiles policies
create policy "profiles_select_own" on public.profiles
for select using (auth.uid() = user_id);
create policy "profiles_update_own_name" on public.profiles
for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "profiles_admin_all" on public.profiles
for all using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- Subscriptions policies
create policy "subs_select_own" on public.subscriptions
for select using (auth.uid() = user_id);
create policy "subs_insert_own" on public.subscriptions
for insert with check (auth.uid() = user_id or public.is_admin(auth.uid()));
create policy "subs_admin_all" on public.subscriptions
for all using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- Attendance policies
create policy "attendance_select_own" on public.attendance
for select using (auth.uid() = user_id);
create policy "attendance_insert_own" on public.attendance
for insert with check (auth.uid() = user_id or public.is_admin(auth.uid()));
create policy "attendance_admin_all" on public.attendance
for all using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- Equipment reservations policies
create policy "equip_select_own" on public.equipment_reservations
for select using (auth.uid() = user_id);
create policy "equip_insert_own" on public.equipment_reservations
for insert with check (auth.uid() = user_id or public.is_admin(auth.uid()));
create policy "equip_admin_all" on public.equipment_reservations
for all using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- Notifications policies
create policy "notif_select_all" on public.notifications
for select using (true);
create policy "notif_admin_manage" on public.notifications
for all using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- Function used by the scanner to validate access and record attendance
create or replace function public.scan_and_record(qr text)
returns table(allowed boolean, reason text) as $$
declare
  u record;
  sub record;
begin
  -- Find user by qr_code
  select * into u from public.profiles where qr_code = qr limit 1;
  if u is null then
    insert into public.attendance(user_id, result, reason) values (null, 'denied', 'QR not found');
    return query select false as allowed, 'QR not found'::text;
  end if;

  -- Find their most recent active subscription
  select * into sub from public.subscriptions
   where user_id = u.user_id and status = 'active'
   order by created_at desc limit 1;

  if sub is null then
    insert into public.attendance(user_id, result, reason) values (u.user_id, 'denied', 'No active subscription');
    return query select false, 'No active subscription';
  end if;

  if sub.subscription_type = 'pay_per_class' then
    if sub.remaining_classes is null or sub.remaining_classes <= 0 then
      insert into public.attendance(user_id, result, reason) values (u.user_id, 'denied', 'No classes left');
      return query select false, 'No classes left';
    end if;
    if sub.expiry_date is not null and sub.expiry_date < current_date then
      insert into public.attendance(user_id, result, reason) values (u.user_id, 'denied', 'Drop-in expired');
      return query select false, 'Drop-in expired';
    end if;
    -- decrement one class
    update public.subscriptions
      set remaining_classes = remaining_classes - 1
      where id = sub.id;
    insert into public.attendance(user_id, result, reason) values (u.user_id, 'allowed', 'drop-in');
    return query select true, 'drop-in';
  else
    if sub.end_date is not null and sub.end_date < current_date then
      insert into public.attendance(user_id, result, reason) values (u.user_id, 'denied', 'Subscription expired');
      return query select false, 'Subscription expired';
    end if;
    insert into public.attendance(user_id, result, reason) values (u.user_id, 'allowed', 'subscription');
    return query select true, 'subscription';
  end if;
end;
$$ language plpgsql security definer;