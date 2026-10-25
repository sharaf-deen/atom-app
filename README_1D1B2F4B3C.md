# Functional 1D.1B.2F.4B.3C — Reception Desk Integration

## Scope
- Reception continues seeing only redacted lifecycle labels and next steps.
- Only Super Admin gets per-request diagnostic action controls.
- Diagnostic POST uses the existing read-only `provisioning/plan` route.
- Two explicit privileged transitions are offered only when the plan permits: `RECONCILE_AUTH` and `COMPLETE_MEMBER_FAMILY`.
- The route `provisioning/transition` separately checks Super Admin, feature flag, fresh plan and DB integrity.
- No mutation on page load, panel open or diagnosis refresh.
- Post-error retry disabled until the panel is closed and a new server diagnosis is performed; ambiguous outcomes require manual review.
- No new SQL, permissions, Auth creation, email or consent change.

## Acceptance checklist
- Reception: no Super Admin controls or request identifiers shown; guidance remains visible.
- Super Admin: per-request diagnosis available, action only after explicit opt-in.
- Forbidden route calls using reception session receive 403.
- Feature flag unset: transition endpoint refuses requests.
- Validate interrupted Auth and Member/Family transitions with test accounts only.
- Verify mobile/keyboard focus and no auto mutations.
- Check `git diff --check`, `npx tsc --noEmit`, `npm run build`, CI.

## Launch state
Public `/register` remains disabled in production. No E2E claims implied.
