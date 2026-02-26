'use client'

// src/app/admin/expiring-soon/run-reminders-button.tsx

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import Button from '@/components/ui/Button'

export default function RunExpiryRemindersButton() {
  const [loading, setLoading] = useState(false)

  const label = useMemo(() => (loading ? 'Running…' : 'Run reminders'), [loading])

  async function run() {
    if (loading) return
    setLoading(true)
    try {
      const res = await fetch('/api/admin/membership/expiry-reminders/run', {
        method: 'GET',
        headers: { 'cache-control': 'no-store' },
      })
      const json = await res.json().catch(() => null)

      if (!res.ok) {
        const msg = json?.details || json?.error || 'Failed'
        toast.error(`Reminders: ${msg}`)
        return
      }

      const sent = json?.totals?.sent ?? 0
      const skipped = json?.totals?.skipped ?? 0
      const errors = json?.totals?.errors ?? 0

      if (errors > 0) {
        toast.warning(`Reminders done: sent ${sent}, skipped ${skipped}, errors ${errors}`)
      } else {
        toast.success(`Reminders done: sent ${sent}, skipped ${skipped}`)
      }
    } catch (e: any) {
      toast.error(e?.message ?? 'Reminders failed')
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
