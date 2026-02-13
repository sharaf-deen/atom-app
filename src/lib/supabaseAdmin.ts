import { createClient } from '@supabase/supabase-js'

/**
 * Service-role Supabase client for server-side privileged operations.
 * IMPORTANT: Only use this after you have enforced app-level authorization.
 */
export function createSupabaseAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_URL')
  }

  return createClient<any>(url, key, {
    auth: { persistSession: false },
  })
}
