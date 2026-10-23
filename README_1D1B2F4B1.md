# 1D.1B.2F.4B.1 — Public registration submission (guarded)

- Adds a service-role-only atomic PostgreSQL submission RPC with email and HMAC-IP rate limits.
- Default OFF: `ATOM_PUBLIC_REGISTRATION_SUBMIT_ENABLED` must remain unset in production.
- Required before enabling: `ATOM_REGISTRATION_RATE_LIMIT_SECRET` (random 32+ characters), a trusted proxy that overwrites `x-real-ip`/`x-forwarded-for`, and external WAF/bot protection (database counts only successful writes).
- No verification email is sent automatically. Reception uses existing staff verification endpoint after review; sending directly would require an additional anti-abuse and delivery review.
- Claims of legal documents are *not* legally recorded acceptances. Consent flow is still a launch blocker.
- The endpoint returns a neutral 202 both for accepted and rate-limited submissions; never promise that a request was saved.
- Production launch remains NO-GO. Test on isolated staging DB (adult, minor guardian, duplicate key, concurrent requests, IP/email thresholds, invalid input, no secret, absent IP, unauthorized RPC, and disabled flag).
- IP HMAC hashes should be subject to a scheduled retention policy before production launch.
