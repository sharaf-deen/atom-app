export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/session'
import { getSupabaseAdminClientCached } from '@/lib/requestCache'
import DuplicateRecoveryPanel from './DuplicateRecoveryPanel'

export default async function FamilyDuplicateRecoveryPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login?next=/admin/members/families/recover')
  if (user.role !== 'super_admin') {
    return <main className="p-6"><h1>Access denied — Super Admin only</h1></main>
  }

  const db = getSupabaseAdminClientCached()
  const [families, guardians, links] = await Promise.all([
    db.from('families').select('id,name').order('name'),
    db.from('family_guardians').select('family_id,auth_user_id,first_name,last_name,email,is_primary'),
    db.from('family_members').select('family_id,member_id'),
  ])
  if (families.error || guardians.error || links.error) {
    return <main className="p-6">Unable to load family recovery data.</main>
  }
  const memberUserIds = (links.data ?? []).map(row => row.member_id)
  const { data: profiles, error } = memberUserIds.length
    ? await db.from('profiles').select('user_id,member_id,first_name,last_name,archived_at').in('user_id', memberUserIds)
    : { data: [], error: null }
  if (error) return <main className="p-6">Unable to load member profiles.</main>

  const byId = new Map((profiles ?? []).filter(p => !p.archived_at).map(p => [p.user_id, p]))
  const options = (families.data ?? []).map(family => ({
    id: family.id,
    name: family.name,
    guardians: (guardians.data ?? []).filter(g => g.family_id === family.id).map(g => ({
      auth_user_id: g.auth_user_id,
      name: [g.first_name,g.last_name].filter(Boolean).join(' '),
      email: g.email,
      is_primary: g.is_primary,
    })),
    members: (links.data ?? []).filter(link => link.family_id === family.id).flatMap(link => {
      const p = byId.get(link.member_id)
      return p?.member_id ? [{
        member_id: p.member_id,
        name: [p.first_name,p.last_name].filter(Boolean).join(' '),
      }] : []
    }),
  }))
  return (
    <main className="mx-auto max-w-3xl space-y-5 p-6">
      <h1 className="text-2xl font-bold">Family Accounts — Duplicate Recovery</h1>
      <p className="text-sm">Guarded correction of members accidentally created instead of converting a guardian.</p>
      <DuplicateRecoveryPanel families={options}/>
    </main>
  )
}
