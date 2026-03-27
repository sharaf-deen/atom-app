'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import Button from '@/components/ui/Button'

type Props = {
  sendEmail?: boolean
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

      if (!res.ok) {
        const msg = json?.details || json?.error || 'Failed'
        toast.error(`Health monitor: ${msg}`)
        return
      }

      const status = String(json?.summary?.overall_status ?? 'healthy')
      const scans = Number(json?.summary?.counts?.scans_today ?? 0)
      const orphan = Number(json?.summary?.counts?.orphan_profiles ?? 0)
      const warnings = Array.isArray(json?.summary?.warnings) ? json.summary.warnings.length : 0
      const emailSent = !!json?.email_sent
      const persistError = json?.persist_error
      const reportId = String(json?.report_id ?? '').trim()
      const needsReview = status === 'warning' || status === 'critical'

      const suffix = sendEmail
        ? emailSent
          ? ' Email sent.'
          : ' Email not sent.'
        : ''

      const triage = needsReview ? ' Needs review.' : ' Looks normal.'
      const base = `Status ${status}. Warnings ${warnings}. Scans today ${scans}. Orphans ${orphan}.${triage}${suffix}`

      if (persistError) {
        toast.warning(base, { description: `Report save warning: ${persistError}` })
      } else if (status === 'critical') {
        toast.error(base)
      } else if (status === 'warning') {
        toast.warning(base)
      } else {
        toast.success(base)
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
