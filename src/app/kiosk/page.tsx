// src/app/kiosk/page.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/session'
import CreateMemberForm from '@/components/CreateMemberForm'
import PageHeader from '@/components/layout/PageHeader'

export default async function KioskPage() {
  const me = await getSessionUser()

  if (!me) {
    redirect('/login?next=/kiosk')
  }

  const isStaff = ['reception', 'admin', 'super_admin'].includes(me.role)

  if (!isStaff) {
    const logoutNext = '/kiosk'
    return (
      <main>
        <PageHeader title="Kiosk" subtitle="Access restricted" />

        <div className="p-6 max-w-2xl mx-auto">
          <div className="rounded-2xl border bg-white p-5 space-y-2">
            <div className="text-sm text-gray-600">
              You’re signed in as <span className="font-medium">{me.email}</span>.
            </div>

            <div className="text-base font-semibold">You don’t have permission to access Kiosk.</div>

            <div className="text-sm text-gray-600">
              This page is limited to <span className="font-medium">Reception</span> and{' '}
              <span className="font-medium">Admins</span>.
            </div>

            <div className="flex gap-2 flex-wrap pt-2">
              <Link href="/" className="border rounded-lg px-4 py-2 text-sm hover:bg-gray-50">
                Back to home
              </Link>
              <Link href="/profile" className="border rounded-lg px-4 py-2 text-sm hover:bg-gray-50">
                My profile
              </Link>
              <Link
                href={`/logout?next=${encodeURIComponent(logoutNext)}`}
                className="border rounded-lg px-4 py-2 text-sm hover:bg-gray-50"
              >
                Switch account
              </Link>
            </div>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="p-6 max-w-2xl mx-auto space-y-6">
      <PageHeader
        title="Kiosk"
        subtitle="Create members quickly (staff only)."
      />

      <div className="rounded-2xl border bg-white p-4">
        <CreateMemberForm />
      </div>
    </main>
  )
}
