-- Create Storage buckets required by the app + RLS policies for client uploads.
-- Buckets:
--   - id-photos  (client upload + signed URL)
--   - invoices   (server generated PDFs)

do $$
begin
  -- Buckets
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public)
    values ('id-photos', 'id-photos', false)
    on conflict (id) do nothing;

    insert into storage.buckets (id, name, public)
    values ('invoices', 'invoices', false)
    on conflict (id) do nothing;
  end if;
end $$;

-- Policies for id-photos bucket:
-- The app stores files as: <userId>/id-photo.<ext>
-- Users can read/write/delete only inside their own folder.
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'objects') then
    -- SELECT (needed for createSignedUrl)
    if not exists (
      select 1 from pg_policies
      where schemaname = 'storage'
        and tablename = 'objects'
        and policyname = 'id-photos_select_own'
    ) then
      create policy "id-photos_select_own"
      on storage.objects
      for select
      to authenticated
      using (
        bucket_id = 'id-photos'
        and split_part(name, '/', 1) = auth.uid()::text
      );
    end if;

    -- INSERT (upload)
    if not exists (
      select 1 from pg_policies
      where schemaname = 'storage'
        and tablename = 'objects'
        and policyname = 'id-photos_insert_own'
    ) then
      create policy "id-photos_insert_own"
      on storage.objects
      for insert
      to authenticated
      with check (
        bucket_id = 'id-photos'
        and split_part(name, '/', 1) = auth.uid()::text
      );
    end if;

    -- UPDATE (upsert overwrite)
    if not exists (
      select 1 from pg_policies
      where schemaname = 'storage'
        and tablename = 'objects'
        and policyname = 'id-photos_update_own'
    ) then
      create policy "id-photos_update_own"
      on storage.objects
      for update
      to authenticated
      using (
        bucket_id = 'id-photos'
        and split_part(name, '/', 1) = auth.uid()::text
      )
      with check (
        bucket_id = 'id-photos'
        and split_part(name, '/', 1) = auth.uid()::text
      );
    end if;

    -- DELETE (remove)
    if not exists (
      select 1 from pg_policies
      where schemaname = 'storage'
        and tablename = 'objects'
        and policyname = 'id-photos_delete_own'
    ) then
      create policy "id-photos_delete_own"
      on storage.objects
      for delete
      to authenticated
      using (
        bucket_id = 'id-photos'
        and split_part(name, '/', 1) = auth.uid()::text
      );
    end if;
  end if;
end $$;
