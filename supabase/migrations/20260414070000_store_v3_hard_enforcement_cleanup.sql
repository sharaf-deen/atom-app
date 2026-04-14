begin;

DO $$
DECLARE
  missing_count integer;
BEGIN
  SELECT count(*)::integer
    INTO missing_count
  FROM public.store_products
  WHERE model_id IS NULL;

  IF missing_count > 0 THEN
    RAISE EXCEPTION
      'Store V3 hard enforcement blocked: % store_products row(s) still have no model_id. Finish the linking queue before applying this migration.',
      missing_count;
  END IF;
END
$$;

ALTER TABLE public.store_products
  ALTER COLUMN model_id SET NOT NULL;

COMMENT ON COLUMN public.store_products.model_id IS
  'Required under Store V3 hard enforcement. Every variant must be linked to a parent Store V3 model.';

commit;
