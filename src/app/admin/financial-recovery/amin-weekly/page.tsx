import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/session'
import AminWeeklyCorrection from './AminWeeklyCorrection'

export const dynamic = 'force-dynamic'

export default async function AminWeeklyCorrectionPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login?next=/admin/financial-recovery/amin-weekly')
  if (user.role !== 'super_admin') redirect('/admin')
  return <AminWeeklyCorrection />
}
