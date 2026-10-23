# Functional 1D.1B.2E.5B — Recovery diagnostics and activation report (foundation)

This patch adds a **read-only** Super Admin invitation diagnostic and a best-effort password setup **reported** checkpoint, emitted only after `supabase.auth.updateUser({password})` succeeds. It is **not** cryptographic proof of password completion and must never be used as legal consent or subscription authorization.

The endpoint feature flag is `ATOM_REGISTRATION_ACTIVATION_TRACKING_ENABLED=true`, default off. Do not enable in production before isolated testing. Existing registration dispatch flag remains off. No automated resend is included; an ambiguous Resend response can reflect an email that was actually sent. Treat uncertain dispatches as manual review. User asked for full recovery and resend; those remain follow-up work.

For verification: run TypeScript, production build, SQL migration, confirm RPC permissions and run isolated account tests. No production fake accounts.
