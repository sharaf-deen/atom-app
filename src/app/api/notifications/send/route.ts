// src/app/api/notifications/send/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createClient } from '@supabase/supabase-js'

type Audience =
  | 'all_members'
  | 'all_coaches'
  | 'all_assistant_coaches'
  | 'all_staff'
  | 'custom'

const ALLOWED_RECIPIENT_ROLES = ['member', 'coach', 'assistant_coach'] as const

type Body = {
  title?: string
  body: string
  audience: Audience
  kind?: string
  user_ids?: string[]
  emails?: string[]
}

function noStore(res: NextResponse) {
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return res
}

const SENDER_ROLES = new Set(['admin', 'super_admin'])
const ALLOWED_KINDS = new Set(['info', 'order_update', 'billing', 'promo'])

function audienceLabel(audience: Audience) {
  switch (audience) {
    case 'all_members':
      return 'All members'
    case 'all_coaches':
      return 'All coaches'
    case 'all_assistant_coaches':
      return 'All assistant coaches'
    case 'all_staff':
      return 'All coaches + assistants'
    default:
      return 'Custom targeting'
  }
}

export async function POST(req: Request) {
  try {
    const supa = createSupabaseServerActionClient()

    const { data: auth, error: authErr } = await supa.auth.getUser()
    if (authErr) {
      return noStore(NextResponse.json({ ok: false, error: 'AUTH_ERROR', details: authErr.message }, { status: 401 }))
    }
    const user = auth.user
    if (!user) return noStore(NextResponse.json({ ok: false, error: 'NOT_AUTHENTICATED' }, { status: 401 }))

    const { data: me, error: meErr } = await supa
      .from('profiles')
      .select('role')
      .eq('user_id', user.id)
      .maybeSingle<{ role: string | null }>()
    if (meErr) {
      return noStore(NextResponse.json({ ok: false, error: 'PROFILE_LOOKUP_FAILED', details: meErr.message }, { status: 500 }))
    }
    if (!me?.role || !SENDER_ROLES.has(me.role)) {
      return noStore(NextResponse.json({ ok: false, error: 'FORBIDDEN' }, { status: 403 }))
    }

    const b = (await req.json()) as Body
    const msg = (b.body ?? '').trim()
    if (!msg) return noStore(NextResponse.json({ ok: false, error: 'MISSING_BODY' }, { status: 400 }))
    const title = (b.title ?? '').trim() || null

    const kRaw = (b.kind ?? '').trim().toLowerCase()
    const kind = ALLOWED_KINDS.has(kRaw) ? kRaw : 'info'
    const audience = b.audience

    const recipientIds = new Set<string>()
    const eligibleRoles = [...ALLOWED_RECIPIENT_ROLES]
    let requestedUserIds = 0
    let requestedEmails = 0
    let matchedEmailProfiles = 0
    let filteredOutUserIds = 0
    let unmatchedEmails: string[] = []

    async function addFromRoles(roles: string[]) {
      const { data, error } = await supa
        .from('profiles')
        .select('user_id')
        .in('role', roles)
        .not('user_id', 'is', null)
        .limit(100000)
      if (error) throw new Error(error.message)
      for (const r of data ?? []) {
        if (r.user_id) recipientIds.add(r.user_id)
      }
    }

    if (audience === 'all_members') {
      await addFromRoles(['member'])
    } else if (audience === 'all_coaches') {
      await addFromRoles(['coach'])
    } else if (audience === 'all_assistant_coaches') {
      await addFromRoles(['assistant_coach'])
    } else if (audience === 'all_staff') {
      await addFromRoles(['coach', 'assistant_coach'])
    } else if (audience === 'custom') {
      const uniqueIds = Array.from(new Set((Array.isArray(b.user_ids) ? b.user_ids : []).map((s) => String(s).trim()).filter(Boolean)))
      requestedUserIds = uniqueIds.length

      if (uniqueIds.length > 0) {
        const { data: allowedProfiles, error: allowedError } = await supa
          .from('profiles')
          .select('user_id')
          .in('user_id', uniqueIds)
          .in('role', [...ALLOWED_RECIPIENT_ROLES])
          .not('user_id', 'is', null)
          .limit(100000)

        if (allowedError) throw new Error(allowedError.message)
        const allowedIds = new Set((allowedProfiles ?? []).map((r: any) => r.user_id).filter(Boolean))
        filteredOutUserIds = uniqueIds.filter((id) => !allowedIds.has(id)).length
        for (const id of allowedIds) recipientIds.add(id)
      }

      const uniqueEmails = Array.from(new Set((Array.isArray(b.emails) ? b.emails : []).map((s) => String(s).trim().toLowerCase()).filter(Boolean)))
      requestedEmails = uniqueEmails.length
      if (uniqueEmails.length > 0) {
        const { data, error } = await supa
          .from('profiles')
          .select('user_id, email, role')
          .in('email', uniqueEmails)
          .in('role', [...ALLOWED_RECIPIENT_ROLES])
          .not('user_id', 'is', null)
          .limit(100000)
        if (error) throw new Error(error.message)

        const matchedEmailSet = new Set<string>()
        for (const r of data ?? []) {
          if (r.user_id) recipientIds.add(r.user_id)
          if (r.email) matchedEmailSet.add(String(r.email).trim().toLowerCase())
        }
        matchedEmailProfiles = matchedEmailSet.size
        unmatchedEmails = uniqueEmails.filter((email) => !matchedEmailSet.has(email))
      }

      if (recipientIds.size === 0) {
        return noStore(
          NextResponse.json(
            {
              ok: false,
              error: 'NO_ELIGIBLE_RECIPIENTS',
              details: 'Only members, coaches, and assistant coaches can receive notifications from this screen.',
              audience_label: audienceLabel(audience),
              eligible_roles: eligibleRoles,
              delivery_feedback: {
                requested_user_ids: requestedUserIds,
                requested_emails: requestedEmails,
                matched_email_profiles: matchedEmailProfiles,
                filtered_out_user_ids: filteredOutUserIds,
                unmatched_email_count: unmatchedEmails.length,
                unmatched_emails: unmatchedEmails.slice(0, 10),
                deduped_recipient_count: 0,
              },
            },
            { status: 400 },
          ),
        )
      }
    } else {
      return noStore(NextResponse.json({ ok: false, error: 'INVALID_AUDIENCE' }, { status: 400 }))
    }

    const rows = Array.from(recipientIds).map((uid) => ({
      user_id: uid,
      member_id: uid,
      title,
      body: msg,
      created_by: user.id,
      kind,
    }))

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const service = process.env.SUPABASE_SERVICE_ROLE_KEY
    const client = url && service
      ? createClient(url, service, { auth: { autoRefreshToken: false, persistSession: false } })
      : supa

    let inserted = 0
    const CHUNK = 500
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK)
      const { error } = await client.from('notifications').insert(slice)
      if (error) {
        return noStore(NextResponse.json({ ok: false, error: 'INSERT_FAILED', details: error.message }, { status: 500 }))
      }
      inserted += slice.length
    }

    return noStore(
      NextResponse.json({
        ok: true,
        count: inserted,
        audience,
        audience_label: audienceLabel(audience),
        eligible_roles: eligibleRoles,
        delivery_feedback: {
          requested_user_ids: requestedUserIds,
          requested_emails: requestedEmails,
          matched_email_profiles: matchedEmailProfiles,
          filtered_out_user_ids: filteredOutUserIds,
          unmatched_email_count: unmatchedEmails.length,
          unmatched_emails: unmatchedEmails.slice(0, 10),
          deduped_recipient_count: recipientIds.size,
        },
      }),
    )
  } catch (e: any) {
    return noStore(NextResponse.json({ ok: false, error: e?.message || 'SERVER_ERROR' }, { status: 500 }))
  }
}
