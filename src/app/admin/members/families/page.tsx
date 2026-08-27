export const dynamic = 'force-dynamic'
export const revalidate = 0

import { redirect } from 'next/navigation'
import AccessDeniedCard from '@/components/AccessDeniedCard'
import Button from '@/components/ui/Button'
import { getSessionUser } from '@/lib/session'
import { getSupabaseAdminClientCached } from '@/lib/requestCache'
import FamilyAccountsManager from './FamilyAccountsManager'

type FamilyRow = {
  id: string
  name: string
  created_at: string | null
}

type FamilyMemberRow = {
  member_id: string
  family_id: string
}

type MemberProfile = {
  user_id: string
  member_id: string | null
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
}

export default async function FamilyAccountsPage() {
  const me = await getSessionUser()
  if (!me) redirect('/login?next=/admin/members/families')

  if (me.role !== 'admin' && me.role !== 'super_admin') {
    return (
      <main className="mx-auto max-w-4xl p-4 sm:p-6">
        <h1 className="text-2xl font-bold">Family Accounts</h1>
        <div className="mt-4">
          <AccessDeniedCard
            title="Forbidden"
            message="Only Admin / Super Admin can manage family accounts."
            nextPath="/admin/members/families"
            showBackHome
            signedInAs={me.email}
          />
        </div>
      </main>
    )
  }

  const admin = getSupabaseAdminClientCached()
  const [{ data: familyData, error: familyError }, { data: linkData, error: linkError }] = await Promise.all([
    admin.from('families').select('id,name,created_at').order('name', { ascending: true }),
    admin.from('family_members').select('member_id,family_id'),
  ])

  const families = (familyData ?? []) as FamilyRow[]
  const links = (linkData ?? []) as FamilyMemberRow[]
  const memberIds = Array.from(new Set(links.map((link) => link.member_id).filter(Boolean)))
  let profiles: MemberProfile[] = []
  let profileError: string | null = null

  if (memberIds.length > 0) {
    const { data, error } = await admin
      .from('profiles')
      .select('user_id,member_id,first_name,last_name,email,phone')
      .in('user_id', memberIds)

    profiles = (data ?? []) as MemberProfile[]
    profileError = error?.message ?? null
  }

  const profileById = new Map(profiles.map((profile) => [profile.user_id, profile]))
  const membersByFamily = new Map<string, MemberProfile[]>()

  for (const link of links) {
    const profile = profileById.get(link.member_id)
    if (!profile) continue
    const current = membersByFamily.get(link.family_id) ?? []
    current.push(profile)
    membersByFamily.set(link.family_id, current)
  }

  const hydratedFamilies = families.map((family) => ({
    ...family,
    members: (membersByFamily.get(family.id) ?? []).sort((a, b) => {
      const aName = `${a.first_name ?? ''} ${a.last_name ?? ''}`.trim().toLowerCase()
      const bName = `${b.first_name ?? ''} ${b.last_name ?? ''}`.trim().toLowerCase()
      return aName.localeCompare(bName)
    }),
  }))

  const loadError = familyError?.message || linkError?.message || profileError

  return (
    <main className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Family Accounts</h1>
          <p className="mt-1 text-sm text-[hsl(var(--muted))]">
            Group existing ATOM members into families without changing their accounts or memberships.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" href="/admin/members">
            ← Members
          </Button>
          <Button asChild variant="outline" href="/admin">
            Admin
          </Button>
        </div>
      </div>

      <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
        Lot 1A only groups existing members. It does not merge Auth users, reuse emails, change Member IDs, or modify subscriptions and payments.
      </div>

      {loadError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          Failed to load family accounts: {loadError}
        </div>
      ) : (
        <FamilyAccountsManager families={hydratedFamilies} />
      )}
    </main>
  )
}
