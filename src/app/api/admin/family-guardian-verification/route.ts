export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { normalizeRole } from '@/lib/rbac'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const decisions = new Set(['verified', 'rejected', 'requires_review'])
const methods = new Set(['in_person_documents', 'verified_official_record', 'other_reviewed_evidence'])
function reply(body: object, status = 200) {
  const r = NextResponse.json(body, { status }); r.headers.set('Cache-Control', 'no-store'); return r
}

async function staffContext() {
  const client = createSupabaseServerActionClient()
  const { data: session, error } = await client.auth.getUser()
  if (error || !session.user) return { code: 'NOT_AUTHENTICATED', status: 401 } as const
  const admin = createSupabaseAdminClient()
  const { data: profile, error: roleError } = await admin.from('profiles').select('role').eq('user_id', session.user.id).maybeSingle()
  if (roleError) return { code: 'ROLE_LOOKUP_FAILED', status: 503 } as const
  if (normalizeRole(profile?.role) !== 'super_admin') return { code: 'FORBIDDEN', status: 403 } as const
  return { admin, actorId: session.user.id }
}

async function validPair(admin: ReturnType<typeof createSupabaseAdminClient>, familyId: string, guardianId: string, memberId: string) {
  const [guardian, child] = await Promise.all([
    admin.from('family_guardians').select('family_id,auth_user_id').eq('family_id', familyId).eq('auth_user_id', guardianId).maybeSingle(),
    admin.from('family_members').select('family_id,member_id').eq('family_id', familyId).eq('member_id', memberId).maybeSingle(),
  ])
  if (guardian.error || child.error) return 'LINK_LOOKUP_FAILED'
  if (!guardian.data || !child.data) return 'GUARDIAN_CHILD_LINK_NOT_FOUND'
  const { data: profile, error } = await admin.from('profiles').select('role,date_of_birth').eq('user_id', memberId).maybeSingle()
  if (error) return 'MEMBER_LOOKUP_FAILED'
  if (!profile || profile.role !== 'member' || !profile.date_of_birth) return 'MEMBER_NOT_ELIGIBLE'
  const birth = new Date(`${String(profile.date_of_birth).slice(0, 10)}T00:00:00Z`)
  if (!Number.isFinite(birth.getTime())) return 'MEMBER_NOT_ELIGIBLE'
  const today = new Date()
  const adultCutoff = new Date(Date.UTC(today.getUTCFullYear() - 18, today.getUTCMonth(), today.getUTCDate()))
  if (birth > today || birth <= adultCutoff) return 'MEMBER_NOT_MINOR'
  return null
}

/** Read-only history, scoped to an existing Family/Guardian/Child tuple. */
export async function GET(req: Request) {
  if (process.env.ATOM_GUARDIAN_AUTHORITY_REVIEW_ENABLED !== 'true') return reply({ ok: false, code: 'FEATURE_DISABLED' }, 404)
  const c = await staffContext()
  if ('code' in c) return reply({ ok: false, code: c.code }, c.status)
  const params = new URL(req.url).searchParams
  const familyId = params.get('family_id') || ''
  const guardianId = params.get('guardian_auth_user_id') || ''
  const memberId = params.get('member_user_id') || ''
  if (![familyId, guardianId, memberId].every(v => UUID.test(v))) return reply({ ok: false, code: 'INVALID_INPUT' }, 400)
  const pairError = await validPair(c.admin, familyId, guardianId, memberId)
  if (pairError) return reply({ ok: false, code: pairError }, 409)
  const { data, error } = await c.admin.from('atom_guardian_authority_reviews')
    .select('id,decision,evidence_method,evidence_reference,review_note,reviewed_by,reviewed_at')
    .eq('family_id', familyId).eq('guardian_auth_user_id', guardianId).eq('member_user_id', memberId)
    .order('reviewed_at', { ascending: false }).order('id', { ascending: false }).limit(30)
  if (error) return reply({ ok: false, code: 'REVIEW_HISTORY_UNAVAILABLE' }, 503)
  return reply({ ok: true, reviews: data ?? [] })
}

/** Explicit human staff decision. No legal acceptance write or automatic consent unlock. */
export async function POST(req: Request) {
  if (process.env.ATOM_GUARDIAN_AUTHORITY_REVIEW_ENABLED !== 'true') return reply({ ok: false, code: 'FEATURE_DISABLED' }, 404)
  const origin = req.headers.get('origin')
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL
  if (!origin || !appUrl || origin !== new URL(appUrl).origin) return reply({ ok: false, code: 'ORIGIN_FORBIDDEN' }, 403)
  const c = await staffContext()
  if ('code' in c) return reply({ ok: false, code: c.code }, c.status)
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return reply({ ok: false, code: 'INVALID_INPUT' }, 400)
  const { family_id: familyId, guardian_auth_user_id: guardianId, member_user_id: memberId, decision, evidence_method: method } = body
  const evidenceReference = typeof body.evidence_reference === 'string' ? body.evidence_reference.trim() : ''
  const note = typeof body.review_note === 'string' ? body.review_note.trim() : ''
  if (![familyId, guardianId, memberId].every(v => typeof v === 'string' && UUID.test(v))
    || !decisions.has(decision) || !methods.has(method)
    || evidenceReference.length < 4 || evidenceReference.length > 160
    || note.length < 12 || note.length > 1000)
    return reply({ ok: false, code: 'INVALID_INPUT' }, 400)
  if (guardianId === c.actorId) return reply({ ok: false, code: 'SELF_REVIEW_FORBIDDEN' }, 403)
  const pairError = await validPair(c.admin, familyId, guardianId, memberId)
  if (pairError) return reply({ ok: false, code: pairError }, 409)
  const { data, error } = await c.admin.from('atom_guardian_authority_reviews').insert({
    family_id: familyId, guardian_auth_user_id: guardianId, member_user_id: memberId,
    decision, evidence_method: method, evidence_reference: evidenceReference,
    review_note: note, reviewed_by: c.actorId,
  }).select('id,decision,reviewed_at').single()
  if (error) return reply({ ok: false, code: 'REVIEW_RECORD_FAILED' }, 503)
  return reply({ ok: true, code: 'REVIEW_RECORDED_NO_CONSENT_UNLOCK', review: data }, 200)
}
