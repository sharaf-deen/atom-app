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

type FamilyGuardianRow = {
  family_id: string
  auth_user_id: string
  email: string
  first_name: string | null
  last_name: string | null
  phone: string | null
  is_primary: boolean
  invited_at: string | null
  created_at: string | null
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
  const [
    { data: familyData, error: familyError },
    { data: linkData, error: linkError },
    { data: guardianData, error: guardianError },
  ] = await Promise.all([
    admin.from('families').select('id,name,created_at').order('name', { ascending: true }),
    admin.from('family_members').select('member_id,family_id'),
    admin
      .from('family_guardians')
      .select('family_id,auth_user_id,email,first_name,last_name,phone,is_primary,invited_at,created_at')
      .order('created_at', { ascending: true }),
  ])

  const families = (familyData ?? []) as FamilyRow[]
  const links = (linkData ?? []) as FamilyMemberRow[]
  const guardians = (guardianData ?? []) as FamilyGuardianRow[]
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
  const guardiansByFamily = new Map<string, FamilyGuardianRow[]>()

  for (const link of links) {
    const profile = profileById.get(link.member_id)
    if (!profile) continue
    const current = membersByFamily.get(link.family_id) ?? []
    current.push(profile)
    membersByFamily.set(link.family_id, current)
  }

  for (const guardian of guardians) {
    const current = guardiansByFamily.get(guardian.family_id) ?? []
    current.push(guardian)
    guardiansByFamily.set(guardian.family_id, current)
  }

  const hydratedFamilies = families.map((family) => ({
    ...family,
    guardians: (guardiansByFamily.get(family.id) ?? []).sort((a, b) => {
      if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1
      return String(a.created_at ?? '').localeCompare(String(b.created_at ?? ''))
    }),
    members: (membersByFamily.get(family.id) ?? []).sort((a, b) => {
      const aName = `${a.first_name ?? ''} ${a.last_name ?? ''}`.trim().toLowerCase()
      const bName = `${b.first_name ?? ''} ${b.last_name ?? ''}`.trim().toLowerCase()
      return aName.localeCompare(bName)
    }),
  }))

  const loadError = familyError?.message || linkError?.message || guardianError?.message || profileError

  return (
    <main className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Family Accounts</h1>
          <p className="mt-1 text-sm text-[hsl(var(--muted))]">
            One family can now have multiple parent/guardian logins while every athlete keeps an individual ATOM member profile.
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
        Family members created here receive their own Member ID and QR code but do not need a separate email or login. Existing member accounts remain unchanged.
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
