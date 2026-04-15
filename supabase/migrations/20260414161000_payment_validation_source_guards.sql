begin;

create or replace view public.payment_validation_active_source_locks_v1 as
select
  i.source_kind,
  i.source_id,
  i.batch_id,
  b.payment_method,
  b.validation_mode,
  b.business_date,
  b.validated_at,
  b.validated_by
from public.payment_validation_batch_items i
join public.payment_validation_batches b
  on b.id = i.batch_id
where i.released_at is null
  and b.deleted_at is null;

grant select on public.payment_validation_active_source_locks_v1 to authenticated, service_role;

create or replace function public.is_payment_validation_source_locked_v1(
  p_source_kind text,
  p_source_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.payment_validation_active_source_locks_v1 l
    where l.source_kind = lower(trim(coalesce(p_source_kind, '')))
      and l.source_id = p_source_id
  );
$$;

grant execute on function public.is_payment_validation_source_locked_v1(text, uuid)
  to authenticated, service_role;

commit;
