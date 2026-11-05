import 'server-only'

import { createClient } from '@supabase/supabase-js'

/**
 * Server-only privileged Supabase client used in Route Handlers / Server Components.
 * IMPORTANT: DO NOT import this into client components.
 *
 * Security Hardening 1D.14: the legacy JWT-based API keys are disabled in
 * Staging and Production. Only the modern sb_secret_ API key is accepted.
 * SUPABASE_SECRET_KEY must never be prefixed NEXT_PUBLIC_.
 */
export function getSupabaseAdminKey(): string | undefined {
  const modernKey = process.env.SUPABASE_SECRET_KEY?.trim()
  if (modernKey && !modernKey.startsWith('sb_secret_')) {
    throw new Error('Invalid server-side Supabase secret key configuration')
  }
  if (!modernKey) {
    throw new Error('Modern server-side Supabase secret key required')
  }
  return modernKey
}

export function createSupabaseAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = getSupabaseAdminKey()
  if (!url || !key) {
    throw new Error('Missing Supabase URL or server-side Supabase API key')
  }
  return createClient<any>(url, key, { auth: { persistSession: false } })
}
