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

export type ProspectMessageTemplateRow = {
  id: string
  channel: 'whatsapp' | 'email'
  template_key: 'first_contact' | 'follow_up' | 'trial_reminder'
  language: 'en' | 'ar'
  label: string
  subject_template: string | null
  body_template: string
  is_active: boolean
  updated_at: string
}

export type ProspectMonthlyArchiveRow = {
  month_start: string
  submissions_count: number
  unique_prospects_count: number
  contact_us_count: number
  visitor_information_count: number
  unknown_count: number
  gmail_backfill_count: number
  website_api_count: number
  manual_count: number
}

export type ProspectMemberReconciliationRow = {
  prospect_id: string
  reconciliation_state: 'linked' | 'unique_match' | 'ambiguous' | 'unmatched'
  match_basis: 'linked' | 'email_and_phone' | 'email' | 'phone' | null
  candidate_count: number
  member_user_id: string | null
  member_code: string | null
  member_full_name: string | null
  member_email: string | null
  member_phone: string | null
  member_created_at: string | null
  first_membership_start_date: string | null
  first_membership_created_at: string | null
  first_paid_membership_start_date: string | null
  subscription_count: number
  has_membership_history: boolean
  has_active_membership: boolean
  became_member_after_prospect: boolean
  days_to_first_membership: number | null
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
  let messageTemplates: ProspectMessageTemplateRow[] = []
  let monthlyArchive: ProspectMonthlyArchiveRow[] = []
  let memberReconciliation: ProspectMemberReconciliationRow[] = []
  let loadError: string | null = null

  try {
    const admin = getSupabaseAdminClientCached() as any

    const [prospectsResult, staffResult, templatesResult, monthlyArchiveResult, reconciliationResult] = await Promise.all([
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
      admin
        .from('prospect_message_templates')
        .select('id,channel,template_key,language,label,subject_template,body_template,is_active,updated_at')
        .eq('is_active', true)
        .order('channel', { ascending: true })
        .order('template_key', { ascending: true })
        .order('language', { ascending: true }),
      admin.rpc('prospect_submission_monthly_summary'),
      admin.rpc('prospect_member_reconciliation'),
    ])

    if (prospectsResult.error) throw new Error(prospectsResult.error.message)
    if (staffResult.error) throw new Error(staffResult.error.message)
    if (templatesResult.error) throw new Error(templatesResult.error.message)
    if (monthlyArchiveResult.error) throw new Error(monthlyArchiveResult.error.message)
    if (reconciliationResult.error) throw new Error(reconciliationResult.error.message)

    prospects = ((prospectsResult.data ?? []) as Array<Omit<ProspectRow, 'linked_visitor_trial_date'>>).map(
      (row) => ({ ...row, linked_visitor_trial_date: null }),
    )
    staff = (staffResult.data ?? []) as FrontDeskStaffRow[]
    messageTemplates = (templatesResult.data ?? []) as ProspectMessageTemplateRow[]
    monthlyArchive = ((monthlyArchiveResult.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      month_start: String(row.month_start ?? ''),
      submissions_count: Number(row.submissions_count ?? 0),
      unique_prospects_count: Number(row.unique_prospects_count ?? 0),
      contact_us_count: Number(row.contact_us_count ?? 0),
      visitor_information_count: Number(row.visitor_information_count ?? 0),
      unknown_count: Number(row.unknown_count ?? 0),
      gmail_backfill_count: Number(row.gmail_backfill_count ?? 0),
      website_api_count: Number(row.website_api_count ?? 0),
      manual_count: Number(row.manual_count ?? 0),
    }))
    memberReconciliation = ((reconciliationResult.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      prospect_id: String(row.prospect_id ?? ''),
      reconciliation_state: String(row.reconciliation_state ?? 'unmatched') as ProspectMemberReconciliationRow['reconciliation_state'],
      match_basis: row.match_basis ? String(row.match_basis) as ProspectMemberReconciliationRow['match_basis'] : null,
      candidate_count: Number(row.candidate_count ?? 0),
      member_user_id: row.member_user_id ? String(row.member_user_id) : null,
      member_code: row.member_code ? String(row.member_code) : null,
      member_full_name: row.member_full_name ? String(row.member_full_name) : null,
      member_email: row.member_email ? String(row.member_email) : null,
      member_phone: row.member_phone ? String(row.member_phone) : null,
      member_created_at: row.member_created_at ? String(row.member_created_at) : null,
      first_membership_start_date: row.first_membership_start_date ? String(row.first_membership_start_date) : null,
      first_membership_created_at: row.first_membership_created_at ? String(row.first_membership_created_at) : null,
      first_paid_membership_start_date: row.first_paid_membership_start_date ? String(row.first_paid_membership_start_date) : null,
      subscription_count: Number(row.subscription_count ?? 0),
      has_membership_history: Boolean(row.has_membership_history),
      has_active_membership: Boolean(row.has_active_membership),
      became_member_after_prospect: Boolean(row.became_member_after_prospect),
      days_to_first_membership: row.days_to_first_membership === null || row.days_to_first_membership === undefined
        ? null
        : Number(row.days_to_first_membership),
    }))

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
            canEditTemplates={canImportProspects(me.role)}
            prospects={prospects}
            submissions={submissions}
            activities={activities}
            staff={staff}
            initialMessageTemplates={messageTemplates}
            monthlyArchive={monthlyArchive}
            memberReconciliation={memberReconciliation}
          />
        )}
      </Section>
    </main>
  )
}
