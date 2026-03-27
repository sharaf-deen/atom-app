import { NextRequest } from 'next/server'
import { createSupabaseRouteClient } from '@/lib/supabaseRoute'
import { jsonWithApiRuntime, logApiError, startApiRuntime } from '@/lib/apiRuntime'

const STAFF_ROLES = new Set(['reception', 'admin', 'super_admin'])

export async function GET(req: NextRequest) {
  const meta = startApiRuntime('/api/kiosk/health')
  const { supabase, applyCookies } = createSupabaseRouteClient(req)

  try {
    const { data: userRes, error: userErr } = await supabase.auth.getUser()
    if (userErr || !userRes?.user) {
      return applyCookies(
        jsonWithApiRuntime(meta, 401, { ok: false, reason: 'unauthenticated' }, 'no-store')
      )
    }

    const user = userRes.user

    const { data: prof, error: profErr } = await supabase
      .from('profiles')
      .select('role,email')
      .eq('user_id', user.id)
      .maybeSingle()

    const role = (prof?.role ?? null) as string | null
    const email = (prof?.email ?? user.email ?? null) as string | null

    if (profErr) {
      logApiError(meta, 'profile_lookup', profErr, { user_id: user.id })
      return applyCookies(
        jsonWithApiRuntime(meta, 500, { ok: false, reason: 'profile_error' }, 'no-store')
      )
    }

    if (!role || !STAFF_ROLES.has(role)) {
      return applyCookies(
        jsonWithApiRuntime(meta, 403, { ok: false, reason: 'forbidden', role }, 'no-store')
      )
    }

    const { data: sessRes } = await supabase.auth.getSession()
    const expiresAt = sessRes?.session?.expires_at ?? null

    return applyCookies(
      jsonWithApiRuntime(
        meta,
        200,
        {
          ok: true,
          role,
          email,
          user_id: user.id,
          expires_at: expiresAt,
          ts: new Date().toISOString(),
        },
        'no-store',
      ),
    )
  } catch (error) {
    logApiError(meta, 'unexpected', error)
    return applyCookies(
      jsonWithApiRuntime(meta, 500, { ok: false, reason: 'unexpected' }, 'no-store')
    )
  }
}
