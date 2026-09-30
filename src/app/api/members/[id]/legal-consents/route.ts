export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import {
  recordMemberLegalAcceptances,
  validateRegistrationLegalAcceptance,
  type RegistrationLegalAcceptanceInput,
} from '@/lib/legalConsent'
import { normalizeRole } from '@/lib/rbac'

const STAFF_ROLES = new Set(['reception', 'admin', 'super_admin', 'head_coach'])

function noStore(response: NextResponse) {
  response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return response
}

function clientIp(req: Request) {
  const forwarded = req.headers.get('x-forwarded-for')
  return forwarded?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || null
}

export async function POST(req: Request, context: { params: { id: string } }) {
  try {
    const memberUserId = String(context.params?.id || '').trim()
    if (!memberUserId) {
      return noStore(NextResponse.json({ ok: false, error: 'MEMBER_ID_REQUIRED' }, { status: 400 }))
    }

    const supa = createSupabaseServerActionClient()
    const { data: authData, error: authError } = await supa.auth.getUser()
    if (authError || !authData.user) {
      return noStore(NextResponse.json({ ok: false, error: 'NOT_AUTHENTICATED' }, { status: 401 }))
    }

    const actor = authData.user
    const admin = createSupabaseAdminClient()

    const [{ data: actorProfile, error: actorProfileError }, { data: target, error: targetError }] =
      await Promise.all([
        admin.from('profiles').select('role').eq('user_id', actor.id).maybeSingle(),
        admin
          .from('profiles')
          .select('user_id,role,date_of_birth,first_name,last_name')
          .eq('user_id', memberUserId)
          .maybeSingle(),
      ])

    if (actorProfileError || targetError) {
      return noStore(
        NextResponse.json(
          { ok: false, error: 'PROFILE_LOOKUP_FAILED', details: actorProfileError?.message || targetError?.message },
          { status: 500 },
        ),
      )
    }

    if (!target?.user_id) {
      return noStore(NextResponse.json({ ok: false, error: 'MEMBER_NOT_FOUND' }, { status: 404 }))
    }

    const actorRole = normalizeRole(actorProfile?.role)
    const isSelf = actor.id === memberUserId
    const isStaff = STAFF_ROLES.has(String(actorRole || ''))

    if (!isSelf && !isStaff) {
      return noStore(NextResponse.json({ ok: false, error: 'FORBIDDEN' }, { status: 403 }))
    }

    const body = (await req.json().catch(() => ({}))) as {
      legal_acceptance?: RegistrationLegalAcceptanceInput
    }
    const input = body.legal_acceptance

    const validation = await validateRegistrationLegalAcceptance(
      admin,
      target.date_of_birth ? String(target.date_of_birth).slice(0, 10) : null,
      input,
    )

    if (!validation.ok) {
      return noStore(
        NextResponse.json(
          { ok: false, error: validation.error, details: 'details' in validation ? validation.details : undefined },
          { status: validation.status },
        ),
      )
    }

    if (!validation.normalized) {
      return noStore(NextResponse.json({ ok: true, inserted: 0, message: 'No active required legal documents.' }))
    }

    if (isSelf && validation.isMinor) {
      return noStore(
        NextResponse.json(
          {
            ok: false,
            error: 'MINOR_GUARDIAN_ACCEPTANCE_REQUIRED',
            details: 'A parent or legal guardian must provide the acceptance. Ask Reception/Admin to record it.',
          },
          { status: 400 },
        ),
      )
    }

    const source = isSelf ? 'profile_reaccept' : 'manual_backfill'
    const result = await recordMemberLegalAcceptances({
      admin,
      memberUserId,
      actorUserId: actor.id,
      source,
      input: validation.normalized,
      userAgent: req.headers.get('user-agent'),
      ipAddress: clientIp(req),
    })

    if (result.error) {
      return noStore(
        NextResponse.json(
          { ok: false, error: 'LEGAL_CONSENT_RECORD_FAILED', details: result.error.message },
          { status: 500 },
        ),
      )
    }

    revalidatePath(`/members/${memberUserId}`)
    revalidatePath('/members')

    return noStore(
      NextResponse.json({
        ok: true,
        inserted: Number(result.data ?? 0),
        source,
        message: 'Legal acceptance recorded.',
      }),
    )
  } catch (error: any) {
    return noStore(
      NextResponse.json(
        { ok: false, error: 'SERVER_ERROR', details: error?.message || String(error) },
        { status: 500 },
      ),
    )
  }
}
