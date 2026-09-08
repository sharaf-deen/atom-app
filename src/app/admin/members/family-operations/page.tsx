export const dynamic = 'force-dynamic'
export const revalidate = 0

import { redirect } from 'next/navigation'
import AccessDeniedPage from '@/components/AccessDeniedPage'
import Button from '@/components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import Input from '@/components/ui/Input'
import { canAccessFamilyOperations, type Role } from '@/lib/rbac'
import { getSessionUserCached, getSupabaseAdminClientCached } from '@/lib/requestCache'

type SearchParams = Record<string, string | string[] | undefined>

type FamilyIntakeRow = {
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
  id: string
  intake_id: string
  child_kind: string
  first_name: string | null
  last_name: string | null
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
  family_intake_id: string | null
  linked_member_id: string | null
  created_at: string | null
}

type FamilyRow = {
  id: string
  name: string
  created_at: string | null
}

type FamilyGuardianRow = {
  family_id: string
  auth_user_id: string
  email: string | null
  first_name: string | null
  last_name: string | null
  phone: string | null
  is_primary: boolean
}

type FamilyMemberLinkRow = {
  family_id: string
  member_id: string
}

type MemberProfileRow = {
  user_id: string
  member_id: string | null
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
  role: string | null
}

type FamilySearchResult = {
  kind: 'family'
  id: string
  name: string
  memberCount: number
  guardianCount: number
}

type GuardianSearchResult = {
  kind: 'guardian'
  id: string
  familyId: string
  familyName: string
  name: string
  email: string | null
  phone: string | null
  isPrimary: boolean
}

type VisitorSearchResult = {
  kind: 'visitor'
  id: string
  name: string
  email: string | null
  phone: string | null
  familyIntakeId: string | null
  linkedMemberId: string | null
}

type MemberSearchResult = {
  kind: 'member'
  id: string
  memberId: string | null
  name: string
  email: string | null
  phone: string | null
  familyId: string | null
  familyName: string | null
}

type UnifiedSearchResult = FamilySearchResult | GuardianSearchResult | VisitorSearchResult | MemberSearchResult

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? '' : value ?? ''
}

function cleanSearch(value: string) {
  return value
    .replace(/[,%()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100)
}

function digitsOnly(value: string) {
  return value.replace(/\D+/g, '')
}

function fullName(first: string | null | undefined, last: string | null | undefined, fallback = 'Unnamed') {
  return `${first ?? ''} ${last ?? ''}`.replace(/\s+/g, ' ').trim() || fallback
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date)
}

function intakeStatusLabel(status: string) {
  switch (status) {
    case 'open':
      return 'Open'
    case 'family_created':
      return 'Family created'
    case 'completed':
      return 'Completed'
    case 'needs_review':
      return 'Needs review'
    case 'closed':
      return 'Closed'
    default:
      return status || 'Unknown'
  }
}

function intakeStatusClass(status: string) {
  switch (status) {
    case 'completed':
      return 'border-emerald-200 bg-emerald-50 text-emerald-800'
    case 'family_created':
      return 'border-sky-200 bg-sky-50 text-sky-800'
    case 'needs_review':
      return 'border-amber-200 bg-amber-50 text-amber-900'
    case 'closed':
      return 'border-slate-200 bg-slate-50 text-slate-600'
    default:
      return 'border-violet-200 bg-violet-50 text-violet-800'
  }
}

function roleNote(role: Role) {
  if (role === 'reception') {
    return 'Reception can handle routine family onboarding and safe family updates. Sensitive or destructive actions remain restricted.'
  }
  if (role === 'admin') {
    return 'Admin has the same family onboarding tools plus the delegated guardian-authority actions already allowed in Family Accounts.'
  }
  return 'Super Admin keeps access to advanced and exceptional Family Accounts actions. This hub does not add new privileges.'
}

function searchResultKey(result: UnifiedSearchResult) {
  return `${result.kind}:${result.id}`
}

export default async function FamilyOperationsPage({ searchParams }: { searchParams?: SearchParams }) {
  const me = await getSessionUserCached()
  if (!me) redirect('/login?next=/admin/members/family-operations')

  if (!canAccessFamilyOperations(me.role)) {
    return (
      <AccessDeniedPage
        title="Family Operations"
        subtitle="Access restricted."
        signedInAs={me.email}
        message="Only Reception / Admin / Super Admin can access Family Operations."
        allowed="reception, admin, super_admin"
        nextPath="/admin/members/family-operations"
        actions={[{ href: '/', label: 'Go Home' }]}
        showBackHome
      />
    )
  }

  const q = cleanSearch(firstParam(searchParams?.q))
  const admin = getSupabaseAdminClientCached()

  const [
    recentIntakesResult,
    readyVisitorsResult,
    recentFamiliesResult,
    readyCountResult,
    activeIntakeCountResult,
    familyCountResult,
  ] = await Promise.all([
    admin
      .from('family_intakes')
      .select('id,guardian_first_name,guardian_last_name,guardian_phone,guardian_email,family_id,status,created_at')
      .order('created_at', { ascending: false })
      .limit(8),
    admin
      .from('visitor_trials')
      .select('id,first_name,last_name,phone,email,trial_date,family_intake_id,linked_member_id,created_at')
      .not('family_intake_id', 'is', null)
      .is('linked_member_id', null)
      .order('created_at', { ascending: false })
      .limit(8),
    admin
      .from('families')
      .select('id,name,created_at')
      .order('created_at', { ascending: false })
      .limit(8),
    admin
      .from('visitor_trials')
      .select('id', { count: 'exact', head: true })
      .not('family_intake_id', 'is', null)
      .is('linked_member_id', null),
    admin
      .from('family_intakes')
      .select('id', { count: 'exact', head: true })
      .in('status', ['open', 'family_created', 'needs_review']),
    admin.from('families').select('id', { count: 'exact', head: true }),
  ])

  const recentIntakes = (recentIntakesResult.data ?? []) as FamilyIntakeRow[]
  const readyVisitors = (readyVisitorsResult.data ?? []) as ReadyVisitorRow[]
  const recentFamilies = (recentFamiliesResult.data ?? []) as FamilyRow[]

  const readyIntakeIds = readyVisitors.map((row) => row.family_intake_id).filter((id): id is string => Boolean(id))
  const recentIntakeIds = recentIntakes.map((row) => row.id)
  const missingReadyIntakeIds = Array.from(new Set(readyIntakeIds.filter((id) => !recentIntakeIds.includes(id))))

  const [missingReadyIntakesResult, intakeChildrenResult, familyGuardiansResult, familyMembersResult] = await Promise.all([
    missingReadyIntakeIds.length
      ? admin
          .from('family_intakes')
          .select('id,guardian_first_name,guardian_last_name,guardian_phone,guardian_email,family_id,status,created_at')
          .in('id', missingReadyIntakeIds)
      : Promise.resolve({ data: [] as FamilyIntakeRow[], error: null }),
    recentIntakeIds.length
      ? admin
          .from('family_intake_children')
          .select('id,intake_id,child_kind,first_name,last_name,visitor_trial_id,member_id')
          .in('intake_id', recentIntakeIds)
      : Promise.resolve({ data: [] as IntakeChildRow[], error: null }),
    recentFamilies.length
      ? admin
          .from('family_guardians')
          .select('family_id,auth_user_id,email,first_name,last_name,phone,is_primary')
          .in('family_id', recentFamilies.map((row) => row.id))
      : Promise.resolve({ data: [] as FamilyGuardianRow[], error: null }),
    recentFamilies.length
      ? admin
          .from('family_members')
          .select('family_id,member_id')
          .in('family_id', recentFamilies.map((row) => row.id))
      : Promise.resolve({ data: [] as FamilyMemberLinkRow[], error: null }),
  ])

  const allReadyIntakes = [
    ...recentIntakes,
    ...((missingReadyIntakesResult.data ?? []) as FamilyIntakeRow[]),
  ]
  const intakeById = new Map(allReadyIntakes.map((row) => [row.id, row]))
  const intakeChildren = (intakeChildrenResult.data ?? []) as IntakeChildRow[]
  const guardians = (familyGuardiansResult.data ?? []) as FamilyGuardianRow[]
  const memberLinks = (familyMembersResult.data ?? []) as FamilyMemberLinkRow[]

  const childrenByIntake = new Map<string, IntakeChildRow[]>()
  for (const child of intakeChildren) {
    const current = childrenByIntake.get(child.intake_id) ?? []
    current.push(child)
    childrenByIntake.set(child.intake_id, current)
  }

  const guardiansByFamily = new Map<string, FamilyGuardianRow[]>()
  for (const guardian of guardians) {
    const current = guardiansByFamily.get(guardian.family_id) ?? []
    current.push(guardian)
    guardiansByFamily.set(guardian.family_id, current)
  }

  const memberCountByFamily = new Map<string, number>()
  for (const link of memberLinks) {
    memberCountByFamily.set(link.family_id, (memberCountByFamily.get(link.family_id) ?? 0) + 1)
  }

  let searchResults: UnifiedSearchResult[] = []
  let searchError: string | null = null

  if (q.length >= 2) {
    const qDigits = digitsOnly(q)
    const guardianFilters = [
      `first_name.ilike.%${q}%`,
      `last_name.ilike.%${q}%`,
      `email.ilike.%${q}%`,
      `phone.ilike.%${q}%`,
    ]
    const visitorFilters = [
      `first_name.ilike.%${q}%`,
      `last_name.ilike.%${q}%`,
      `email.ilike.%${q}%`,
      `phone.ilike.%${q}%`,
    ]
    const memberFilters = [
      `first_name.ilike.%${q}%`,
      `last_name.ilike.%${q}%`,
      `email.ilike.%${q}%`,
      `member_id.ilike.%${q}%`,
    ]
    if (qDigits.length >= 4) memberFilters.push(`phone_digits.ilike.%${qDigits}%`)

    const [familySearch, guardianSearch, visitorSearch, memberSearch] = await Promise.all([
      admin.from('families').select('id,name,created_at').ilike('name', `%${q}%`).order('name', { ascending: true }).limit(12),
      admin
        .from('family_guardians')
        .select('family_id,auth_user_id,email,first_name,last_name,phone,is_primary')
        .or(guardianFilters.join(','))
        .limit(12),
      admin
        .from('visitor_trials')
        .select('id,first_name,last_name,phone,email,family_intake_id,linked_member_id')
        .or(visitorFilters.join(','))
        .order('created_at', { ascending: false })
        .limit(12),
      admin
        .from('profiles')
        .select('user_id,member_id,first_name,last_name,email,phone,role')
        .in('role', ['member', 'champion', 'vip'])
        .or(memberFilters.join(','))
        .order('created_at', { ascending: false })
        .limit(12),
    ])

    const searchErrors = [familySearch.error, guardianSearch.error, visitorSearch.error, memberSearch.error]
      .map((error) => error?.message)
      .filter(Boolean)

    const familyRows = (familySearch.data ?? []) as FamilyRow[]
    const guardianRows = (guardianSearch.data ?? []) as FamilyGuardianRow[]
    const visitorRows = (visitorSearch.data ?? []) as Array<{
      id: string
      first_name: string
      last_name: string | null
      phone: string | null
      email: string | null
      family_intake_id: string | null
      linked_member_id: string | null
    }>
    const memberRows = (memberSearch.data ?? []) as MemberProfileRow[]

    const searchFamilyIds = Array.from(new Set([
      ...familyRows.map((row) => row.id),
      ...guardianRows.map((row) => row.family_id),
    ].filter(Boolean)))
    const searchMemberIds = memberRows.map((row) => row.user_id)

    const [searchFamilyLinksResult, searchFamilyGuardiansResult] = await Promise.all([
      searchMemberIds.length
        ? admin.from('family_members').select('family_id,member_id').in('member_id', searchMemberIds)
        : Promise.resolve({ data: [] as FamilyMemberLinkRow[], error: null }),
      searchFamilyIds.length
        ? admin.from('family_guardians').select('family_id,auth_user_id').in('family_id', searchFamilyIds)
        : Promise.resolve({ data: [] as Array<{ family_id: string; auth_user_id: string }>, error: null }),
    ])

    const memberFamilyLinks = (searchFamilyLinksResult.data ?? []) as FamilyMemberLinkRow[]
    const familyIdsFromMembers = memberFamilyLinks.map((row) => row.family_id)
    const allSearchFamilyIds = Array.from(new Set([...searchFamilyIds, ...familyIdsFromMembers]))

    const searchFamilyNameRows = allSearchFamilyIds.length
      ? await admin.from('families').select('id,name').in('id', allSearchFamilyIds)
      : { data: [] as Array<{ id: string; name: string }>, error: null }

    searchErrors.push(
      ...[searchFamilyLinksResult.error, searchFamilyGuardiansResult.error, searchFamilyNameRows.error]
        .map((error) => error?.message)
        .filter((message): message is string => Boolean(message)),
    )
    searchError = searchErrors.length ? searchErrors.join(' · ') : null

    const familyNameById = new Map<string, string>()
    for (const family of searchFamilyNameRows.data ?? []) {
      familyNameById.set(String((family as any).id), String((family as any).name ?? 'Family'))
    }
    for (const family of familyRows) familyNameById.set(family.id, family.name)

    const familyByMember = new Map<string, string>()
    for (const link of memberFamilyLinks) familyByMember.set(link.member_id, link.family_id)

    const guardianCountForSearchFamily = new Map<string, number>()
    for (const row of searchFamilyGuardiansResult.data ?? []) {
      const familyId = String((row as any).family_id)
      guardianCountForSearchFamily.set(familyId, (guardianCountForSearchFamily.get(familyId) ?? 0) + 1)
    }

    let searchFamilyMemberCounts = new Map<string, number>()
    if (searchFamilyIds.length) {
      const { data } = await admin.from('family_members').select('family_id,member_id').in('family_id', searchFamilyIds)
      searchFamilyMemberCounts = new Map<string, number>()
      for (const row of data ?? []) {
        const familyId = String((row as any).family_id)
        searchFamilyMemberCounts.set(familyId, (searchFamilyMemberCounts.get(familyId) ?? 0) + 1)
      }
    }

    searchResults = [
      ...familyRows.map<FamilySearchResult>((family) => ({
        kind: 'family',
        id: family.id,
        name: family.name,
        memberCount: searchFamilyMemberCounts.get(family.id) ?? 0,
        guardianCount: guardianCountForSearchFamily.get(family.id) ?? 0,
      })),
      ...guardianRows.map<GuardianSearchResult>((guardian) => ({
        kind: 'guardian',
        id: guardian.auth_user_id,
        familyId: guardian.family_id,
        familyName: familyNameById.get(guardian.family_id) ?? 'Family',
        name: fullName(guardian.first_name, guardian.last_name, 'Guardian'),
        email: guardian.email,
        phone: guardian.phone,
        isPrimary: guardian.is_primary,
      })),
      ...visitorRows.map<VisitorSearchResult>((visitor) => ({
        kind: 'visitor',
        id: visitor.id,
        name: fullName(visitor.first_name, visitor.last_name, 'Visitor'),
        email: visitor.email,
        phone: visitor.phone,
        familyIntakeId: visitor.family_intake_id,
        linkedMemberId: visitor.linked_member_id,
      })),
      ...memberRows.map<MemberSearchResult>((member) => {
        const familyId = familyByMember.get(member.user_id) ?? null
        return {
          kind: 'member',
          id: member.user_id,
          memberId: member.member_id,
          name: fullName(member.first_name, member.last_name, 'Member'),
          email: member.email,
          phone: member.phone,
          familyId,
          familyName: familyId ? familyNameById.get(familyId) ?? 'Family' : null,
        }
      }),
    ]
  }

  const loadErrors = [
    recentIntakesResult.error,
    readyVisitorsResult.error,
    recentFamiliesResult.error,
    readyCountResult.error,
    activeIntakeCountResult.error,
    familyCountResult.error,
    missingReadyIntakesResult.error,
    intakeChildrenResult.error,
    familyGuardiansResult.error,
    familyMembersResult.error,
  ]
    .map((error) => error?.message)
    .filter(Boolean)

  return (
    <main className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[hsl(var(--muted))]">Family Accounts 2D</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Family Operations</h1>
          <p className="mt-1 max-w-3xl text-sm text-[hsl(var(--muted))]">
            One front-desk workspace for family intake, visitor conversion, family lookup and safe Family Account operations.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" href="/admin/visitors">Visitors</Button>
          <Button asChild variant="outline" href="/admin/members/families">Family Accounts</Button>
          <Button asChild variant="outline" href={me.role === 'reception' ? '/reception' : '/admin'}>
            {me.role === 'reception' ? 'Front Desk' : 'Admin'}
          </Button>
        </div>
      </div>

      <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
        {roleNote(me.role)} Existing 2A–2C routes and permission checks remain the source of truth for every action.
      </div>

      {loadErrors.length ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Some Family Operations data could not be loaded: {loadErrors.join(' · ')}
        </div>
      ) : null}

      <section>
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Quick actions</h2>
            <p className="text-sm text-[hsl(var(--muted))]">Start the common front-desk flows without hunting through separate pages.</p>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Card hover>
            <CardHeader><CardTitle className="text-base">New Family Intake</CardTitle></CardHeader>
            <CardContent>
              <p className="min-h-10 text-sm text-[hsl(var(--muted))]">Guardian + several children, including trial or immediate enrollment.</p>
              <Button asChild className="mt-4 w-full" href="/admin/members/family-intake">Start intake</Button>
            </CardContent>
          </Card>
          <Card hover>
            <CardHeader><CardTitle className="text-base">Find Family</CardTitle></CardHeader>
            <CardContent>
              <p className="min-h-10 text-sm text-[hsl(var(--muted))]">Search family name or guardian contact from one field below.</p>
              <Button asChild variant="outline" className="mt-4 w-full" href="#family-search">Search here</Button>
            </CardContent>
          </Card>
          <Card hover>
            <CardHeader><CardTitle className="text-base">Find Visitor</CardTitle></CardHeader>
            <CardContent>
              <p className="min-h-10 text-sm text-[hsl(var(--muted))]">Find a trial visitor and open conversion when Family Intake is ready.</p>
              <Button asChild variant="outline" className="mt-4 w-full" href="#family-search">Search here</Button>
            </CardContent>
          </Card>
          <Card hover>
            <CardHeader><CardTitle className="text-base">Find Member</CardTitle></CardHeader>
            <CardContent>
              <p className="min-h-10 text-sm text-[hsl(var(--muted))]">Search member name, email, phone or ATOM Member ID.</p>
              <Button asChild variant="outline" className="mt-4 w-full" href="#family-search">Search here</Button>
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent>
            <div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Visitors ready to convert</div>
            <div className="mt-2 text-3xl font-bold">{readyCountResult.count ?? 0}</div>
            <div className="mt-1 text-xs text-[hsl(var(--muted))]">Family Intake visitor with no linked Member yet.</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Active family intakes</div>
            <div className="mt-2 text-3xl font-bold">{activeIntakeCountResult.count ?? 0}</div>
            <div className="mt-1 text-xs text-[hsl(var(--muted))]">Open, family-created or needs-review intake.</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Total families</div>
            <div className="mt-2 text-3xl font-bold">{familyCountResult.count ?? 0}</div>
            <div className="mt-1 text-xs text-[hsl(var(--muted))]">Existing Family Account containers.</div>
          </CardContent>
        </Card>
      </section>

      <section id="family-search" className="scroll-mt-24">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Unified family search</CardTitle>
              <p className="mt-1 text-sm text-[hsl(var(--muted))]">Guardian, Visitor, Member or Family · name, phone, email or Member ID.</p>
            </div>
          </CardHeader>
          <CardContent>
            <form method="get" className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
              <Input
                name="q"
                label="Search"
                defaultValue={q}
                placeholder="Name, phone, email, Member ID or family name"
                minLength={2}
                maxLength={100}
                autoComplete="off"
              />
              <Button type="submit">Search</Button>
            </form>

            {q && q.length < 2 ? (
              <p className="mt-3 text-sm text-amber-700">Enter at least 2 characters.</p>
            ) : null}

            {searchError ? (
              <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                Search failed: {searchError}
              </div>
            ) : null}

            {q.length >= 2 && !searchError ? (
              searchResults.length ? (
                <div className="mt-4 grid gap-2 lg:grid-cols-2">
                  {searchResults.map((result) => (
                    <div key={searchResultKey(result)} className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-3">
                      {result.kind === 'family' ? (
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0">
                            <div className="text-xs font-semibold uppercase tracking-wide text-violet-700">Family</div>
                            <div className="font-semibold">{result.name}</div>
                            <div className="mt-1 text-xs text-[hsl(var(--muted))]">
                              {result.guardianCount} guardian{result.guardianCount === 1 ? '' : 's'} · {result.memberCount} member{result.memberCount === 1 ? '' : 's'}
                            </div>
                          </div>
                          <Button asChild size="sm" variant="outline" href={`/admin/members/families#family-${result.id}`}>Open family</Button>
                        </div>
                      ) : null}

                      {result.kind === 'guardian' ? (
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0">
                            <div className="text-xs font-semibold uppercase tracking-wide text-sky-700">Guardian{result.isPrimary ? ' · Primary' : ''}</div>
                            <div className="font-semibold">{result.name}</div>
                            <div className="mt-1 break-words text-xs text-[hsl(var(--muted))]">
                              {result.familyName} · {result.email || result.phone || 'No contact'}
                            </div>
                          </div>
                          <Button asChild size="sm" variant="outline" href={`/admin/members/families#family-${result.familyId}`}>Open family</Button>
                        </div>
                      ) : null}

                      {result.kind === 'visitor' ? (
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0">
                            <div className="text-xs font-semibold uppercase tracking-wide text-amber-700">Visitor</div>
                            <div className="font-semibold">{result.name}</div>
                            <div className="mt-1 break-words text-xs text-[hsl(var(--muted))]">
                              {result.email || result.phone || 'Family Intake contact'}
                            </div>
                            <div className="mt-1 text-xs text-[hsl(var(--muted))]">
                              {result.linkedMemberId ? 'Already linked to a Member' : result.familyIntakeId ? 'Family Intake linked · ready for conversion' : 'Not attached to Family Intake'}
                            </div>
                          </div>
                          {result.familyIntakeId && !result.linkedMemberId ? (
                            <Button asChild size="sm" href={`/admin/members/family-intake/convert/${result.id}`}>Convert</Button>
                          ) : (
                            <Button asChild size="sm" variant="outline" href={`/admin/visitors?q=${encodeURIComponent(q)}`}>Open visitor</Button>
                          )}
                        </div>
                      ) : null}

                      {result.kind === 'member' ? (
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0">
                            <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Member</div>
                            <div className="font-semibold">{result.name}</div>
                            <div className="mt-1 break-words text-xs text-[hsl(var(--muted))]">
                              ID: {result.memberId || '—'} · {result.email || result.phone || 'Family-managed member'}
                            </div>
                            {result.familyName ? <div className="mt-1 text-xs text-[hsl(var(--muted))]">Family: {result.familyName}</div> : null}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button asChild size="sm" variant="outline" href={`/members/${result.id}`}>Open member</Button>
                            {result.familyId ? <Button asChild size="sm" variant="outline" href={`/admin/members/families#family-${result.familyId}`}>Family</Button> : null}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-4 rounded-2xl border border-dashed border-[hsl(var(--border))] px-4 py-6 text-center text-sm text-[hsl(var(--muted))]">
                  No Guardian, Visitor, Member or Family matched “{q}”.
                </div>
              )
            ) : null}
          </CardContent>
        </Card>
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Visitors ready to convert</h2>
            <p className="text-sm text-[hsl(var(--muted))]">Family Intake visitors that still have no linked Member.</p>
          </div>
          <Button asChild variant="outline" size="sm" href="/admin/visitors">All visitors</Button>
        </div>

        {readyVisitors.length ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {readyVisitors.map((visitor) => {
              const intake = visitor.family_intake_id ? intakeById.get(visitor.family_intake_id) ?? null : null
              return (
                <Card key={visitor.id}>
                  <CardContent>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="font-semibold">{fullName(visitor.first_name, visitor.last_name, 'Visitor')}</div>
                        <div className="mt-1 text-xs text-[hsl(var(--muted))]">
                          Guardian: {intake ? fullName(intake.guardian_first_name, intake.guardian_last_name, 'Guardian') : 'Family Intake'}
                        </div>
                        <div className="mt-1 break-words text-xs text-[hsl(var(--muted))]">
                          {intake?.guardian_phone || intake?.guardian_email || visitor.phone || visitor.email || 'Contact stored in intake'}
                        </div>
                        <div className="mt-1 text-xs text-[hsl(var(--muted))]">Trial: {formatDate(visitor.trial_date || visitor.created_at)}</div>
                      </div>
                      <Button asChild href={`/admin/members/family-intake/convert/${visitor.id}`}>Convert to Family Member</Button>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 text-sm text-[hsl(var(--muted))]">
            No Family Intake visitors are waiting for conversion.
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Recent Family Intakes</h2>
            <p className="text-sm text-[hsl(var(--muted))]">Latest onboarding records and their current mix of Visitors and Members.</p>
          </div>
          <Button asChild variant="outline" size="sm" href="/admin/members/family-intake">New intake</Button>
        </div>

        {recentIntakes.length ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {recentIntakes.map((intake) => {
              const children = childrenByIntake.get(intake.id) ?? []
              const pendingVisitors = children.filter((child) => child.child_kind === 'visitor' || child.child_kind === 'existing_visitor')
              const memberChildren = children.filter((child) => ['member', 'existing_member', 'converted_member'].includes(child.child_kind))
              const firstPendingVisitor = pendingVisitors.find((child) => child.visitor_trial_id)

              return (
                <Card key={intake.id}>
                  <CardContent>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="font-semibold">{fullName(intake.guardian_first_name, intake.guardian_last_name, 'Guardian')}</div>
                          <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${intakeStatusClass(intake.status)}`}>
                            {intakeStatusLabel(intake.status)}
                          </span>
                        </div>
                        <div className="mt-1 break-words text-xs text-[hsl(var(--muted))]">
                          {intake.guardian_phone || intake.guardian_email || 'No contact'} · {formatDate(intake.created_at)}
                        </div>
                        <div className="mt-2 text-sm">
                          {children.length} child{children.length === 1 ? '' : 'ren'} · {pendingVisitors.length} Visitor{pendingVisitors.length === 1 ? '' : 's'} · {memberChildren.length} Member{memberChildren.length === 1 ? '' : 's'}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {firstPendingVisitor?.visitor_trial_id ? (
                          <Button asChild size="sm" href={`/admin/members/family-intake/convert/${firstPendingVisitor.visitor_trial_id}`}>Convert visitor</Button>
                        ) : null}
                        {intake.family_id ? (
                          <Button asChild size="sm" variant="outline" href={`/admin/members/families#family-${intake.family_id}`}>Open family</Button>
                        ) : null}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 text-sm text-[hsl(var(--muted))]">
            No Family Intakes yet.
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Existing Families</h2>
            <p className="text-sm text-[hsl(var(--muted))]">Recent Family Accounts with guardian and member counts.</p>
          </div>
          <Button asChild variant="outline" size="sm" href="/admin/members/families">All families</Button>
        </div>

        {recentFamilies.length ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {recentFamilies.map((family) => {
              const familyGuardians = (guardiansByFamily.get(family.id) ?? []).sort((a, b) => Number(b.is_primary) - Number(a.is_primary))
              const guardianNames = familyGuardians.slice(0, 2).map((guardian) => fullName(guardian.first_name, guardian.last_name, 'Guardian'))
              const memberCount = memberCountByFamily.get(family.id) ?? 0

              return (
                <Card key={family.id}>
                  <CardContent>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="font-semibold">{family.name}</div>
                        <div className="mt-1 text-xs text-[hsl(var(--muted))]">
                          {familyGuardians.length} guardian{familyGuardians.length === 1 ? '' : 's'} · {memberCount} member{memberCount === 1 ? '' : 's'}
                        </div>
                        <div className="mt-1 truncate text-xs text-[hsl(var(--muted))]">
                          {guardianNames.length ? guardianNames.join(' · ') : 'No guardian linked'}
                        </div>
                      </div>
                      <Button asChild size="sm" variant="outline" href={`/admin/members/families#family-${family.id}`}>Open Family</Button>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 text-sm text-[hsl(var(--muted))]">
            No Family Accounts yet.
          </div>
        )}
      </section>
    </main>
  )
}
