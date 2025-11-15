// src/app/api/freeze-requests/route.ts
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'

type Json = Record<string, unknown>
const isISODate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s)

/** Factory Supabase (signature SSR de ta version: cookies {get,set,remove}) */
function createSupabaseFromApiRoute() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (name: string) => cookies().get(name)?.value,
        set: () => {},     // pas nécessaire dans une route readonly
        remove: () => {},  // idem
      },
    }
  )
}

export async function POST(req: Request) {
  try {
    const supabase = createSupabaseFromApiRoute()

    // Auth
    const { data: userData, error: userErr } = await supabase.auth.getUser()
    if (userErr || !userData?.user) {
      return NextResponse.json({ error: 'Unauthorized' } as Json, { status: 401 })
    }
    const uid = userData.user.id

    // Rôle
    const { data: profile, error: profErr } = await supabase
      .from('profiles')
      .select('role')
      .eq('user_id', uid)
      .single()

    if (profErr || !profile) {
      return NextResponse.json({ error: 'Profile not found' } as Json, { status: 404 })
    }
    if (profile.role !== 'member') {
      return NextResponse.json({ error: 'Only members can request a freeze' } as Json, { status: 403 })
    }

    // Payload
    const body = await req.json().catch(() => ({}))
    const requested_start_date = String((body as any).requested_start_date || '')
    const reason = String((body as any).reason || '').trim()

    if (!isISODate(requested_start_date)) {
      return NextResponse.json({ error: 'Invalid date. Use YYYY-MM-DD' } as Json, { status: 422 })
    }
    const today = new Date().toISOString().slice(0, 10)
    if (requested_start_date < today) {
      return NextResponse.json({ error: 'Date cannot be in the past' } as Json, { status: 422 })
    }
    if (reason.length < 8) {
      return NextResponse.json({ error: 'Reason must be at least 8 characters' } as Json, { status: 422 })
    }

    // Insert
    const { data, error } = await supabase
      .from('freeze_requests')
      .insert({
        member_user_id: uid,
        requested_start_date,
        reason,
        status: 'pending',
      })
      .select('id')
      .single()

    if (error) {
      if ((error as any).code === '23505') {
        return NextResponse.json({ error: 'You already have a pending request' } as Json, { status: 409 })
      }
      return NextResponse.json({ error: error.message } as Json, { status: 400 })
    }

    return NextResponse.json({ ok: true, id: data?.id } as Json, { status: 200 })
  } catch (e: any) {
    return NextResponse.json(
      { error: 'Server error', details: e?.message ?? String(e) } as Json,
      { status: 500 }
    )
  }
}
