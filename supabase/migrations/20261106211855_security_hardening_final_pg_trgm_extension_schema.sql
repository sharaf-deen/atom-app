-- Security Hardening final consolidated audit — Staging only.
-- Remove pg_trgm from the exposed public schema, retaining index/operator dependencies.
-- app search functions reference unqualified similarity(); include extensions.
ALTER EXTENSION pg_trgm SET SCHEMA extensions;
ALTER FUNCTION public.admin_search_store_products_impl(text,text,text,integer,integer) SET search_path = public, extensions, pg_catalog;
