// src/app/api/freeze-requests/[id]/route.ts
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'

type Action = 'approve' | 'deny' | 'cancel'
type Json = Record<string, unknown>

function createSupabaseFromApiRoute() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (name: string) => cookies().get(name)?.value,
        set: () => {},
        remove: () => {},
      },
    }
  )
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const supabase = createSupabaseFromApiRoute()
    const { data: userData } = await supabase.auth.getUser()
    if (!userData?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const uid = userData.user.id
    const id = params.id

    const body = await req.json().catch(() => ({}))
    const action = String((body as any).action || '') as Action
    const admin_note = (body as any).admin_note ? String((body as any).admin_note) : null

    if (!['approve', 'deny', 'cancel'].includes(action)) {
      return NextResponse.json({ error: 'Invalid action' }, { status: 422 })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('user_id', uid)
      .single()

    const { data: reqRow, error: reqErr } = await supabase
      .from('freeze_requests')
      .select('id, member_user_id, status')
      .eq('id', id)
      .single()
    if (reqErr || !reqRow) return NextResponse.json({ error: 'Request not found' }, { status: 404 })

    if (action === 'cancel') {
      if (reqRow.member_user_id !== uid) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      if (reqRow.status !== 'pending') return NextResponse.json({ error: 'Only pending requests can be canceled' }, { status: 409 })

      const { error } = await supabase.from('freeze_requests').update({ status: 'canceled' }).eq('id', id)
      if (error) return NextResponse.json({ error: error.message }, { status: 400 })
      return NextResponse.json({ ok: true })
    }

    const isAdmin = profile?.role === 'admin' || profile?.role === 'super_admin'
    if (!isAdmin) return NextResponse.json({ error: 'Admin only' }, { status: 403 })
    if (reqRow.status !== 'pending') return NextResponse.json({ error: 'Only pending requests can be processed' }, { status: 409 })

    const nextStatus = action === 'approve' ? 'approved' : 'denied'
    const { error } = await supabase
      .from('freeze_requests')
      .update({ status: nextStatus, processed_by: uid, processed_at: new Date().toISOString(), admin_note: admin_note ?? null })
      .eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: 'Server error', details: e?.message ?? String(e) }, { status: 500 })
  }
}
