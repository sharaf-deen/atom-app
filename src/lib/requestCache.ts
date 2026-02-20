// src/lib/requestCache.ts
// Per-request dedupe for server components (React cache).
// This avoids repeated session lookups / client creation within the same request.
import { cache } from 'react'
import { getSessionUser } from '@/lib/session'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'

export const getSessionUserCached = cache(getSessionUser)
export const getSupabaseAdminClientCached = cache(() => createSupabaseAdminClient())
