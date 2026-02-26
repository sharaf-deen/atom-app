'use client'

// src/app/admin/expiring-soon/notify-button.tsx

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import Button from '@/components/ui/Button'

export default function NotifyExpiryButton({ subscriptionId }: { subscriptionId: string }) {
  const [loading, setLoading] = useState(false)

  const label = useMemo(() => (loading ? 'Sending…' : 'Notify'), [loading])

  async function run() {
    if (loading) return
    setLoading(true)
    try {
      const res = await fetch('/api/admin/membership/expiry-reminders/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'cache-control': 'no-store' },
        body: JSON.stringify({ subscription_id: subscriptionId }),
      })

      const json = await res.json().catch(() => null)

      if (!res.ok || !json?.ok) {
        const msg = json?.details || json?.error || 'Failed'
        toast.error(`Notify: ${msg}`)
        return
      }

      if (json?.skipped) {
        toast.message('Already notified today')
      } else {
        toast.success('Reminder sent')
      }
    } catch (e: any) {
      toast.error(e?.message ?? 'Notify failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={run} disabled={loading}>
      {label}
    </Button>
  )
}
