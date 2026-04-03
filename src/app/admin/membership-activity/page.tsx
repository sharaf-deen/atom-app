// src/app/admin/membership-activity/page.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import { Card, CardContent } from '@/components/ui/Card'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import Forbidden from '@/components/Forbidden'
import { formatDateTimeInCairo } from '@/lib/cairoTime'
import { getSessionUser, type Role } from '@/lib/session'

type AuditRow = {
  id: string
  created_at: string | null
  action: string
  actor_user_id: string | null
  target_user_id: string
  action_details: any | null
}

type ProfileMini = {
  user_id: string
  email: string | null
  first_name: string | null
  last_name: string | null
  phone: string | null
  role: Role | null
}

const OPS: Role[] = ['admin', 'super_admin']

type ActionTone = 'success' | 'info' | 'warning' | 'danger' | 'neutral'

const TONE_CLS: Record<ActionTone, string> = {
  success: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  info: 'bg-sky-50 text-sky-800 border-sky-200',
  warning: 'bg-amber-50 text-amber-900 border-amber-200',
  danger: 'bg-rose-50 text-rose-800 border-rose-200',
  neutral: 'bg-gray-50 text-gray-800 border-gray-200',
}

function clampInt(v: number, min: number, max: number) {
  if (!Number.isFinite(v)) return min
  return Math.max(min, Math.min(max, Math.floor(v)))
}

function toStr(v: unknown) {
  return typeof v === 'string' ? v : ''
}

function buildQS(params: Record<string, string | number | undefined>) {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue
    const s = String(v)
    if (!s) continue
    sp.set(k, s)
  }
  const q = sp.toString()
  return q ? `?${q}` : ''
}

function displayName(p?: ProfileMini | null) {
  if (!p) return '—'
  const full = [p.first_name ?? '', p.last_name ?? ''].join(' ').trim()
  return full || p.email || p.user_id.slice(0, 8)
}

function fmtWhen(ts: string | null) {
  if (!ts) return '—'
  const formatted = formatDateTimeInCairo(ts)
  return formatted === '—' ? '—' : `${formatted.slice(0, 16)} Cairo`
}

function shortJSON(v: any) {
  if (!v) return ''
  try {
    const s = JSON.stringify(v)
    return s.length > 140 ? s.slice(0, 140) + '…' : s
  } catch {
    return String(v)
  }
}

function titleFromKey(key: string) {
  const clean = (key || '').replace(/[_-]+/g, ' ').trim()
  if (!clean) return 'Activity'
  return clean
    .split(' ')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

function fmtNum(v: any) {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return ''
  // Avoid decimals in EGP by default (your app uses integer EGP values)
  return Math.round(n).toLocaleString('en-US')
}

function actionMeta(actionRaw: string, details: any): { label: string; tone: ActionTone; subtitle?: string; known: boolean } {
  const action = (actionRaw || '').trim().toLowerCase()

  // Known, human-friendly labels
  const MAP: Record<string, { label: string; tone: ActionTone }> = {
    subscription_create: { label: 'Subscription created', tone: 'success' },
    subscription_update: { label: 'Subscription updated', tone: 'info' },
    subscription_due_settle: { label: 'Payment received', tone: 'success' },

    invite_sent: { label: 'Invite sent', tone: 'info' },
    invite_resent: { label: 'Invite resent', tone: 'info' },
    invite_cancelled: { label: 'Invite cancelled', tone: 'warning' },

    subscription_freeze: { label: 'Subscription frozen', tone: 'warning' },
    subscription_resume: { label: 'Subscription resumed', tone: 'success' },

    member_created: { label: 'Member created', tone: 'success' },
    member_updated: { label: 'Member updated', tone: 'info' },
    member_deleted: { label: 'Member deleted', tone: 'danger' },
  }

  const known = !!MAP[action]
  const base = MAP[action] ?? { label: titleFromKey(actionRaw), tone: 'neutral' as ActionTone }

  // Small helpful subtitle (optional) for the most common membership events
  let subtitle = ''
  try {
    if (action === 'subscription_create') {
      const paid = fmtNum(details?.amount_paid)
      const due = fmtNum(details?.amount_due)
      const plan = details?.plan ? String(details.plan) : ''
      const pm = details?.payment_method ? String(details.payment_method) : ''
      subtitle = [plan ? `Plan: ${plan}` : '', paid ? `Paid: ${paid}` : '', due ? `Due: ${due}` : '', pm ? `Method: ${pm}` : '']
        .filter(Boolean)
        .join(' · ')
    } else if (action === 'subscription_due_settle') {
      const paidNow = fmtNum(details?.paid_now)
      const newDue = fmtNum(details?.new_due)
      const pm = details?.payment_method ? String(details.payment_method) : ''
      subtitle = [paidNow ? `Paid now: ${paidNow}` : '', newDue ? `New due: ${newDue}` : '', pm ? `Method: ${pm}` : '']
        .filter(Boolean)
        .join(' · ')
    } else if (action.includes('invite')) {
      const email = details?.email ? String(details.email) : ''
      subtitle = email ? `Email: ${email}` : ''
    }
  } catch {
    subtitle = ''
  }

  return { label: base.label, tone: base.tone, subtitle: subtitle || undefined, known }
}

export default async function MembershipActivityLogPage({
  searchParams,
}: {
  searchParams?: { [key: string]: string | string[] | undefined }
}) {
  const me = await getSessionUser()
  if (!me) redirect('/login?next=/admin/membership-activity')
  if (!OPS.includes(me.role)) {
    return (
      <Forbidden
        pageTitle="Membership Activity Log"
        subtitle="Admins only."
        nextPath="/admin/membership-activity"
        actions={[{ href: '/', label: 'Go Home' }]}
      />
    )
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !service) {
    return (
      <main>
        <PageHeader title="Membership Activity Log" subtitle="Server env missing" />
        <Section className="py-6">
          <Card>
            <CardContent className="p-6 space-y-2">
              <p className="text-sm text-red-600">Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.</p>
              <p className="text-sm text-[hsl(var(--muted-foreground))]">
                This page needs the Service Role key to read the audit log.
              </p>
            </CardContent>
          </Card>
        </Section>
      </main>
    )
  }

  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } })

  const q = toStr(searchParams?.q)
  const action = toStr(searchParams?.action)
  const actor = toStr(searchParams?.actor)
  const from = toStr(searchParams?.from) // YYYY-MM-DD
  const to = toStr(searchParams?.to) // YYYY-MM-DD
  const page = clampInt(Number(toStr(searchParams?.page) || '1'), 1, 9999)
  const pageSize = clampInt(Number(toStr(searchParams?.pageSize) || '50'), 10, 200)

  // 1) Resolve optional target user ids by search query
  let targetIds: string[] | null = null
  if (q) {
    const { data: matches, error } = await admin
      .from('profiles')
      .select('user_id')
      .or(
        [
          `email.ilike.%${q}%`,
          `first_name.ilike.%${q}%`,
          `last_name.ilike.%${q}%`,
          `phone.ilike.%${q}%`,
          `member_id.ilike.%${q}%`,
        ].join(',')
      )
      .limit(200)

    if (error) {
      console.error('profiles search error:', error.message)
      targetIds = []
    } else {
      targetIds = (matches ?? []).map((r: any) => r.user_id).filter(Boolean)
      if (targetIds.length === 0) targetIds = []
    }
  }

  // 2) Resolve optional actor ids by actor search
  let actorIds: string[] | null = null
  if (actor) {
    const { data: matches, error } = await admin
      .from('profiles')
      .select('user_id')
      .or(
        [
          `email.ilike.%${actor}%`,
          `first_name.ilike.%${actor}%`,
          `last_name.ilike.%${actor}%`,
          `phone.ilike.%${actor}%`,
        ].join(',')
      )
      .limit(200)

    if (error) {
      console.error('actor search error:', error.message)
      actorIds = []
    } else {
      actorIds = (matches ?? []).map((r: any) => r.user_id).filter(Boolean)
      if (actorIds.length === 0) actorIds = []
    }
  }

  // 3) Query audit logs
  const fromRow = (page - 1) * pageSize
  const toRow = fromRow + pageSize - 1

  let query = admin
    .from('audit_logs')
    .select('id,created_at,action,actor_user_id,target_user_id,action_details', { count: 'exact' })
    .order('created_at', { ascending: false })

  // Membership-focused defaults: hide obvious non-membership noise if any
  // (still overridable by filtering action)
  if (!action) {
    query = query.not('action', 'ilike', '%expense%').not('action', 'ilike', '%store%')
  }

  if (action) query = query.ilike('action', `%${action}%`)
  if (from) query = query.gte('created_at', `${from}T00:00:00Z`)
  if (to) query = query.lte('created_at', `${to}T23:59:59Z`)

  if (targetIds) {
    if (targetIds.length === 0) {
      // No matches -> empty result
      query = query.in('target_user_id', ['00000000-0000-0000-0000-000000000000'])
    } else {
      query = query.in('target_user_id', targetIds)
    }
  }
  if (actorIds) {
    if (actorIds.length === 0) {
      query = query.in('actor_user_id', ['00000000-0000-0000-0000-000000000000'])
    } else {
      query = query.in('actor_user_id', actorIds)
    }
  }

  const { data: rowsRaw, error: aErr, count } = await query.range(fromRow, toRow)
  if (aErr) {
    console.error('audit_logs error:', aErr.message)
  }
  const rows = (rowsRaw ?? []) as AuditRow[]

  // 4) Fetch profile minis for actor + target ids
  const ids = Array.from(
    new Set(
      rows
        .flatMap((r) => [r.target_user_id, r.actor_user_id ?? ''])
        .filter(Boolean)
        .filter(Boolean)
    )
  )

  const profilesById = new Map<string, ProfileMini>()
  if (ids.length) {
    const { data: profs, error: pErr } = await admin
      .from('profiles')
      .select('user_id,email,first_name,last_name,phone,role')
      .in('user_id', ids)
      .limit(400)

    if (pErr) console.error('profiles map error:', pErr.message)
    for (const p of (profs ?? []) as any[]) profilesById.set(p.user_id, p as ProfileMini)
  }

  const total = count ?? 0
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  const baseParams = { q, action, actor, from, to, pageSize }
  const prevHref = page > 1 ? `/admin/membership-activity${buildQS({ ...baseParams, page: page - 1 })}` : ''
  const nextHref = page < totalPages ? `/admin/membership-activity${buildQS({ ...baseParams, page: page + 1 })}` : ''

  return (
    <main>
      <PageHeader
        title="Membership Activity Log"
        subtitle="Subscriptions, invites and status changes."
        showReload={false}
        right={
          <div className="flex items-center gap-2">
            <Badge className="text-[11px]">{total} rows</Badge>
            <Badge className="text-[11px]">
              Page {page}/{totalPages}
            </Badge>
          </div>
        }
      />

      <Section className="py-6 space-y-4">
        <Card>
          <CardContent className="p-4">
            <form className="grid gap-3 md:grid-cols-6" action="/admin/membership-activity" method="get">
              <Input
                label="Member search"
                placeholder="name, email, phone or member ID"
                name="q"
                defaultValue={q}
                className="md:col-span-2"
              />
              <Input label="Action" placeholder="subscription, invite, freeze" name="action" defaultValue={action} className="md:col-span-1" />
              <Input label="Actor" placeholder="admin name or email" name="actor" defaultValue={actor} className="md:col-span-1" />
              <Input label="From" type="date" name="from" defaultValue={from} className="md:col-span-1" />
              <Input label="To" type="date" name="to" defaultValue={to} className="md:col-span-1" />

              <div className="md:col-span-6 flex flex-wrap items-end gap-2 pt-1">
                <Select label="Page size" name="pageSize" defaultValue={String(pageSize)} className="w-[150px]">
                  <option value="25">25</option>
                  <option value="50">50</option>
                  <option value="100">100</option>
                  <option value="200">200</option>
                </Select>

                <div className="flex-1" />
                <Button type="submit">Apply</Button>
                <Link href="/admin/membership-activity">
                  <Button type="button" variant="outline">
                    Reset
                  </Button>
                </Link>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <table className="min-w-[980px] w-full text-sm">
              <thead className="sticky top-0 bg-[hsl(var(--bg))] border-b border-[hsl(var(--border))]">
                <tr className="text-left">
                  <th className="px-4 py-3 w-[170px]">When</th>
                  <th className="px-4 py-3 w-[220px]">Member</th>
                  <th className="px-4 py-3 w-[240px]">Action</th>
                  <th className="px-4 py-3 w-[220px]">Actor</th>
                  <th className="px-4 py-3">Details</th>
                  <th className="px-4 py-3 w-[110px]">Open</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-[hsl(var(--muted-foreground))]">
                      No activity found for the selected filters.
                    </td>
                  </tr>
                )}

                {rows.map((r) => {
                  const member = profilesById.get(r.target_user_id) ?? null
                  const actorP = r.actor_user_id ? profilesById.get(r.actor_user_id) ?? null : null
                  const meta = actionMeta(r.action, r.action_details)
                  const badgeCls = `${TONE_CLS[meta.tone]} text-[11px]`
                  return (
                    <tr key={r.id} className="border-b border-[hsl(var(--border))] hover:bg-[hsl(var(--card))]">
                      <td className="px-4 py-3 whitespace-nowrap">{fmtWhen(r.created_at)}</td>
                      <td className="px-4 py-3">
                        <div className="font-medium">{displayName(member)}</div>
                        <div className="text-xs text-[hsl(var(--muted-foreground))]">{member?.email ?? r.target_user_id}</div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge className={badgeCls}>{meta.label}</Badge>
                        {meta.subtitle ? (
                          <div className="mt-1 text-[11px] text-[hsl(var(--muted-foreground))]">{meta.subtitle}</div>
                        ) : null}
                        {!meta.known ? (
                          <div className="mt-1 text-[11px] text-[hsl(var(--muted-foreground))]">Key: {r.action}</div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium">
                          {actorP ? displayName(actorP) : r.actor_user_id ? r.actor_user_id.slice(0, 8) : 'system'}
                        </div>
                        <div className="text-xs text-[hsl(var(--muted-foreground))]">{actorP?.email ?? ''}</div>
                      </td>
                      <td className="px-4 py-3 text-xs text-[hsl(var(--muted-foreground))]">{shortJSON(r.action_details)}</td>
                      <td className="px-4 py-3">
                        <Link href={`/members/${r.target_user_id}`}>
                          <Button size="sm" variant="outline">
                            Member
                          </Button>
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <div className="flex items-center justify-between">
          <div className="text-sm text-[hsl(var(--muted-foreground))]">
            Showing {rows.length} of {total} rows
          </div>
          <div className="flex items-center gap-2">
            <Link href={prevHref || '#'} aria-disabled={!prevHref} className={!prevHref ? 'pointer-events-none opacity-50' : ''}>
              <Button variant="outline">Prev</Button>
            </Link>
            <Link href={nextHref || '#'} aria-disabled={!nextHref} className={!nextHref ? 'pointer-events-none opacity-50' : ''}>
              <Button variant="outline">Next</Button>
            </Link>
          </div>
        </div>
      </Section>
    </main>
  )
}
