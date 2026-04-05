import { NextResponse } from 'next/server'

import { sanitizePhone, sanitizeText, isISODateOnly } from '@/lib/inputGuard'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { getSessionUser } from '@/lib/session'

export const dynamic = 'force-dynamic'

function isEditableRole(role: string | null | undefined) {
  return role === 'reception' || role === 'admin' || role === 'super_admin'
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const me = await getSessionUser()
  if (!me) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!isEditableRole(me.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const targetUserId = String(params?.id ?? '')
  if (!isUuid(targetUserId)) {
    return NextResponse.json({ error: 'Invalid member id' }, { status: 400 })
  }

  let body: any = null
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const first_name = sanitizeText(body?.first_name, { max: 80 }) || null
  const last_name = sanitizeText(body?.last_name, { max: 80 }) || null
  const phone = sanitizePhone(body?.phone, 32) || null
  const date_of_birth_raw = sanitizeText(body?.date_of_birth, { max: 10 })
  const date_of_birth = date_of_birth_raw ? date_of_birth_raw : null

  if (date_of_birth && !isISODateOnly(date_of_birth)) {
    return NextResponse.json({ error: 'Invalid date of birth' }, { status: 400 })
  }

  const admin = createSupabaseAdminClient()

  const { data: existing, error: existingError } = await admin
    .from('profiles')
    .select('user_id')
    .eq('user_id', targetUserId)
    .maybeSingle()

  if (existingError) {
    return NextResponse.json({ error: 'Load failed', details: existingError.message }, { status: 500 })
  }

  if (!existing) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  }

  const { error } = await admin
    .from('profiles')
    .update({
      first_name,
      last_name,
      phone,
      date_of_birth,
    })
    .eq('user_id', targetUserId)

  if (error) {
    return NextResponse.json({ error: 'Save failed', details: error.message }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    message: 'Saved',
    profile: {
      user_id: targetUserId,
      first_name,
      last_name,
      phone,
      date_of_birth,
    },
  })
}
