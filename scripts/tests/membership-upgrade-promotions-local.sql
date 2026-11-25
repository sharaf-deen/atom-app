-- ATOM membership upgrade promotion eligibility, local DB rollback-only smoke.
\set ON_ERROR_STOP on
BEGIN;
DO $tests$
DECLARE
  v_offer uuid;
  v_valid jsonb;
  v_expired jsonb;
  v_short jsonb;
  v_last jsonb;
BEGIN
  INSERT INTO public.promotions(title,description,discount_type,discount_value,applies_to,min_months,start_date,end_date)
  VALUES('TEST Upgrade November 15% ROLLBACK','Only for isolated rollback assertions',
    'percent',15,array['membership']::text[],3,'2026-11-25','2026-11-30')
  RETURNING id INTO v_offer;

  SELECT public.membership_upgrade_promotion_price_v1('6m','2026-11-25',8100) INTO v_valid;
  IF (v_valid->>'promotionId')::uuid IS DISTINCT FROM v_offer
     OR (v_valid->>'listPriceEGP')::numeric <> 8100
     OR (v_valid->>'discountEGP')::numeric <> 1215
     OR (v_valid->>'finalPriceEGP')::numeric <> 6885 THEN
    RAISE EXCEPTION 'UPGRADE_PROMO_PRICE_MISMATCH: %',v_valid;
  END IF;

  SELECT public.membership_upgrade_promotion_price_v1('6m','2026-11-30',8100) INTO v_last;
  IF (v_last->>'finalPriceEGP')::numeric <> 6885 THEN
    RAISE EXCEPTION 'PROMO_LAST_DAY_NOT_INCLUSIVE';
  END IF;

  SELECT public.membership_upgrade_promotion_price_v1('6m','2026-12-01',8100) INTO v_expired;
  IF (v_expired->>'finalPriceEGP')::numeric <> 8100
    OR v_expired->>'promotionId' IS NOT NULL THEN
    RAISE EXCEPTION 'EXPIRED_PROMO_LEAK';
  END IF;

  SELECT public.membership_upgrade_promotion_price_v1('1m','2026-11-25',2200) INTO v_short;
  IF (v_short->>'finalPriceEGP')::numeric <> 2200
    OR v_short->>'promotionId' IS NOT NULL THEN
    RAISE EXCEPTION 'PROMO_APPLIED_TO_EXCLUDED_PLAN';
  END IF;

  IF has_function_privilege('authenticated','public.membership_upgrade_promotion_price_v1(text,date,numeric)','EXECUTE')
     OR has_function_privilege('anon','public.membership_upgrade_promotion_price_v1(text,date,numeric)','EXECUTE') THEN
    RAISE EXCEPTION 'PROMOTION_PRICING_RPC_EXPOSED_TO_PUBLIC_ROLES';
  END IF;
  RAISE NOTICE 'PASS: promo price, expiry, plan scope, RPC authorization; rollback';
END $tests$;
ROLLBACK;
