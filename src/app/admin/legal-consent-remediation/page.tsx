export const dynamic = 'force-dynamic'
export const revalidate = 0

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/session'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import { cairoToday } from '@/lib/cairoDate'

type Profile = {
  user_id: string
  member_id: string | null
  first_name: string | null
  last_name: string | null
  date_of_birth: string | null
}
type Doc = { id: string; title: string; version_label: string }
type Acceptance = { member_user_id: string; document_version_id: string }
type Candidate = { profile: Profile; missing: Doc[]; accepted: number; group: 'minor' | 'adult' | 'unknown' }

const STAFF = new Set(['reception', 'admin', 'super_admin', 'head_coach'])
const PAGE_SIZE = 30

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}
function cairoAge(dob: string | null, today: string): number | null {
  if (!dob || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) return null
  const birth = new Date(`${dob}T00:00:00Z`)
  if (Number.isNaN(birth.getTime()) || birth.toISOString().slice(0, 10) !== dob || dob > today) return null
  const years = Number(today.slice(0, 4)) - Number(dob.slice(0, 4))
  const birthday = dob.slice(5)
  return years - (today.slice(5) < birthday ? 1 : 0)
}
async function fetchActiveMemberIds(admin: ReturnType<typeof createSupabaseAdminClient>) {
  const ids = new Set<string>()
  for (let start = 0; ; start += 1000) {
    const { data, error } = await admin.from('subscriptions').select('member_id').eq('status', 'active').range(start, start + 999)
    if (error) throw new Error('Unable to load active subscriptions.')
    for (const row of data ?? []) if (row.member_id) ids.add(row.member_id)
    if ((data ?? []).length < 1000) break
    if (start >= 99000) throw new Error('Subscription query safety limit reached.')
  }
  return [...ids]
}

export default async function LegalConsentRemediationPage({
  searchParams,
}: {
  searchParams?: { q?: string | string[]; group?: string | string[]; progress?: string | string[]; order?: string | string[]; page?: string | string[] }
}) {
  const me = await getSessionUser()
  if (!me) redirect('/login?next=/admin/legal-consent-remediation')
  if (!STAFF.has(me.role)) {
    return <main className="mx-auto max-w-4xl p-6"><h1 className="text-xl font-semibold">Access restricted</h1><p>Authorized staff only.</p></main>
  }

  const q = (first(searchParams?.q) ?? '').trim().slice(0, 100)
  const rawGroup = first(searchParams?.group) ?? 'all'
  const group = ['all', 'minor', 'adult', 'unknown'].includes(rawGroup) ? rawGroup : 'all'
  const rawProgress = first(searchParams?.progress) ?? 'all'
  const progress = ['all', 'not_started', 'partial'].includes(rawProgress) ? rawProgress : 'all'
  const rawOrder = first(searchParams?.order) ?? 'priority'
  const order = ['priority', 'name'].includes(rawOrder) ? rawOrder : 'priority'
  const rawPage = Number(first(searchParams?.page) ?? 1)
  const page = Number.isSafeInteger(rawPage) ? Math.max(1, Math.min(rawPage, 10000)) : 1
  const today = cairoToday()

  let candidates: Candidate[] = []
  let totalActive = 0
  let requiredCount = 0
  let unknownCount = 0
  let minorCount = 0
  let notStartedCount = 0
  let partialCount = 0
  let errorMessage: string | null = null
  try {
    const admin = createSupabaseAdminClient()
    const { data: docsData, error: docsError } = await admin.from('legal_document_versions')
      .select('id,title,version_label').eq('status', 'active').eq('is_required', true)
    if (docsError) throw new Error('Legal document lookup failed.')
    const docs = (docsData ?? []) as Doc[]
    requiredCount = docs.length
    if (!requiredCount) throw new Error('No active required legal documents found. Verify configuration before reviewing compliance.')
    const ids = await fetchActiveMemberIds(admin)
    totalActive = ids.length
    const profileRows: Profile[] = []
    const acceptedRows: Acceptance[] = []
    for (let start = 0; start < ids.length; start += 150) {
      const chunk = ids.slice(start, start + 150)
      const [{ data: profiles, error: profilesError }, { data: acceptances, error: acceptancesError }] = await Promise.all([
        admin.from('profiles').select('user_id,member_id,first_name,last_name,date_of_birth').in('user_id', chunk),
        admin.from('member_legal_acceptances').select('member_user_id,document_version_id')
          .in('member_user_id', chunk).in('document_version_id', docs.map((d) => d.id)),
      ])
      if (profilesError || acceptancesError) throw new Error('Member compliance lookup failed.')
      profileRows.push(...((profiles ?? []) as Profile[]))
      acceptedRows.push(...((acceptances ?? []) as Acceptance[]))
    }
    const profilesById = new Map(profileRows.map((p) => [p.user_id, p]))
    const acceptedById = new Map<string, Set<string>>()
    for (const acceptance of acceptedRows) {
      const set = acceptedById.get(acceptance.member_user_id) ?? new Set<string>()
      set.add(acceptance.document_version_id)
      acceptedById.set(acceptance.member_user_id, set)
    }
    for (const id of ids) {
      const profile = profilesById.get(id)
      if (!profile) throw new Error('An active member has no profile; review data integrity.')
      const accepted = acceptedById.get(id) ?? new Set<string>()
      const missing = docs.filter((doc) => !accepted.has(doc.id))
      if (!missing.length) continue
      const age = cairoAge(profile.date_of_birth, today)
      const kind: Candidate['group'] = age === null ? 'unknown' : age < 18 ? 'minor' : 'adult'
      if (kind === 'minor') minorCount++
      if (kind === 'unknown') unknownCount++
      if (accepted.size === 0) notStartedCount++
      else partialCount++
      candidates.push({ profile, missing, accepted: docs.length - missing.length, group: kind })
    }
    candidates.sort((a, b) => {
      const priority = (item: Candidate) => item.group === 'unknown' ? 0 : item.group === 'minor' ? 1 : 2
      if (order === 'priority') {
        const byCategory = priority(a) - priority(b)
        if (byCategory) return byCategory
        const byProgress = a.accepted - b.accepted
        if (byProgress) return byProgress
      }
      const an = `${a.profile.first_name ?? ''} ${a.profile.last_name ?? ''}`.trim()
      const bn = `${b.profile.first_name ?? ''} ${b.profile.last_name ?? ''}`.trim()
      return an.localeCompare(bn) || (a.profile.member_id ?? '').localeCompare(b.profile.member_id ?? '')
    })
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : 'Unable to load legal consent data.'
  }

  const filtered = candidates.filter((candidate) => {
    if (group !== 'all' && candidate.group !== group) return false
    if (progress === 'not_started' && candidate.accepted !== 0) return false
    if (progress === 'partial' && candidate.accepted === 0) return false
    if (!q) return true
    return `${candidate.profile.member_id ?? ''} ${candidate.profile.first_name ?? ''} ${candidate.profile.last_name ?? ''}`
      .toLocaleLowerCase().includes(q.toLocaleLowerCase())
  })
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, pages)
  const visible = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
  const pageHref = (p: number) => {
    const params = new URLSearchParams()
    if (q) params.set('q', q)
    if (group !== 'all') params.set('group', group)
    if (progress !== 'all') params.set('progress', progress)
    if (order !== 'priority') params.set('order', order)
    params.set('page', String(p))
    return `/admin/legal-consent-remediation?${params.toString()}`
  }

  return (
    <main>
      <PageHeader title="Legal Consent Remediation" subtitle="Read-only follow-up of active members who need current legal documents accepted." />
      <Section className="space-y-5">
        <p className="text-sm text-[hsl(var(--muted))]">Only record a real acceptance in the member profile, after the member or guardian has reviewed the required documents. Historical memberships remain unchanged.</p>
        <div className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4 text-sm">
          <div className="font-semibold">Reception procedure</div>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-[hsl(var(--muted))]">
            <li>Confirm the member identity and date of birth; fix missing or invalid DOB before accepting.</li>
            <li>For minors, have the parent or legal guardian review the required documents in person.</li>
            <li>Open Legal &amp; Consents, record only the actual acceptance, and return here to confirm the updated status.</li>
          </ol>
        </div>
        {errorMessage ? (
          <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{errorMessage} No compliance results are displayed until the lookup succeeds.</div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ['Active members', totalActive],
                ['To remediate', candidates.length],
                ['Minors', minorCount],
                ['Missing/invalid DOB', unknownCount],
              ].map(([label, value]) => (
                <div key={label} className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4">
                  <div className="text-xs text-[hsl(var(--muted))]">{label}</div>
                  <div className="mt-1 text-2xl font-semibold">{value}</div>
                </div>
              ))}
            </div>
            <div className="text-sm text-[hsl(var(--muted))]">Not started: <strong>{notStartedCount}</strong> · Partially accepted: <strong>{partialCount}</strong>. Priority order shows missing/invalid DOB first, then minors, then adults.</div>
            <form method="GET" className="grid gap-3 rounded-2xl border border-[hsl(var(--border))] bg-white p-4 sm:grid-cols-2 lg:grid-cols-5 sm:items-end">
              <label className="grid gap-1 text-sm"><span>Member name or ATOM ID</span><input name="q" defaultValue={q} maxLength={100} placeholder="Search members…" className="rounded-xl border border-[hsl(var(--border))] px-3 py-2" /></label>
              <label className="grid gap-1 text-sm"><span>Category</span><select name="group" defaultValue={group} className="rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2"><option value="all">All incomplete</option><option value="minor">Minors</option><option value="adult">Adults</option><option value="unknown">DOB to review</option></select></label>
              <label className="grid gap-1 text-sm"><span>Progress</span><select name="progress" defaultValue={progress} className="rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2"><option value="all">All progress</option><option value="not_started">Not started</option><option value="partial">Partially accepted</option></select></label>
              <label className="grid gap-1 text-sm"><span>Order</span><select name="order" defaultValue={order} className="rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2"><option value="priority">Operational priority</option><option value="name">Member name</option></select></label>
              <button type="submit" className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white">Apply filters</button>
            </form>
            <p className="text-sm text-[hsl(var(--muted))]">{filtered.length} matching member(s) · {requiredCount} current required document(s) · {today} (Cairo)</p>
            <div className="space-y-3">
              {visible.map(({ profile, missing, accepted, group: kind }) => (
                <div key={profile.user_id} className="flex flex-col gap-3 rounded-2xl border border-[hsl(var(--border))] bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="font-semibold">{`${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim() || 'Unnamed member'}</div>
                    <div className="mt-1 text-xs text-[hsl(var(--muted))]">{profile.member_id ?? 'No ATOM ID'} · {kind === 'minor' ? 'Parent/guardian required' : kind === 'unknown' ? 'Date of birth needs review' : 'Adult'} · {accepted}/{requiredCount} accepted · {accepted === 0 ? 'Not started' : 'Partially accepted'}</div>
                    <div className="mt-2 text-sm">Missing: {missing.map((doc) => `${doc.title} (v${doc.version_label})`).join(', ')}</div>
                  </div>
                  <Link href={`/members/${profile.user_id}#legal-consents`} className="inline-flex shrink-0 items-center justify-center rounded-xl border border-[hsl(var(--border))] px-4 py-2 text-sm font-semibold hover:bg-gray-50">Open Legal &amp; Consents →</Link>
                </div>
              ))}
              {filtered.length === 0 && <div className="rounded-2xl border p-5 text-sm">No incomplete members match these filters. Clear the filters to review the complete remediation queue.</div>}
            </div>
            {pages > 1 && (
              <nav aria-label="Pagination" className="flex items-center justify-between gap-3 text-sm">
                {currentPage > 1 ? <Link className="underline" href={pageHref(currentPage - 1)}>← Previous</Link> : <span />}
                <span>Page {currentPage} of {pages}</span>
                {currentPage < pages ? <Link className="underline" href={pageHref(currentPage + 1)}>Next →</Link> : <span />}
              </nav>
            )}
          </>
        )}
      </Section>
    </main>
  )
}
