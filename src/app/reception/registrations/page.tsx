export const dynamic = 'force-dynamic'
export const revalidate = 0

import Link from 'next/link'
import { redirect } from 'next/navigation'
import Forbidden from '@/components/Forbidden'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import { canAccessReceptionDesk } from '@/lib/rbac'
import { getSessionUserCached, getSupabaseAdminClientCached } from '@/lib/requestCache'

type RegistrationRow = {
  id: string
  participant_first_name: string
  participant_last_name: string
  is_minor: boolean
  status: string
  submitted_at: string | null
  identity_verified_at: string | null
  invitation_dispatched_at: string | null
  account_activated_at: string | null
}

function stage(row: RegistrationRow) {
  if (row.account_activated_at && row.status === 'completed') return { label: 'Account activated', color: 'text-emerald-800 bg-emerald-50' }
  if (['failed', 'rejected'].includes(row.status)) return { label: 'Needs admin review', color: 'text-amber-900 bg-amber-50' }
  if (row.status === 'expired') return { label: 'Expired — admin review', color: 'text-amber-900 bg-amber-50' }
  if (row.status === 'completed' && !row.account_activated_at) return { label: 'Needs admin review', color: 'text-amber-900 bg-amber-50' }
  if (row.status === 'provisioning' || row.status === 'under_review') return { label: 'Account setup in progress', color: 'text-sky-900 bg-sky-50' }
  if (row.invitation_dispatched_at) return { label: 'Waiting for account setup', color: 'text-sky-900 bg-sky-50' }
  if (row.status === 'invitation_pending') return { label: 'Preparing invitation', color: 'text-sky-900 bg-sky-50' }
  if (row.identity_verified_at) return { label: 'Email verified — admin review', color: 'text-amber-900 bg-amber-50' }
  return { label: 'Waiting for email verification', color: 'text-slate-700 bg-slate-100' }
}

export default async function RegistrationDeskPage() {
  const me = await getSessionUserCached()
  if (!me) redirect('/login?next=/reception/registrations')
  if (!canAccessReceptionDesk(me.role)) return (
    <Forbidden pageTitle="Registration Desk" signedInAs={me.email}
      message="Only authorized reception staff can access registration follow-up."
      allowed="reception, admin, super_admin" nextPath="/reception/registrations" />
  )

  const admin = getSupabaseAdminClientCached()
  const result = await admin.from('atom_public_registration_requests')
    .select('id,participant_first_name,participant_last_name,is_minor,status,submitted_at,identity_verified_at,invitation_dispatched_at,account_activated_at')
    .order('submitted_at', { ascending: false }).limit(30)
  const rows = (result.data || []) as RegistrationRow[]

  return (
    <main>
      <PageHeader title="Registration Desk" subtitle="Adult and family registration follow-up — read-only preview" />
      <Section className="space-y-5">
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950" role="status">
          <strong>Safe preview.</strong> Online submission and account provisioning are not enabled here. No invitation, registration or payment is triggered by this page.
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-[hsl(var(--border))] p-5">
            <h2 className="text-lg font-semibold">Adult registration</h2>
            <p className="mt-1 text-sm text-[hsl(var(--muted))]">Use the current reception workflow while the public journey is being tested.</p>
            <Link href="/kiosk" className="mt-4 inline-block rounded-xl bg-black px-4 py-3 text-sm font-semibold text-white">Open current registration</Link>
          </div>
          <div className="rounded-2xl border border-[hsl(var(--border))] p-5">
            <h2 className="text-lg font-semibold">Parent & child</h2>
            <p className="mt-1 text-sm text-[hsl(var(--muted))]">Use the existing supervised family intake and conversion tools.</p>
            <Link href="/admin/members/family-operations" className="mt-4 inline-block rounded-xl bg-black px-4 py-3 text-sm font-semibold text-white">Open Family Operations</Link>
          </div>
        </div>
        <div className="rounded-2xl border border-[hsl(var(--border))] p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h2 className="text-lg font-semibold">Recent online registration requests</h2>
              <p className="mt-1 text-xs text-[hsl(var(--muted))]">Latest 30 only · No automatic action · Sensitive account recovery remains Super Admin-only.</p></div>
            <Link className="text-sm underline underline-offset-4" href="/reception">Reception home</Link>
          </div>
          {result.error ? <p className="mt-4 text-sm text-red-700" role="alert">Requests cannot be loaded. Please contact an administrator.</p> :
            rows.length === 0 ? <p className="mt-4 text-sm text-[hsl(var(--muted))]">No public registration requests to display.</p> :
            <div className="mt-4 space-y-2">
              {rows.map(row => { const s = stage(row); return (
                <div key={row.id} className="flex flex-col gap-2 rounded-xl border border-[hsl(var(--border))] p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-medium">{row.participant_first_name} {row.participant_last_name}</p>
                    <p className="text-xs text-[hsl(var(--muted))]">{row.is_minor ? 'Parent & child' : 'Adult'} · {row.submitted_at ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', dateStyle: 'medium' }).format(new Date(row.submitted_at)) : 'Date unavailable'}</p>
                  </div>
                  <span className={`inline-flex self-start rounded-full px-3 py-1 text-xs font-semibold sm:self-auto ${s.color}`}>{s.label}</span>
                </div>
              ) })}
            </div>}
        </div>
      </Section>
    </main>
  )
}
