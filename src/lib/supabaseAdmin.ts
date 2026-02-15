import { createClient } from '@supabase/supabase-js'

/**
 * Server-only admin client (service role) used in Route Handlers / Server Components.
 * IMPORTANT: Do NOT import this into client components.
 */
export function createSupabaseAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  }
  return createClient<any>(url, key, { auth: { persistSession: false } })
}
