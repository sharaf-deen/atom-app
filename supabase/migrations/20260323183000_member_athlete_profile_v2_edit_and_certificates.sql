begin;

alter table public.member_belt_promotions
  add column if not exists certificate_filename text,
  add column if not exists certificate_mime text,
  add column if not exists certificate_size_bytes bigint;

insert into storage.buckets (id, name, public)
values ('belt-certificates', 'belt-certificates', false)
on conflict (id) do nothing;

commit;
