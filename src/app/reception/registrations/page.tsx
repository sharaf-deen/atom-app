export const dynamic = 'force-dynamic'
export const revalidate = 0

import { redirect } from 'next/navigation'
import Forbidden from '@/components/Forbidden'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import { canAccessReceptionDesk, normalizeRole } from '@/lib/rbac'
import { getSessionUserCached, getSupabaseAdminClientCached } from '@/lib/requestCache'
import RegistrationDeskClient from './RegistrationDeskClient'
import { registrationDeskDisplay, type RegistrationDeskCheckpoint } from '@/lib/registrationDeskIntegrity'

type RegistrationRow = RegistrationDeskCheckpoint & {
  id: string
  participant_first_name: string
  participant_last_name: string
  submitted_at: string | null
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
    .select('id,participant_first_name,participant_last_name,is_minor,status,submitted_at,expires_at,identity_verified_at,provisioning_claim_id,auth_provisioning_started_at,provisioned_auth_user_id,auth_provisioning_recorded_at,member_user_id,family_id,invitation_dispatch_started_at,invitation_dispatched_at,account_activated_at,last_error_code')
    .order('submitted_at', { ascending: false }).limit(30)
  const rows = (result.data || []) as RegistrationRow[]
  const displayRows = rows.map(row => {
    const display = registrationDeskDisplay(row)
    return {
      id: row.id,
      name: `${row.participant_first_name} ${row.participant_last_name}`.trim(),
      kind: row.is_minor ? 'family' as const : 'adult' as const,
      status: display.label,
      tone: display.tone,
      needsReview: display.needsReview,
      nextAction: display.nextAction,
      date: row.submitted_at ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', dateStyle: 'medium' }).format(new Date(row.submitted_at)) : 'Date unavailable',
    }
  })

  return (
    <main>
      <PageHeader title="Registration Desk" subtitle="Adult and family intake, with clear next steps" />
      <Section className="space-y-5">
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950" role="status">
          <strong>Safe preview.</strong> Online submission and account provisioning are not enabled here. No invitation, registration or payment is triggered by this page.
        </div>
        <RegistrationDeskClient rows={displayRows} loadError={Boolean(result.error)} isSuperAdmin={normalizeRole(me.role) === 'super_admin'} />
      </Section>
    </main>
  )
}
