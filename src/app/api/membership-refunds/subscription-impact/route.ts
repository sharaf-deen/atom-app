// src/app/api/membership-refunds/subscription-impact/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@supabase/supabase-js'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'



type ImpactAction = 'keep_active' | 'cancel_subscription' | 'shorten_subscription'
const IMPACT_ACTIONS = new Set<ImpactAction>(['keep_active', 'cancel_subscription', 'shorten_subscription'])

function json(status: number, body: any) {
  const res = NextResponse.json(body, { status })
  res.headers.set('Cache-Control', 'no-store')
  return res
}

function makeAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient<any>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

function cleanString(v: unknown, max = 2000) {
  if (typeof v !== 'string') return ''
  return v.trim().slice(0, max)
}

function normalizeUuid(v: unknown) {
  const s = cleanString(v, 80)
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) ? s : ''
}

function isISODateOnly(value: string | null | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(value + 'T00:00:00Z')
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

async function safeAudit(admin: any, row: any) {
  try { await admin.from('audit_logs').insert(row) } catch { /* best-effort */ }
}

export async function POST(req: Request) {
  try {
    const supabase = createSupabaseServerActionClient()
    const { data: auth, error: authErr } = await supabase.auth.getUser()
    if (authErr) return json(401, { ok: false, error: 'AUTH_ERROR', details: authErr.message })
    if (!auth.user) return json(401, { ok: false, error: 'NOT_AUTHENTICATED' })

    const actorId = auth.user.id
    const { data: me, error: meErr } = await supabase
      .from('profiles')
      .select('role')
      .eq('user_id', actorId)
      .maybeSingle<{ role: string | null }>()

    if (meErr) return json(500, { ok: false, error: 'PROFILE_LOOKUP_FAILED', details: meErr.message })

    const role = me?.role ?? 'member'
    if (role !== 'super_admin') return json(403, { ok: false, error: 'FORBIDDEN' })

    const admin = makeAdminClient()
    if (!admin) {
      return json(500, {
        ok: false,
        error: 'SERVICE_ROLE_MISSING',
        details: 'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set on the server.',
      })
    }

    const body = await req.json().catch(() => ({} as any))
    const requestUrl = new URL(req.url)
    const refundId = normalizeUuid(
      body?.refundId
      ?? body?.refund_id
      ?? body?.id
      ?? requestUrl.searchParams.get('refundId')
      ?? requestUrl.searchParams.get('refund_id'),
    )
    const actionRaw = cleanString(body?.action, 80) as ImpactAction
    const action = IMPACT_ACTIONS.has(actionRaw) ? actionRaw : null
    const reason = cleanString(body?.reason, 2000)
    const impactEndDate = cleanString(body?.impactEndDate ?? body?.impact_end_date, 20)

    if (!refundId) return json(400, { ok: false, error: 'MISSING_REFUND_ID' })
    if (!action) return json(400, { ok: false, error: 'INVALID_ACTION' })
    if (reason.length < 3) return json(400, { ok: false, error: 'REASON_REQUIRED' })
    if (action === 'shorten_subscription' && !isISODateOnly(impactEndDate)) {
      return json(400, { ok: false, error: 'INVALID_IMPACT_END_DATE', details: 'Expected YYYY-MM-DD.' })
    }

    const { data: result, error: rpcError } = await admin.rpc('apply_membership_refund_impact_atomic', {
      p_refund_id: refundId,
      p_action: action,
      p_reason: reason,
      p_impact_end_date: action === 'shorten_subscription' ? impactEndDate : null,
      p_actor: actorId,
    })

    if (rpcError) {
      const status = rpcError.code === '42501' ? 403
        : rpcError.code === 'P0002' ? 404
        : rpcError.code === '23505' || rpcError.code === '23514' ? 409
        : rpcError.code === '22023' ? 400 : 500
      return json(status, { ok: false, error: rpcError.code === 'PGRST202' ? 'MIGRATION_REQUIRED' : 'REFUND_IMPACT_FAILED', details: rpcError.message })
    }
    if (!result?.ok) return json(500, { ok: false, error: 'INVALID_RPC_RESPONSE' })

    await safeAudit(admin, {
      actor_user_id: actorId,
      target_user_id: result.refund?.member_id ?? null,
      action: 'membership_refund_subscription_impact',
      action_details: { ...result.audit, note: 'Atomic impact. Original payment and refund records preserved.' },
    })

    revalidatePath('/admin/membership-refunds')
    revalidatePath('/admin/members')
    revalidatePath('/admin/subscriptions')
    if (result.refund?.member_id) revalidatePath(`/members/${result.refund.member_id}`)

    return json(200, { ok: true, refund: result.refund, subscription: result.subscription })
  } catch (e: any) {
    return json(500, { ok: false, error: 'SERVER_ERROR', details: e?.message ?? String(e) })
  }
}
