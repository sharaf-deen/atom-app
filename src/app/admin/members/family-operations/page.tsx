export const dynamic = 'force-dynamic'
export const revalidate = 0

import { redirect } from 'next/navigation'
import AccessDeniedPage from '@/components/AccessDeniedPage'
import Button from '@/components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { canAccessFamilyOperations } from '@/lib/rbac'
import { getSessionUserCached, getSupabaseAdminClientCached } from '@/lib/requestCache'

type SearchParams = Record<string, string | string[] | undefined>

type IntakeRow = {
  id: string
  guardian_first_name: string
  guardian_last_name: string | null
  guardian_phone: string | null
  guardian_email: string | null
  family_id: string | null
  status: string
  created_at: string | null
}

type IntakeChildRow = {
  intake_id: string
  child_kind: string
  visitor_trial_id: string | null
  member_id: string | null
}

type ReadyVisitorRow = {
  id: string
  first_name: string
  last_name: string | null
  phone: string | null
  email: string | null
  trial_date: string | null
  trial_attended_at: string | null
  free_trial_used: boolean | null
  family_intake_id: string | null
  created_at: string | null
}

type FamilySearchRow = {
  id: string
  name: string
}

type GuardianSearchRow = {
  family_id: string
  auth_user_id: string
  first_name: string | null
  last_name: string | null
  phone: string | null
  email: string | null
  is_primary: boolean | null
}

type VisitorSearchRow = {
  id: string
  first_name: string
  last_name: string | null
  phone: string | null
  email: string | null
  trial_date: string | null
  family_intake_id: string | null
  linked_member_id: string | null
}

type MemberSearchRow = {
  user_id: string
  member_id: string | null
  first_name: string | null
  last_name: string | null
  phone: string | null
  email: string | null
  role: string | null
}

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? '' : value ?? ''
}

function cleanSearch(value: string) {
  return value
    .replace(/[,%()'"\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
}

function fullName(firstName: string | null | undefined, lastName: string | null | undefined) {
  return `${firstName ?? ''} ${lastName ?? ''}`.trim() || 'Unnamed'
}

function intakeStatusLabel(status: string) {
  if (status === 'family_created') return 'Family created'
  if (status === 'needs_review') return 'Needs review'
  if (status === 'completed') return 'Completed'
  if (status === 'closed') return 'Closed'
  return 'Open'
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Africa/Cairo',
  }).format(date)
}

function MetricCard({
  label,
  value,
  hint,
  href,
}: {
  label: string
  value: number
  hint: string
  href: string
}) {
  return (
    <Card>
      <CardContent>
        <div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">{label}</div>
        <div className="mt-2 text-3xl font-bold tracking-tight">{value}</div>
        <p className="mt-1 text-sm text-[hsl(var(--muted))]">{hint}</p>
        <div className="mt-4">
          <Button asChild variant="outline" size="sm" href={href}>
            Open
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

export default async function FamilyOperationsPage({
  searchParams,
}: {
  searchParams?: SearchParams
}) {
  const me = await getSessionUserCached()
  if (!me) redirect('/login?next=/admin/members/family-operations')

  if (!canAccessFamilyOperations(me.role)) {
    return (
      <AccessDeniedPage
        title="Family Operations"
        subtitle="Access restricted."
        signedInAs={me.email}
        message="Only Reception / Admin / Super Admin can access family operations."
        allowed="reception, admin, super_admin"
        nextPath="/admin/members/family-operations"
        actions={[{ href: '/reception', label: 'Go to Front desk' }]}
        showBackHome
      />
    )
  }

  const admin = getSupabaseAdminClientCached()
  const q = cleanSearch(firstParam(searchParams?.q))

  const [
    familiesCountRes,
    activeIntakesCountRes,
    readyVisitorsCountRes,
    recentIntakesRes,
    readyVisitorsRes,
  ] = await Promise.all([
    admin.from('families').select('id', { count: 'exact', head: true }),
    admin
      .from('family_intakes')
      .select('id', { count: 'exact', head: true })
      .in('status', ['open', 'family_created', 'needs_review']),
    admin
      .from('visitor_trials')
      .select('id', { count: 'exact', head: true })
      .not('family_intake_id', 'is', null)
      .is('linked_member_id', null)
      .is('family_converted_at', null)
      .neq('status', 'closed'),
    admin
      .from('family_intakes')
      .select('id,guardian_first_name,guardian_last_name,guardian_phone,guardian_email,family_id,status,created_at')
      .in('status', ['open', 'family_created', 'needs_review'])
      .order('created_at', { ascending: false })
      .limit(6),
    admin
      .from('visitor_trials')
      .select('id,first_name,last_name,phone,email,trial_date,trial_attended_at,free_trial_used,family_intake_id,created_at')
      .not('family_intake_id', 'is', null)
      .is('linked_member_id', null)
      .is('family_converted_at', null)
      .neq('status', 'closed')
      .order('created_at', { ascending: false })
      .limit(6),
  ])

  const recentIntakes = (recentIntakesRes.data ?? []) as IntakeRow[]
  const readyVisitors = (readyVisitorsRes.data ?? []) as ReadyVisitorRow[]
  const intakeIds = Array.from(
    new Set(
      [
        ...recentIntakes.map((row) => row.id),
        ...readyVisitors.map((row) => row.family_intake_id).filter(Boolean),
      ] as string[],
    ),
  )
  const familyIds = Array.from(new Set(recentIntakes.map((row) => row.family_id).filter(Boolean) as string[]))

  const [childrenRes, intakeContextRes, familyNamesRes] = await Promise.all([
    intakeIds.length
      ? admin
          .from('family_intake_children')
          .select('intake_id,child_kind,visitor_trial_id,member_id')
          .in('intake_id', intakeIds)
      : Promise.resolve({ data: [] as IntakeChildRow[], error: null }),
    intakeIds.length
      ? admin
          .from('family_intakes')
          .select('id,guardian_first_name,guardian_last_name,guardian_phone,guardian_email,family_id,status,created_at')
          .in('id', intakeIds)
      : Promise.resolve({ data: [] as IntakeRow[], error: null }),
    familyIds.length
      ? admin.from('families').select('id,name').in('id', familyIds)
      : Promise.resolve({ data: [] as FamilySearchRow[], error: null }),
  ])

  const children = (childrenRes.data ?? []) as IntakeChildRow[]
  const intakeContext = (intakeContextRes.data ?? []) as IntakeRow[]
  const familyNames = (familyNamesRes.data ?? []) as FamilySearchRow[]
  const intakeById = new Map(intakeContext.map((row) => [row.id, row]))
  const familyNameById = new Map(familyNames.map((row) => [row.id, row.name]))

  const childCounts = new Map<string, { total: number; visitors: number; members: number }>()
  for (const child of children) {
    const current = childCounts.get(child.intake_id) ?? { total: 0, visitors: 0, members: 0 }
    current.total += 1
    if (child.member_id) current.members += 1
    else if (child.visitor_trial_id) current.visitors += 1
    childCounts.set(child.intake_id, current)
  }

  let familyResults: FamilySearchRow[] = []
  let guardianResults: GuardianSearchRow[] = []
  let visitorResults: VisitorSearchRow[] = []
  let memberResults: MemberSearchRow[] = []
  let searchError: string | null = null

  if (q.length >= 2) {
    const pattern = `%${q}%`
    const [familySearchRes, guardianSearchRes, visitorSearchRes, memberSearchRes] = await Promise.all([
      admin.from('families').select('id,name').ilike('name', pattern).order('name').limit(8),
      admin
        .from('family_guardians')
        .select('family_id,auth_user_id,first_name,last_name,phone,email,is_primary')
        .or(`first_name.ilike.${pattern},last_name.ilike.${pattern},phone.ilike.${pattern},email.ilike.${pattern}`)
        .limit(8),
      admin
        .from('visitor_trials')
        .select('id,first_name,last_name,phone,email,trial_date,family_intake_id,linked_member_id')
        .or(`first_name.ilike.${pattern},last_name.ilike.${pattern},phone.ilike.${pattern},email.ilike.${pattern}`)
        .order('created_at', { ascending: false })
        .limit(8),
      admin
        .from('profiles')
        .select('user_id,member_id,first_name,last_name,phone,email,role')
        .in('role', ['member', 'champion', 'vip'])
        .or(`member_id.ilike.${pattern},first_name.ilike.${pattern},last_name.ilike.${pattern},phone.ilike.${pattern},email.ilike.${pattern}`)
        .limit(8),
    ])

    familyResults = (familySearchRes.data ?? []) as FamilySearchRow[]
    guardianResults = (guardianSearchRes.data ?? []) as GuardianSearchRow[]
    visitorResults = (visitorSearchRes.data ?? []) as VisitorSearchRow[]
    memberResults = (memberSearchRes.data ?? []) as MemberSearchRow[]
    searchError =
      familySearchRes.error?.message ||
      guardianSearchRes.error?.message ||
      visitorSearchRes.error?.message ||
      memberSearchRes.error?.message ||
      null
  }

  const loadError =
    familiesCountRes.error?.message ||
    activeIntakesCountRes.error?.message ||
    readyVisitorsCountRes.error?.message ||
    recentIntakesRes.error?.message ||
    readyVisitorsRes.error?.message ||
    childrenRes.error?.message ||
    intakeContextRes.error?.message ||
    familyNamesRes.error?.message ||
    null

  return (
    <main className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Family Operations</h1>
          <p className="mt-1 max-w-3xl text-sm text-[hsl(var(--muted))]">
            One workspace for family intake, Visitor conversion and routine Family Account management.
          </p>
          <div className="mt-2 inline-flex rounded-full border border-[hsl(var(--border))] bg-white px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">
            {me.role.replace(/_/g, ' ')}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button asChild href="/admin/members/family-intake">
            New family intake
          </Button>
          <Button asChild variant="outline" href="/reception">
            Front desk
          </Button>
        </div>
      </div>

      {loadError ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Some Family Operations summaries could not be loaded: {loadError}
        </div>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <MetricCard
          label="Visitors ready to convert"
          value={readyVisitorsCountRes.count ?? 0}
          hint="Family Intake visitors without a linked Member."
          href="/admin/visitors"
        />
        <MetricCard
          label="Open family intakes"
          value={activeIntakesCountRes.count ?? 0}
          hint="Open, family-created or needs-review intake records."
          href="/admin/members/family-intake"
        />
        <MetricCard
          label="Family accounts"
          value={familiesCountRes.count ?? 0}
          hint="Existing families available for routine management."
          href="/admin/members/families"
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-4">
        <Card hover>
          <CardHeader><CardTitle>New Family Intake</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm text-[hsl(var(--muted))]">
              Register one guardian with multiple children for Trial, immediate enrollment or existing-account linking.
            </p>
            <div className="mt-4">
              <Button asChild href="/admin/members/family-intake">Start intake</Button>
            </div>
          </CardContent>
        </Card>

        <Card hover>
          <CardHeader><CardTitle>Visitors</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm text-[hsl(var(--muted))]">
              Track free trials and convert Family Intake children when they return to enroll.
            </p>
            <div className="mt-4">
              <Button asChild variant="outline" href="/admin/visitors">Open Visitors</Button>
            </div>
          </CardContent>
        </Card>

        <Card hover>
          <CardHeader><CardTitle>Family Accounts</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm text-[hsl(var(--muted))]">
              Update existing families, guardians and member links using the permissions already granted to your role.
            </p>
            <div className="mt-4">
              <Button asChild variant="outline" href="/admin/members/families">Open families</Button>
            </div>
          </CardContent>
        </Card>

        <Card hover>
          <CardHeader><CardTitle>Members</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm text-[hsl(var(--muted))]">
              Open a member profile after conversion or when a family relationship needs verification.
            </p>
            <div className="mt-4">
              <Button asChild variant="outline" href="/members">Open Members</Button>
            </div>
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Find family, guardian, Visitor or Member</CardTitle>
        </CardHeader>
        <CardContent>
          <form method="get" action="/admin/members/family-operations" className="flex flex-col gap-2 sm:flex-row">
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="Name, phone, email or Member ID"
              className="min-h-11 min-w-0 flex-1 rounded-2xl border border-[hsl(var(--border))] bg-white px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-black/20"
            />
            <Button type="submit">Search</Button>
            {q ? <Button asChild variant="outline" href="/admin/members/family-operations">Clear</Button> : null}
          </form>

          {q && q.length < 2 ? (
            <p className="mt-3 text-sm text-amber-800">Enter at least 2 characters.</p>
          ) : null}

          {searchError ? (
            <p className="mt-3 text-sm text-rose-700">Search failed: {searchError}</p>
          ) : null}

          {q.length >= 2 ? (
            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <div className="space-y-3">
                <div className="text-sm font-semibold">Families & guardians</div>

                {familyResults.map((family) => (
                  <div key={`family:${family.id}`} className="rounded-2xl border border-[hsl(var(--border))] bg-white p-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Family</div>
                    <div className="mt-1 font-semibold">{family.name}</div>
                    <div className="mt-2">
                      <Button asChild size="sm" variant="outline" href="/admin/members/families">Open Family Accounts</Button>
                    </div>
                  </div>
                ))}

                {guardianResults.map((guardian) => (
                  <div key={`guardian:${guardian.family_id}:${guardian.auth_user_id}`} className="rounded-2xl border border-[hsl(var(--border))] bg-white p-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">
                      Guardian{guardian.is_primary ? ' · Primary' : ''}
                    </div>
                    <div className="mt-1 font-semibold">{fullName(guardian.first_name, guardian.last_name)}</div>
                    <div className="mt-1 text-sm text-[hsl(var(--muted))]">
                      {guardian.phone || 'No phone'} · {guardian.email || 'No email'}
                    </div>
                    <div className="mt-2">
                      <Button asChild size="sm" variant="outline" href="/admin/members/families">Open Family Accounts</Button>
                    </div>
                  </div>
                ))}

                {familyResults.length === 0 && guardianResults.length === 0 ? (
                  <p className="text-sm text-[hsl(var(--muted))]">No family or guardian match.</p>
                ) : null}
              </div>

              <div className="space-y-3">
                <div className="text-sm font-semibold">Visitors & members</div>

                {visitorResults.map((visitor) => {
                  const visitorName = fullName(visitor.first_name, visitor.last_name)
                  const canConvert = Boolean(visitor.family_intake_id && !visitor.linked_member_id)
                  return (
                    <div key={`visitor:${visitor.id}`} className="rounded-2xl border border-[hsl(var(--border))] bg-white p-3">
                      <div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Visitor</div>
                      <div className="mt-1 font-semibold">{visitorName}</div>
                      <div className="mt-1 text-sm text-[hsl(var(--muted))]">
                        {visitor.phone || visitor.email || 'No direct contact'}{visitor.trial_date ? ` · Trial ${visitor.trial_date}` : ''}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {canConvert ? (
                          <Button asChild size="sm" href={`/admin/members/family-intake/convert/${visitor.id}`}>
                            Convert to member
                          </Button>
                        ) : null}
                        <Button asChild size="sm" variant="outline" href={`/admin/visitors?q=${encodeURIComponent(visitorName)}`}>
                          Open Visitors
                        </Button>
                      </div>
                    </div>
                  )
                })}

                {memberResults.map((member) => (
                  <div key={`member:${member.user_id}`} className="rounded-2xl border border-[hsl(var(--border))] bg-white p-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Member</div>
                    <div className="mt-1 font-semibold">{fullName(member.first_name, member.last_name)}</div>
                    <div className="mt-1 text-sm text-[hsl(var(--muted))]">
                      {member.member_id || 'No Member ID'} · {member.phone || member.email || 'No contact'}
                    </div>
                    <div className="mt-2">
                      <Button asChild size="sm" variant="outline" href={`/members/${member.user_id}`}>
                        Open member
                      </Button>
                    </div>
                  </div>
                ))}

                {visitorResults.length === 0 && memberResults.length === 0 ? (
                  <p className="text-sm text-[hsl(var(--muted))]">No Visitor or Member match.</p>
                ) : null}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <section className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Visitors ready to convert</CardTitle>
          </CardHeader>
          <CardContent>
            {readyVisitors.length === 0 ? (
              <p className="text-sm text-[hsl(var(--muted))]">No Family Intake visitor is waiting for conversion.</p>
            ) : (
              <div className="space-y-3">
                {readyVisitors.map((visitor) => {
                  const intake = visitor.family_intake_id ? intakeById.get(visitor.family_intake_id) : null
                  return (
                    <div key={visitor.id} className="rounded-2xl border border-[hsl(var(--border))] bg-white p-3">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <div className="font-semibold">{fullName(visitor.first_name, visitor.last_name)}</div>
                          <div className="mt-1 text-sm text-[hsl(var(--muted))]">
                            Guardian: {intake ? fullName(intake.guardian_first_name, intake.guardian_last_name) : 'Family Intake'}
                          </div>
                          <div className="mt-1 text-xs text-[hsl(var(--muted))]">
                            Trial {visitor.trial_date || 'date not set'} · {visitor.free_trial_used || visitor.trial_attended_at ? 'attended' : 'not marked attended'}
                          </div>
                        </div>
                        <Button asChild size="sm" href={`/admin/members/family-intake/convert/${visitor.id}`}>
                          Convert
                        </Button>
                      </div>
                    </div>
                  )
                })}
                <Button asChild variant="outline" href="/admin/visitors">View all Visitors</Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent open family intakes</CardTitle>
          </CardHeader>
          <CardContent>
            {recentIntakes.length === 0 ? (
              <p className="text-sm text-[hsl(var(--muted))]">No open Family Intake.</p>
            ) : (
              <div className="space-y-3">
                {recentIntakes.map((intake) => {
                  const counts = childCounts.get(intake.id) ?? { total: 0, visitors: 0, members: 0 }
                  return (
                    <div key={intake.id} className="rounded-2xl border border-[hsl(var(--border))] bg-white p-3">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <div className="font-semibold">{fullName(intake.guardian_first_name, intake.guardian_last_name)}</div>
                          <div className="mt-1 text-sm text-[hsl(var(--muted))]">
                            {intake.guardian_phone || intake.guardian_email || 'No contact'}
                          </div>
                          <div className="mt-1 text-xs text-[hsl(var(--muted))]">
                            {counts.total} child{counts.total === 1 ? '' : 'ren'} · {counts.visitors} visitor · {counts.members} member
                          </div>
                          <div className="mt-1 text-xs text-[hsl(var(--muted))]">
                            {intakeStatusLabel(intake.status)} · {formatDate(intake.created_at)}
                            {intake.family_id ? ` · ${familyNameById.get(intake.family_id) || 'Family linked'}` : ''}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {counts.visitors > 0 ? (
                            <Button asChild size="sm" variant="outline" href="/admin/visitors">
                              Review visitors
                            </Button>
                          ) : null}
                          {intake.family_id ? (
                            <Button asChild size="sm" variant="outline" href="/admin/members/families">
                              Open family
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  )
                })}
                <Button asChild variant="outline" href="/admin/members/family-intake">Start another intake</Button>
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950">
        <span className="font-semibold">Permissions stay unchanged.</span>{' '}
        Reception handles routine onboarding and safe family updates. Admin additionally manages guardian authority. Cleanup, account merging, Auth deletion and other exceptional actions remain Super Admin-only.
      </div>
    </main>
  )
}
