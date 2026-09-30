import { ExternalLink, FileCheck2 } from 'lucide-react'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import type { Role } from '@/lib/session'
import LegalConsentBackfillForm from '@/components/legal/LegalConsentBackfillForm'

type DocumentRow = {
  id: string
  document_key: string
  title: string
  version_label: string
  published_url: string
  status: 'draft' | 'active' | 'retired'
  is_required: boolean
}

type AcceptanceRow = {
  id: string
  document_version_id: string
  document_title_snapshot: string
  document_version_snapshot: string
  document_url_snapshot: string
  accepted_at: string
  acceptor_name: string
  acceptor_capacity: 'participant' | 'parent' | 'legal_guardian'
  guardian_relationship: string | null
  source: string
}

function fmtDateTime(value?: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function capacityLabel(value: AcceptanceRow['acceptor_capacity']) {
  if (value === 'legal_guardian') return 'Legal guardian'
  if (value === 'parent') return 'Parent'
  return 'Participant'
}

export default async function MemberLegalConsentsSection({
  memberUserId,
  viewerRole,
  isSelf,
}: {
  memberUserId: string
  viewerRole: Role
  isSelf: boolean
}) {
  const canView = isSelf || ['reception', 'admin', 'super_admin', 'head_coach'].includes(String(viewerRole))
  if (!canView) return null

  const canStaffRecord = ['reception', 'admin', 'super_admin', 'head_coach'].includes(String(viewerRole))
  const admin = createSupabaseAdminClient()

  const [
    { data: documents, error: documentsError },
    { data: acceptances, error: acceptancesError },
    { data: profile, error: profileError },
  ] = await Promise.all([
    admin
      .from('legal_document_versions')
      .select('id,document_key,title,version_label,published_url,status,is_required')
      .in('status', ['active', 'draft'])
      .order('document_key', { ascending: true }),
    admin
      .from('member_legal_acceptances')
      .select('id,document_version_id,document_title_snapshot,document_version_snapshot,document_url_snapshot,accepted_at,acceptor_name,acceptor_capacity,guardian_relationship,source')
      .eq('member_user_id', memberUserId)
      .order('accepted_at', { ascending: false }),
    admin
      .from('profiles')
      .select('first_name,last_name,date_of_birth')
      .eq('user_id', memberUserId)
      .maybeSingle(),
  ])

  if (documentsError || acceptancesError || profileError) {
    return (
      <section className="rounded-3xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 shadow-soft sm:p-5">
        Legal consent information is temporarily unavailable.
      </section>
    )
  }

  const docs = (documents ?? []) as DocumentRow[]
  const rows = (acceptances ?? []) as AcceptanceRow[]
  const acceptedByVersion = new Map(rows.map((row) => [row.document_version_id, row]))

  const rank: Record<string, number> = {
    privacy_policy: 10,
    terms_of_use: 20,
    liability_waiver: 30,
  }
  docs.sort((a, b) => (rank[a.document_key] ?? 99) - (rank[b.document_key] ?? 99))

  const requiredDocuments = docs.filter((doc) => doc.status === 'active' && doc.is_required)
  const acceptedRequiredCount = requiredDocuments.filter((doc) => acceptedByVersion.has(doc.id)).length
  const complete = requiredDocuments.length === acceptedRequiredCount
  const participantName = `${profile?.first_name ?? ''} ${profile?.last_name ?? ''}`.trim() || 'Member'

  return (
    <section id="legal-consents" className="scroll-mt-24 rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-2">
          <FileCheck2 size={18} className="mt-0.5" />
          <div>
            <h2 className="text-base font-semibold tracking-tight">Legal &amp; consents</h2>
            <p className="mt-1 text-sm text-[hsl(var(--muted))]">
              Current legal status and immutable acceptance history.
            </p>
          </div>
        </div>

        <span
          className={`inline-flex w-fit rounded-full border px-3 py-1 text-xs font-semibold ${
            complete
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border-amber-200 bg-amber-50 text-amber-800'
          }`}
        >
          {complete ? 'Legal status: Complete' : 'Legal status: Action required'}
        </span>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        {docs.map((doc) => {
          const acceptance = acceptedByVersion.get(doc.id) ?? null
          const isDraft = doc.status === 'draft'
          const accepted = !!acceptance
          const requiredNow = doc.status === 'active' && doc.is_required

          return (
            <div key={doc.id} className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="font-semibold">{doc.title}</div>
                <span
                  className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                    isDraft
                      ? 'border-amber-200 bg-amber-50 text-amber-800'
                      : accepted
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        : requiredNow
                          ? 'border-rose-200 bg-rose-50 text-rose-700'
                          : 'border-gray-200 bg-gray-50 text-gray-700'
                  }`}
                >
                  {isDraft ? 'Draft' : accepted ? 'Accepted' : requiredNow ? 'Missing' : 'Not required'}
                </span>
              </div>

              <div className="mt-1 text-xs text-[hsl(var(--muted))]">
                Version {doc.version_label}{requiredNow ? ' · Current required version' : ''}
              </div>

              {acceptance ? (
                <div className="mt-3 text-sm">
                  <div>{fmtDateTime(acceptance.accepted_at)}</div>
                  <div className="mt-1 text-xs text-[hsl(var(--muted))]">
                    {capacityLabel(acceptance.acceptor_capacity)} · {acceptance.acceptor_name}
                    {acceptance.guardian_relationship ? ` · ${acceptance.guardian_relationship}` : ''}
                  </div>
                </div>
              ) : (
                <div className="mt-3 text-sm text-[hsl(var(--muted))]">
                  {requiredNow
                    ? 'No acceptance recorded for this current required version.'
                    : 'No acceptance required for this version.'}
                </div>
              )}

              <a
                href={doc.published_url}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex items-center gap-1 text-xs font-semibold underline underline-offset-2"
              >
                View document <ExternalLink size={12} />
              </a>
            </div>
          )
        })}
      </div>

      {!complete ? (
        <LegalConsentBackfillForm
          memberUserId={memberUserId}
          memberDateOfBirth={profile?.date_of_birth ? String(profile.date_of_birth).slice(0, 10) : null}
          participantName={participantName}
          requiredDocuments={requiredDocuments}
          acceptedDocumentIds={requiredDocuments.filter((doc) => acceptedByVersion.has(doc.id)).map((doc) => doc.id)}
          isSelf={isSelf}
          canStaffRecord={canStaffRecord}
        />
      ) : null}

      {rows.length > 0 ? (
        <details className="mt-4 rounded-2xl border border-[hsl(var(--border))] bg-white">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">
            Acceptance history · {rows.length} record(s)
          </summary>
          <div className="grid gap-2 border-t border-[hsl(var(--border))] p-4">
            {rows.map((row) => (
              <div key={row.id} className="rounded-xl bg-[hsl(var(--bg))] px-3 py-2 text-sm">
                <div className="font-medium">
                  {row.document_title_snapshot} · v{row.document_version_snapshot}
                </div>
                <div className="mt-1 text-xs text-[hsl(var(--muted))]">
                  {fmtDateTime(row.accepted_at)} · {capacityLabel(row.acceptor_capacity)} · {row.acceptor_name}
                  {row.guardian_relationship ? ` · ${row.guardian_relationship}` : ''}
                  {row.source ? ` · ${row.source.replaceAll('_', ' ')}` : ''}
                </div>
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </section>
  )
}
