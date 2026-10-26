# 2F.4C.2B — Adult E2E execution kit

This kit **does not execute real registrations**. It supplies a source contract probe, isolation self-attestation and evidence manifest for controlled browser/email/Supabase testing.

## Usage

```powershell
node .\scripts\check-adult-e2e-execution.cjs
Copy-Item .\docs\ADULT_E2E_EXECUTION_MANIFEST_TEMPLATE.json "$env:USERPROFILE\Documents\atom-adult-e2e-manifest.json"
# Fill only non-secret fields; check actual environments independently.
node .\scripts\check-adult-e2e-execution.cjs --manifest "$env:USERPROFILE\Documents\atom-adult-e2e-manifest.json"
```

The source probe does not need environment variables, network, browser, credentials or dependencies. Its output is not an E2E test result. `--manifest` verifies declared non-secret differences and evidence completeness; it cannot independently attest Vercel/Supabase settings.

See `docs/ADULT_E2E_EXECUTION_RUNBOOK_1D1B2F4C2B.md` for manual test steps. Keep production flags OFF. No database migration or application route modifications.
