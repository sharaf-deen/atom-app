'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import Button from '@/components/ui/Button'

type Props = {
  sendEmail?: boolean
}

function withRef(message: string, requestId?: string | null) {
  return requestId ? `${message} Ref ${requestId}.` : message
}

export default function RunHealthMonitorButton({ sendEmail = false }: Props) {
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  const label = useMemo(() => {
    if (loading) return sendEmail ? 'Running + emailing…' : 'Running…'
    return sendEmail ? 'Run + email' : 'Run now'
  }, [loading, sendEmail])

  async function run() {
    if (loading) return
    setLoading(true)
    try {
      const path = `/api/admin/health-monitor/run${sendEmail ? '?send_email=1' : ''}`
      const res = await fetch(path, {
        method: 'GET',
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { 'cache-control': 'no-store' },
      })
      const json = await res.json().catch(() => ({}))
      const requestId = String((json as any)?.request_id || res.headers.get('x-request-id') || '').trim() || null

      if (!res.ok) {
        const msg = (json as any)?.details || (json as any)?.error || 'Failed'
        toast.error(`Health monitor: ${withRef(String(msg), requestId)}`)
        return
      }

      const status = String((json as any)?.summary?.overall_status ?? 'healthy')
      const scans = Number((json as any)?.summary?.counts?.scans_today ?? 0)
      const orphan = Number((json as any)?.summary?.counts?.orphan_profiles ?? 0)
      const warnings = Array.isArray((json as any)?.summary?.warnings) ? (json as any).summary.warnings.length : 0
      const emailSent = !!(json as any)?.email_sent
      const persistError = (json as any)?.persist_error
      const reportId = String((json as any)?.report_id ?? '').trim()
      const needsReview = status === 'warning' || status === 'critical'

      const suffix = sendEmail
        ? emailSent
          ? ' Email sent.'
          : ' Email not sent.'
        : ''

      const triage = needsReview ? ' Needs review.' : ' Looks normal.'
      const base = `Status ${status}. Warnings ${warnings}. Scans today ${scans}. Orphans ${orphan}.${triage}${suffix}`

      if (persistError) {
        toast.warning(withRef(base, requestId), { description: `Report save warning: ${persistError}` })
      } else if (status === 'critical') {
        toast.error(withRef(base, requestId))
      } else if (status === 'warning') {
        toast.warning(withRef(base, requestId))
      } else {
        toast.success(withRef(base, requestId))
      }

      if (reportId) {
        const params = new URLSearchParams()
        params.set('report', reportId)
        if (status === 'warning' || status === 'critical') params.set('status', status)
        const query = params.toString()
        router.push(query ? `/admin/health-monitor?${query}` : '/admin/health-monitor')
        router.refresh()
      } else {
        router.refresh()
      }
    } catch (e: any) {
      toast.error(e?.message ?? 'Health monitor failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button type="button" onClick={run} disabled={loading} variant={sendEmail ? 'outline' : 'solid'} loading={loading} loadingText={label}>
        {sendEmail ? 'Run + email' : 'Run now'}
      </Button>
      <span className="sr-only" role="status" aria-live="polite">
        {loading ? label : ''}
      </span>
    </div>
  )
}
