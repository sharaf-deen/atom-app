export const dynamic = 'force-dynamic'
export const revalidate = 0

import { redirect } from 'next/navigation'
import Forbidden from '@/components/Forbidden'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import { canAccessReceptionDesk } from '@/lib/rbac'
import { getSessionUserCached, getSupabaseAdminClientCached } from '@/lib/requestCache'
import RegistrationDeskClient from './RegistrationDeskClient'

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
      <PageHeader title="Registration Desk" subtitle="Adult and family intake, with clear next steps" />
      <Section className="space-y-5">
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950" role="status">
          <strong>Safe preview.</strong> Online submission and account provisioning are not enabled here. No invitation, registration or payment is triggered by this page.
        </div>
        <RegistrationDeskClient rows={rows.map(row => ({
          id: row.id,
          name: `${row.participant_first_name} ${row.participant_last_name}`.trim(),
          kind: row.is_minor ? 'family' : 'adult',
          status: stage(row).label,
          tone: stage(row).color,
          date: row.submitted_at ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', dateStyle: 'medium' }).format(new Date(row.submitted_at)) : 'Date unavailable',
        }))} loadError={Boolean(result.error)} />
      </Section>
    </main>
  )
}
