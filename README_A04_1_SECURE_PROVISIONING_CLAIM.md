# ATOM App — A04.1 Secure Provisioning Claim Endpoint

Only one new application route is included. **No database migration.**

## Endpoint

`POST /api/admin/public-registration/provisioning/claim`

Prerequisites: `ATOM_REGISTRATION_PROVISIONING_CLAIM_ENABLED=true` **only on Vercel staging**, a same-origin browser request, authenticated `super_admin`, UUID `request_id`, and `confirm: true`.

Before claiming, the handler checks the read-only orchestration plan (`REVIEW_IDENTITY_AND_CLAIM`) and repeats the comprehensive identity audit. The existing `atom_claim_registration_provisioning_v1` service-role RPC is the final atomic guard.

On success, response is `{ "ok": true, "code": "CLAIMED", "claim_id": "...", "nextStep": "CREATE_AUTH_MANUALLY" }`. Store `claim_id` securely; it is required for the separately gated Auth create step. Do not include it in public screenshots/logs. On 503, **do not retry**; inspect the DB status and claim first.

No Auth user, Member, Family, legal acceptance, invitation or paid subscription is created. Feature flag defaults OFF for every environment.

## Staging test sequence

1. Deploy from `staging` branch with new route; set only `ATOM_REGISTRATION_PROVISIONING_CLAIM_ENABLED=true` on staging; redeploy staging. Leave all other provisioning feature flags unchanged.
2. Verify `atom_public_registration_requests.status='under_review'`, `provisioning_claim_id IS NULL`, `identity_verified_at IS NOT NULL`, and identity audit `safeForNewAuth=true`.
3. From authenticated Staging Super Admin browser console, **once**, run:

```javascript
const r = await fetch('/api/admin/public-registration/provisioning/claim', {
  method: 'POST', credentials: 'same-origin',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({
    request_id: '05cf63e2-1edb-4f8a-bd7b-1b2c83c5bbc0',
    confirm: true,
  }),
});
console.log('HTTP:', r.status);
const body = await r.json();
console.log('Code:', body.code); // Do not copy claim_id into chat
```

4. In Supabase staging read only:

```sql
SELECT id,status,provisioning_claim_id IS NOT NULL AS has_claim,
       provisioning_claimed_at, auth_provisioning_started_at,
       provisioned_auth_user_id, member_user_id, family_id
FROM public.atom_public_registration_requests
WHERE id = '05cf63e2-1edb-4f8a-bd7b-1b2c83c5bbc0';
```

Expected status `provisioning`, has_claim `true`, Auth/Member/Family IDs NULL. Only then move to next step. Keep Production OFF. A successful claim is a mutation and must not be repeated; the RPC refuses repeat claims.

## Rollout and review

Run `git diff --check`, `npx tsc --noEmit`, `npm run build`, GitHub CI and DB Smoke prior to merge. Check config scope and sender app domain independently. Do not activate registration or provisioning on Production.
