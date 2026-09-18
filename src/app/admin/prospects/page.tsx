export const dynamic = 'force-dynamic'
export const revalidate = 0

import { redirect } from 'next/navigation'
import Forbidden from '@/components/Forbidden'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import ProspectsManager from '@/components/admin/ProspectsManager'
import { canAccessProspects, canImportProspects, canManageProspects } from '@/lib/rbac'
import { getSessionUserCached, getSupabaseAdminClientCached } from '@/lib/requestCache'

export type ProspectRow = {
  id: string
  full_name: string
  email: string | null
  email_normalized: string | null
  phone: string | null
  phone_digits: string | null
  status: 'new' | 'contacted' | 'awaiting_reply' | 'trial_booked' | 'trial_completed' | 'joined' | 'lost'
  lost_reason: 'no_response' | 'not_interested' | 'invalid' | 'spam' | 'other' | null
  assigned_to: string | null
  next_follow_up_at: string | null
  last_contacted_at: string | null
  linked_visitor_trial_id: string | null
  linked_visitor_trial_date: string | null
  linked_member_id: string | null
  converted_at: string | null
  converted_by: string | null
  first_seen_at: string
  last_submission_at: string
  created_at: string
  updated_at: string
}

export type ProspectSubmissionRow = {
  id: string
  prospect_id: string
  source: 'contact_us' | 'visitor_information' | 'unknown'
  ingest_channel: 'gmail_backfill' | 'website_api' | 'manual'
  submitted_name: string | null
  submitted_email: string | null
  submitted_phone: string | null
  requested_classes: string[]
  submitted_level: string | null
  goals: string[]
  message: string | null
  gmail_message_id: string | null
  gmail_thread_id: string | null
  received_at: string
  created_at: string
}

export type ProspectActivityRow = {
  id: string
  prospect_id: string
  submission_id: string | null
  activity_type: string
  summary: string
  details: Record<string, unknown>
  actor_user_id: string | null
  occurred_at: string
  created_at: string
}

export type FrontDeskStaffRow = {
  user_id: string
  first_name: string | null
  last_name: string | null
  email: string | null
  role: 'reception' | 'admin' | 'super_admin'
}

export default async function AdminProspectsPage() {
  const me = await getSessionUserCached()
  const nextPath = '/admin/prospects'

  if (!me) redirect(`/login?next=${encodeURIComponent(nextPath)}`)

  if (!canAccessProspects(me.role)) {
    return (
      <Forbidden
        pageTitle="Prospects"
        subtitle="Website enquiries and follow-up pipeline."
        nextPath={nextPath}
        allowed="reception, admin, super_admin"
        signedInAs={me.email}
        actions={[{ href: '/', label: 'Go Home' }, { href: '/admin/crm', label: 'CRM' }]}
      />
    )
  }

  let prospects: ProspectRow[] = []
  let submissions: ProspectSubmissionRow[] = []
  let activities: ProspectActivityRow[] = []
  let staff: FrontDeskStaffRow[] = []
  let loadError: string | null = null

  try {
    const admin = getSupabaseAdminClientCached() as any

    const [prospectsResult, staffResult] = await Promise.all([
      admin
        .from('prospects')
        .select(
          'id,full_name,email,email_normalized,phone,phone_digits,status,lost_reason,assigned_to,next_follow_up_at,last_contacted_at,linked_visitor_trial_id,linked_member_id,converted_at,converted_by,first_seen_at,last_submission_at,created_at,updated_at',
        )
        .order('last_submission_at', { ascending: false })
        .limit(1000),
      admin
        .from('profiles')
        .select('user_id,first_name,last_name,email,role')
        .in('role', ['reception', 'admin', 'super_admin'])
        .order('first_name', { ascending: true })
        .limit(200),
    ])

    if (prospectsResult.error) throw new Error(prospectsResult.error.message)
    if (staffResult.error) throw new Error(staffResult.error.message)

    prospects = ((prospectsResult.data ?? []) as Array<Omit<ProspectRow, 'linked_visitor_trial_date'>>).map(
      (row) => ({ ...row, linked_visitor_trial_date: null }),
    )
    staff = (staffResult.data ?? []) as FrontDeskStaffRow[]

    const ids = prospects.map((row) => row.id)

    if (ids.length) {
      const visitorIds = Array.from(new Set(
        prospects
          .map((row) => row.linked_visitor_trial_id)
          .filter((id): id is string => Boolean(id)),
      ))
      const visitorIdBatches: string[][] = []
      for (let index = 0; index < visitorIds.length; index += 150) {
        visitorIdBatches.push(visitorIds.slice(index, index + 150))
      }

      const [submissionsResult, activitiesResult, visitorBatchResults] = await Promise.all([
        admin
          .from('prospect_submissions')
          .select(
            'id,prospect_id,source,ingest_channel,submitted_name,submitted_email,submitted_phone,requested_classes,submitted_level,goals,message,gmail_message_id,gmail_thread_id,received_at,created_at',
          )
          .in('prospect_id', ids)
          .order('received_at', { ascending: false })
          .limit(4000),
        admin
          .from('prospect_activities')
          .select('id,prospect_id,submission_id,activity_type,summary,details,actor_user_id,occurred_at,created_at')
          .in('prospect_id', ids)
          .order('occurred_at', { ascending: false })
          .limit(5000),
        Promise.all(
          visitorIdBatches.map((batch) => admin
            .from('visitor_trials')
            .select('id,trial_date')
            .in('id', batch)
            .limit(150)),
        ),
      ])

      if (submissionsResult.error) throw new Error(submissionsResult.error.message)
      if (activitiesResult.error) throw new Error(activitiesResult.error.message)
      const visitorError = visitorBatchResults.find((result: { error: { message: string } | null }) => result.error)?.error
      if (visitorError) throw new Error(visitorError.message)

      submissions = (submissionsResult.data ?? []) as ProspectSubmissionRow[]
      activities = (activitiesResult.data ?? []) as ProspectActivityRow[]

      const trialDateByVisitor = new Map<string, string | null>(
        visitorBatchResults
          .flatMap((result: { data: Array<{ id: string; trial_date: string | null }> | null }) => result.data ?? [])
          .map((row: { id: string; trial_date: string | null }) => [row.id, row.trial_date ?? null]),
      )
      prospects = prospects.map((row) => ({
        ...row,
        linked_visitor_trial_date: row.linked_visitor_trial_id
          ? trialDateByVisitor.get(row.linked_visitor_trial_id) ?? null
          : null,
      }))
    }
  } catch (error: any) {
    loadError = String(error?.message ?? error ?? 'Failed to load prospects.')
  }

  return (
    <main>
      <PageHeader
        title="Prospects"
        subtitle="Website enquiries, contact history and front-desk follow-up."
      />

      <Section className="max-w-7xl space-y-4">
        {loadError ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            Failed to load prospects: {loadError}
          </div>
        ) : (
          <ProspectsManager
            currentUserId={me.id}
            canManage={canManageProspects(me.role)}
            canImport={canImportProspects(me.role)}
            prospects={prospects}
            submissions={submissions}
            activities={activities}
            staff={staff}
          />
        )}
      </Section>
    </main>
  )
}
