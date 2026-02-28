import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireStaff } from '@/lib/apiAuth'
import { getAppUrl } from '@/lib/appUrl'

function getAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY // server-only
  if (!url || !key) {
    // Important: do NOT crash at module import time (Next build imports route handlers).
    // Throw only when the route is actually called.
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  }

  return createClient<any>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export async function POST(req: Request) {
  const gate = await requireStaff()
  if (!gate.ok) return gate.res

  try {
    const { first_name, last_name, email, phone } = await req.json()

    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      return NextResponse.json({ ok: false, error: 'Invalid email' }, { status: 400 })
    }

    const admin = getAdmin()

    // 1) Invite user (Supabase sends the invite email)
    const { data: invite, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email.toLowerCase(), {
      data: { first_name, last_name, phone, role: 'member' },
      redirectTo: `${getAppUrl()}/auth/complete-invite`,
    })

    if (inviteErr) {
      return NextResponse.json({ ok: false, error: `inviteUserByEmail: ${inviteErr.message}` }, { status: 500 })
    }

    const userId = invite.user?.id
    if (!userId) {
      return NextResponse.json({ ok: false, error: 'No user id returned' }, { status: 500 })
    }

    // 2) Upsert profile
    const { error: profErr } = await admin
      .from('profiles')
      .upsert(
        {
          user_id: userId,
          email: email.toLowerCase(),
          first_name,
          last_name,
          phone,
          role: 'member',
        },
        { onConflict: 'user_id' }
      )

    if (profErr) {
      return NextResponse.json({ ok: false, error: `profiles upsert: ${profErr.message}` }, { status: 500 })
    }

    return NextResponse.json({ ok: true, user_id: userId })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Unexpected error' }, { status: 500 })
  }
}
