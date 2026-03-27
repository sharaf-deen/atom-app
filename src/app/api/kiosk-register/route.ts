import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireStaff } from '@/lib/apiAuth'
import { getAppUrl } from '@/lib/appUrl'
import { normalizeEmail, sanitizePhone, sanitizeText } from '@/lib/inputGuard'

function getAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  }

  return createClient<any>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

function noStore(res: NextResponse) {
  res.headers.set('Cache-Control', 'no-store')
  return res
}

export async function POST(req: Request) {
  const gate = await requireStaff()
  if (!gate.ok) return gate.res

  try {
    const body = await req.json().catch(() => ({} as any))
    const first_name = sanitizeText(body?.first_name, { max: 80 })
    const last_name = sanitizeText(body?.last_name, { max: 80 })
    const email = normalizeEmail(body?.email)
    const phone = sanitizePhone(body?.phone, 32)

    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      return noStore(NextResponse.json({ ok: false, error: 'Invalid email' }, { status: 400 }))
    }
    if (!first_name) {
      return noStore(NextResponse.json({ ok: false, error: 'Missing first name' }, { status: 400 }))
    }
    if (phone && phone.replace(/\D+/g, '').length > 20) {
      return noStore(NextResponse.json({ ok: false, error: 'Invalid phone' }, { status: 400 }))
    }

    const admin = getAdmin()

    const { data: invite, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { first_name, last_name, phone, role: 'member' },
      redirectTo: `${getAppUrl()}/auth/complete-invite`,
    })

    if (inviteErr) {
      return noStore(NextResponse.json({ ok: false, error: `inviteUserByEmail: ${inviteErr.message}` }, { status: 500 }))
    }

    const userId = invite.user?.id
    if (!userId) {
      return noStore(NextResponse.json({ ok: false, error: 'No user id returned' }, { status: 500 }))
    }

    const { error: profErr } = await admin
      .from('profiles')
      .upsert(
        {
          user_id: userId,
          email,
          first_name,
          last_name,
          phone,
          role: 'member',
        },
        { onConflict: 'user_id' }
      )

    if (profErr) {
      return noStore(NextResponse.json({ ok: false, error: `profiles upsert: ${profErr.message}` }, { status: 500 }))
    }

    return noStore(NextResponse.json({ ok: true, user_id: userId }))
  } catch (e: any) {
    return noStore(NextResponse.json({ ok: false, error: e?.message || 'Unexpected error' }, { status: 500 }))
  }
}
