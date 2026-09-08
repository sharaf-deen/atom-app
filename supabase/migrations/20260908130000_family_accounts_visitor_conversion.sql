-- Family Accounts 2B — Visitor -> Family Member Conversion
-- Converts a Family Intake child Visitor into a family-managed Member without
-- creating a child Auth account or deleting the original Visitor/trial history.

begin;

alter table public.visitor_trials
  add column if not exists family_converted_at timestamptz null;

alter table public.visitor_trials
  add column if not exists family_converted_by uuid null references public.profiles(user_id) on delete set null;

alter table public.family_intake_children
  add column if not exists converted_at timestamptz null;

alter table public.family_intake_children
  add column if not exists converted_by uuid null references public.profiles(user_id) on delete set null;

create index if not exists visitor_trials_family_converted_at_idx
  on public.visitor_trials(family_converted_at desc)
  where family_converted_at is not null;

alter table public.family_intake_children
  drop constraint if exists family_intake_children_kind_chk;

alter table public.family_intake_children
  add constraint family_intake_children_kind_chk
  check (child_kind in ('visitor', 'member', 'existing_visitor', 'existing_member', 'converted_member')) not valid;

alter table public.family_intake_children
  validate constraint family_intake_children_kind_chk;

alter table public.family_intake_children
  drop constraint if exists family_intake_children_target_chk;

alter table public.family_intake_children
  add constraint family_intake_children_target_chk
  check (
    (
      child_kind in ('visitor', 'existing_visitor')
      and visitor_trial_id is not null
      and member_id is null
    )
    or
    (
      child_kind in ('member', 'existing_member')
      and member_id is not null
      and visitor_trial_id is null
    )
    or
    (
      child_kind = 'converted_member'
      and visitor_trial_id is not null
      and member_id is not null
    )
  ) not valid;

alter table public.family_intake_children
  validate constraint family_intake_children_target_chk;

create or replace function public.family_convert_visitor_to_member(
  p_visitor_trial_id uuid,
  p_family_id uuid,
  p_guardian_auth_user_id uuid,
  p_guardian_email text default null,
  p_actor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_visitor public.visitor_trials%rowtype;
  v_intake public.family_intakes%rowtype;
  v_child public.family_intake_children%rowtype;
  v_existing_family_id uuid;
  v_member public.profiles%rowtype;
  v_member_user_id uuid;
  v_has_pending_visitor boolean;
begin
  if p_visitor_trial_id is null or p_family_id is null then
    raise exception 'INVALID_ID';
  end if;

  if not exists (
    select 1
    from public.families f
    where f.id = p_family_id
  ) then
    raise exception 'FAMILY_NOT_FOUND';
  end if;

  select vt.*
  into v_visitor
  from public.visitor_trials vt
  where vt.id = p_visitor_trial_id
  for update;

  if not found then
    raise exception 'VISITOR_NOT_FOUND';
  end if;

  if v_visitor.family_intake_id is null then
    raise exception 'VISITOR_NOT_IN_FAMILY_INTAKE';
  end if;

  select fi.*
  into v_intake
  from public.family_intakes fi
  where fi.id = v_visitor.family_intake_id
  for update;

  if not found then
    raise exception 'FAMILY_INTAKE_NOT_FOUND';
  end if;

  if v_intake.family_id is not null and v_intake.family_id <> p_family_id then
    raise exception 'FAMILY_INTAKE_ALREADY_LINKED_TO_ANOTHER_FAMILY';
  end if;

  select fic.*
  into v_child
  from public.family_intake_children fic
  where fic.intake_id = v_intake.id
    and fic.visitor_trial_id = v_visitor.id
  for update;

  if not found then
    raise exception 'FAMILY_INTAKE_CHILD_NOT_FOUND';
  end if;

  if v_visitor.linked_member_id is not null then
    select fm.family_id
    into v_existing_family_id
    from public.family_members fm
    where fm.member_id = v_visitor.linked_member_id;

    if v_existing_family_id = p_family_id then
      select p.*
      into v_member
      from public.profiles p
      where p.user_id = v_visitor.linked_member_id;

      return jsonb_build_object(
        'already_converted', true,
        'member_user_id', v_member.user_id,
        'member_id', v_member.member_id,
        'family_id', p_family_id,
        'visitor_trial_id', v_visitor.id
      );
    end if;

    raise exception 'VISITOR_ALREADY_LINKED_TO_MEMBER';
  end if;

  if v_child.member_id is not null then
    select fm.family_id
    into v_existing_family_id
    from public.family_members fm
    where fm.member_id = v_child.member_id;

    if v_existing_family_id = p_family_id then
      select p.*
      into v_member
      from public.profiles p
      where p.user_id = v_child.member_id;

      return jsonb_build_object(
        'already_converted', true,
        'member_user_id', v_member.user_id,
        'member_id', v_member.member_id,
        'family_id', p_family_id,
        'visitor_trial_id', v_visitor.id
      );
    end if;

    raise exception 'INTAKE_CHILD_CONVERSION_CONFLICT';
  end if;

  v_member_user_id := gen_random_uuid();

  insert into public.profiles (
    user_id,
    email,
    first_name,
    last_name,
    phone,
    date_of_birth,
    role,
    qr_code
  )
  values (
    v_member_user_id,
    null,
    v_visitor.first_name,
    v_visitor.last_name,
    v_visitor.phone,
    v_visitor.date_of_birth,
    'member',
    'atom:' || v_member_user_id::text
  )
  returning *
  into v_member;

  insert into public.family_members (
    family_id,
    member_id,
    added_by
  )
  values (
    p_family_id,
    v_member.user_id,
    p_actor_id
  );

  update public.visitor_trials
  set
    linked_member_id = v_member.user_id,
    family_converted_at = now(),
    family_converted_by = p_actor_id,
    updated_by = p_actor_id
  where id = v_visitor.id;

  update public.family_intake_children
  set
    child_kind = 'converted_member',
    member_id = v_member.user_id,
    converted_at = now(),
    converted_by = p_actor_id
  where id = v_child.id;

  select exists (
    select 1
    from public.family_intake_children fic
    where fic.intake_id = v_intake.id
      and fic.member_id is null
      and fic.child_kind in ('visitor', 'existing_visitor')
  )
  into v_has_pending_visitor;

  update public.family_intakes
  set
    family_id = p_family_id,
    guardian_auth_user_id = coalesce(p_guardian_auth_user_id, guardian_auth_user_id),
    guardian_email = coalesce(nullif(lower(btrim(p_guardian_email)), ''), guardian_email),
    status = case when v_has_pending_visitor then 'family_created' else 'completed' end,
    updated_by = p_actor_id
  where id = v_intake.id;

  return jsonb_build_object(
    'already_converted', false,
    'member_user_id', v_member.user_id,
    'member_id', v_member.member_id,
    'family_id', p_family_id,
    'visitor_trial_id', v_visitor.id,
    'intake_id', v_intake.id,
    'trial_history_preserved', true,
    'child_auth_created', false
  );
end;
$$;

revoke all on function public.family_convert_visitor_to_member(uuid, uuid, uuid, text, uuid) from public;
revoke all on function public.family_convert_visitor_to_member(uuid, uuid, uuid, text, uuid) from anon;
revoke all on function public.family_convert_visitor_to_member(uuid, uuid, uuid, text, uuid) from authenticated;
grant execute on function public.family_convert_visitor_to_member(uuid, uuid, uuid, text, uuid) to service_role;

commit;
