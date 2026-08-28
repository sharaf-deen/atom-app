
export const dynamic = 'force-dynamic'
export const revalidate = 0

import Link from 'next/link'
import { redirect } from 'next/navigation'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import AccessDeniedPage from '@/components/AccessDeniedPage'
import FreezeRequestReviewActions from '@/components/freeze/FreezeRequestReviewActions'
import { getSessionUser } from '@/lib/session'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'

type RequestRow = {
  id: string
  member_user_id: string
  subscription_id: string | null
  requested_start_date: string
  requested_end_date: string | null
  reason: string
  status: 'pending' | 'approved' | 'denied' | 'canceled'
  created_at: string
  request_source: string | null
  admin_note: string | null
}

function fmtDate(value?: string | null) {
  if (!value) return '—'
  const date = new Date(value.length === 10 ? `${value}T00:00:00Z` : value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default async function FreezeRequestsPage() {
  const me = await getSessionUser()
  if (!me) redirect('/login?next=/admin/freeze-requests')
  if (me.role !== 'super_admin') {
    return <AccessDeniedPage title="Freeze Requests" subtitle="Access restricted." signedInAs={me.email} message="Only Super Admin can review and apply member freeze requests." allowed="super_admin" nextPath="/admin/freeze-requests" showBackHome showProfile />
  }

  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('freeze_requests')
    .select('id,member_user_id,subscription_id,requested_start_date,requested_end_date,reason,status,created_at,request_source,admin_note')
    .order('created_at', { ascending: false })
    .limit(200)

  const requests = (data ?? []) as RequestRow[]
  const memberIds = Array.from(new Set(requests.map((row) => row.member_user_id)))
  const { data: members } = memberIds.length
    ? await admin.from('profiles').select('user_id,member_id,first_name,last_name,email').in('user_id', memberIds)
    : { data: [] as any[] }
  const memberMap = new Map((members ?? []).map((m: any) => [m.user_id, m]))

  const pending = requests.filter((r) => r.status === 'pending')
  const history = requests.filter((r) => r.status !== 'pending')

  const renderRow = (row: RequestRow, actionable: boolean) => {
    const member: any = memberMap.get(row.member_user_id)
    const name = member ? `${member.first_name ?? ''} ${member.last_name ?? ''}`.trim() || member.email || 'Member' : 'Member'
    return (
      <article key={row.id} className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-soft">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="font-semibold">{name}</div>
            <div className="mt-0.5 text-sm text-[hsl(var(--muted))]">{member?.member_id ?? row.member_user_id} · {row.request_source === 'guardian' ? 'Parent/guardian request' : 'Member request'}</div>
          </div>
          <span className="rounded-full border bg-gray-50 px-2.5 py-1 text-xs font-medium">{row.status}</span>
        </div>
        <div className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
          <div><div className="text-xs text-[hsl(var(--muted))]">Requested range</div><div className="font-medium">{fmtDate(row.requested_start_date)} → {fmtDate(row.requested_end_date)}</div></div>
          <div><div className="text-xs text-[hsl(var(--muted))]">Requested</div><div className="font-medium">{fmtDate(row.created_at)}</div></div>
          <div><Link href={`/members/${encodeURIComponent(row.member_user_id)}`} className="font-medium underline underline-offset-2">Open member</Link></div>
        </div>
        <div className="mt-3 rounded-xl bg-gray-50 p-3 text-sm">{row.reason}</div>
        {row.admin_note ? <div className="mt-2 text-xs text-[hsl(var(--muted))]">Academy note: {row.admin_note}</div> : null}
        {actionable ? <div className="mt-4"><FreezeRequestReviewActions requestId={row.id} subscriptionId={row.subscription_id} from={row.requested_start_date} to={row.requested_end_date} /></div> : null}
      </article>
    )
  }

  return (
    <main>
      <PageHeader title="Freeze Requests" subtitle="Review member and parent self-service freeze requests." />
      <Section className="space-y-5">
        {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">Could not load freeze requests: {error.message}</div> : null}
        <section className="space-y-3">
          <div><h2 className="text-lg font-semibold">Pending review</h2><p className="mt-1 text-sm text-[hsl(var(--muted))]">Approving uses the existing validated subscription-freeze endpoint and its token/date/overlap guards.</p></div>
          {pending.length ? pending.map((row) => renderRow(row, true)) : <div className="rounded-2xl border p-4 text-sm text-[hsl(var(--muted))]">No pending freeze requests.</div>}
        </section>
        {history.length ? (
          <details className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-soft">
            <summary className="cursor-pointer font-semibold">Recent request history ({history.length})</summary>
            <div className="mt-4 space-y-3">{history.slice(0, 50).map((row) => renderRow(row, false))}</div>
          </details>
        ) : null}
      </Section>
    </main>
  )
}
