// src/app/kiosk/page.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { getSessionUser } from '@/lib/session'
import CreateMemberForm from '@/components/CreateMemberForm'


export default async function KioskPage() {
  const me = await getSessionUser()
  const isStaff = !!me && ['reception', 'admin', 'super_admin'].includes(me.role)

  if (!isStaff) {
    return (
      <main className="p-6 max-w-2xl mx-auto space-y-6">
        <p className="text-sm text-gray-600 mt-2">Forbidden.</p>
      </main>
    )
  }

  return (
    <main className="p-6 max-w-2xl mx-auto space-y-6">
      <div className="p-6 max-w-2xl mx-auto space-y-6">
        <div>
          <CreateMemberForm />
        </div>
      </div>
    </main>
  )
}
