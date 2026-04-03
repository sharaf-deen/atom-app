// src/app/api/admin/expire/route.ts
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { revalidateTag, revalidatePath } from 'next/cache'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { jsonWithApiRuntime, logApiError, startApiRuntime } from '@/lib/apiRuntime'

async function handle() {
  const meta = startApiRuntime('/api/admin/expire')
  const supa = createSupabaseServerActionClient()

  // Auth
  const { data: auth } = await supa.auth.getUser()
  if (!auth.user) return jsonWithApiRuntime(meta, 401, { ok: false, error: 'NOT_AUTHENTICATED' })

  // Only admin / super_admin
  const { data: me, error: meErr } = await supa
    .from('profiles')
    .select('role')
    .eq('user_id', auth.user.id)
    .maybeSingle<{ role: string | null }>()
  if (meErr) {
    logApiError(meta, 'profile_lookup', meErr)
    return jsonWithApiRuntime(meta, 500, { ok: false, error: 'PROFILE_LOOKUP_FAILED', details: meErr.message })
  }

  const role = me?.role ?? 'member'
  if (!['admin', 'super_admin'].includes(role)) {
    return jsonWithApiRuntime(meta, 403, { ok: false, error: 'FORBIDDEN' })
  }

  // Run the expiration function
  const { data, error } = await supa.rpc('expire_subscriptions')
  if (error) {
    logApiError(meta, 'expire_subscriptions_rpc', error)
    return jsonWithApiRuntime(meta, 500, { ok: false, error: 'RPC_FAILED', details: error.message })
  }


// Invalidate members cache after batch expiration
try { revalidateTag('members') } catch {}
try { revalidatePath('/members') } catch {}
try { revalidatePath('/invoices') } catch {}

  return jsonWithApiRuntime(meta, 200, data ?? { ok: true })
}

export async function POST() { return handle() }
export async function GET()  { return handle() }
