// src/app/profile/page.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/session'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'

export default async function ProfilePage() {
  const user = await getSessionUser()
  if (!user) redirect('/login?next=/profile')

  return (
    <main>
      <PageHeader title="Profile" subtitle="Your account info" />
      <Section className="max-w-2xl space-y-4">
        <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-soft">
          <div className="text-sm text-[hsl(var(--muted))]">Signed in as</div>
          <div className="mt-1 text-lg font-semibold">{user.email ?? '—'}</div>

          <div className="mt-4 grid gap-2 text-sm">
            <div>
              <span className="text-[hsl(var(--muted))]">Role:</span> {user.role}
            </div>
            <div>
              <span className="text-[hsl(var(--muted))]">User ID:</span>{' '}
              <span className="break-all">{user.id}</span>
            </div>
          </div>
        </div>
      </Section>
    </main>
  )
}
