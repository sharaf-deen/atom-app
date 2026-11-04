import 'server-only'

import { createClient } from '@supabase/supabase-js'

/**
 * Server-only privileged Supabase client used in Route Handlers / Server Components.
 * IMPORTANT: DO NOT import this into client components.
 *
 * Security Hardening 1B migration path:
 *   1. Create a new sb_secret_... API key in each Supabase environment.
 *   2. Store it only in the corresponding server-side SUPABASE_SECRET_KEY
 *      environment variable (Vercel Secret), never NEXT_PUBLIC_*.
 *   3. Verify Staging before configuring Production.
 *   4. Keep legacy SUPABASE_SERVICE_ROLE_KEY until every dependency has migrated.
 *
 * The legacy key fallback preserves existing deployments during rollout.
 */
/**
 * Centralized credential lookup for existing server-only Supabase clients.
 * Undefined indicates a missing key so legacy endpoint-specific 500 responses
 * remain unchanged. A malformed configured modern key always fails closed.
 */
export function getSupabaseAdminKey(): string | undefined {
  const modernKey = process.env.SUPABASE_SECRET_KEY?.trim()
  if (modernKey && !modernKey.startsWith('sb_secret_')) {
    throw new Error('Invalid server-side Supabase secret key configuration')
  }
  // Opt-in staging gate: prove the modern secret works without legacy fallback.
  // This flag must remain unset in Production until a separate release approval.
  if (process.env.ATOM_REQUIRE_MODERN_SUPABASE_KEY === '1' && !modernKey) {
    throw new Error('Modern server-side Supabase secret key required')
  }
  return modernKey || process.env.SUPABASE_SERVICE_ROLE_KEY
}

export function createSupabaseAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = getSupabaseAdminKey()
  if (!url || !key) {
    throw new Error('Missing Supabase URL or server-side Supabase API key')
  }
  return createClient<any>(url, key, { auth: { persistSession: false } })
}
