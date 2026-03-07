'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import Button from '@/components/ui/Button'

export default function RunOutstandingRemindersButton() {
  const [loading, setLoading] = useState(false)

  const label = useMemo(() => (loading ? 'Running…' : 'Run due reminders'), [loading])

  async function run() {
    if (loading) return
    setLoading(true)
    try {
      const res = await fetch('/api/admin/billing/outstanding-reminders/run', {
        method: 'GET',
        headers: { 'cache-control': 'no-store' },
      })
      const json = await res.json().catch(() => null)

      if (!res.ok) {
        const msg = json?.details || json?.error || 'Failed'
        toast.error(`Due reminders: ${msg}`)
        return
      }

      const sent = json?.totals?.sent ?? 0
      const skipped = json?.totals?.skipped ?? 0
      const errors = json?.totals?.errors ?? 0

      if (errors > 0) toast.warning(`Due reminders done: sent ${sent}, skipped ${skipped}, errors ${errors}`)
      else toast.success(`Due reminders done: sent ${sent}, skipped ${skipped}`)
    } catch (e: any) {
      toast.error(e?.message ?? 'Due reminders failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button onClick={run} disabled={loading}>
      {label}
    </Button>
  )
}
