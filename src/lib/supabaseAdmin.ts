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
export function createSupabaseAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const modernKey = process.env.SUPABASE_SECRET_KEY?.trim()
  if (modernKey && !modernKey.startsWith('sb_secret_')) {
    // A configured but malformed secret must not silently fall back.
    throw new Error('Invalid server-side Supabase secret key configuration')
  }
  const key = modernKey || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('Missing Supabase URL or server-side Supabase API key')
  }
  return createClient<any>(url, key, { auth: { persistSession: false } })
}
