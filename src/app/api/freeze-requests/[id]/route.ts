// src/app/api/freeze-requests/[id]/route.ts
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'

type Action = 'approve' | 'deny' | 'cancel'
type Json = Record<string, unknown>

function createSupabaseFromApiRoute() {
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      get: (name: string) => cookies().get(name)?.value,
      set: () => {},
      remove: () => {},
    },
  })
}

function isStaff(role: string | null | undefined) {
  return role === 'reception' || role === 'admin' || role === 'super_admin'
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const supabase = createSupabaseFromApiRoute()

    const { data: userData, error: userErr } = await supabase.auth.getUser()
    if (userErr || !userData?.user) return NextResponse.json({ error: 'Unauthorized' } as Json, { status: 401 })
    const uid = userData.user.id
    const id = params.id

    const body = await req.json().catch(() => ({}))
    const action = String((body as any).action || '') as Action
    const admin_note = (body as any).admin_note ? String((body as any).admin_note) : null

    if (!['approve', 'deny', 'cancel'].includes(action)) {
      return NextResponse.json({ error: 'Invalid action' } as Json, { status: 422 })
    }

    // Staff only
    const { data: profile, error: profErr } = await supabase
      .from('profiles')
      .select('role')
      .eq('user_id', uid)
      .single()

    if (profErr) return NextResponse.json({ error: 'Profile error', details: profErr.message } as Json, { status: 500 })
    if (!isStaff(profile?.role)) {
      return NextResponse.json({ error: 'FORBIDDEN' } as Json, { status: 403 })
    }

    const { data: reqRow, error: reqErr } = await supabase
      .from('freeze_requests')
      .select('id,status')
      .eq('id', id)
      .single()

    if (reqErr || !reqRow) return NextResponse.json({ error: 'Request not found' } as Json, { status: 404 })
    if (reqRow.status !== 'pending') {
      return NextResponse.json({ error: 'Only pending requests can be processed' } as Json, { status: 409 })
    }

    const nextStatus = action === 'approve' ? 'approved' : action === 'deny' ? 'denied' : 'canceled'

    const { error } = await supabase
      .from('freeze_requests')
      .update({
        status: nextStatus,
        processed_by: uid,
        processed_at: new Date().toISOString(),
        admin_note: admin_note ?? null,
      })
      .eq('id', id)

    if (error) return NextResponse.json({ error: error.message } as Json, { status: 400 })
    return NextResponse.json({ ok: true } as Json)
  } catch (e: any) {
    return NextResponse.json({ error: 'Server error', details: e?.message ?? String(e) } as Json, { status: 500 })
  }
}
