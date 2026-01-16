// src/app/coaches/page.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/session'
import AccessDeniedPage from '@/components/AccessDeniedPage'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'

// ⚠️ garde tes imports/composants existants si tu avais un listing spécifique
// (si tu avais déjà un composant CoachesClient / table, remets-le dans la zone "OK")

export default async function CoachesPage() {
  const sessionUser = await getSessionUser()
  if (!sessionUser) redirect('/login?next=/coaches')

  const allowed = sessionUser.role === 'admin' || sessionUser.role === 'super_admin'
  if (!allowed) {
    return (
      <AccessDeniedPage
        title="Coaches"
        subtitle="Access restricted."
        signedInAs={sessionUser.email}
        message="Only Admin / Super Admin can access the coaches page."
        allowed="admin, super_admin"
        nextPath="/coaches"
        actions={[{ href: '/admin', label: 'Go to Admin' }]}
        showBackHome
      />
    )
  }

  return (
    <main>
      <PageHeader title="Coaches" subtitle="Manage coaches" />
      <Section className="max-w-5xl">
        <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-soft">
          <div className="text-sm text-[hsl(var(--muted))]">
            This page is accessible. (If you already have a coaches list component, render it here.)
          </div>
        </div>
      </Section>
    </main>
  )
}
