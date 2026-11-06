# Security Hardening 1F.4 — Staging review

Five privileged RPCs now deny anonymous EXECUTE (5/5 verified). Authenticated access remains and must not be treated as validated.

Store sale update and preorder conversion lack direct caller checks. Private coaching payment confirmation relies on caller-provided actor ID. Payroll approval and salary payment recording similarly lack direct identity checks. These are high-priority authorization findings, not proven exploits.

Before Production: inventory API call paths; revoke authenticated EXECUTE for server-only functions or implement current-user and role validation inside client-callable functions. Run denied/allowed role matrix, functional smoke tests, and DB reset. PR must remain Draft until testing is complete.
