'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import Button from '@/components/ui/Button'

type Props = {
  sendEmail?: boolean
}

function statusLabel(status: string) {
  if (status === 'critical') return 'Critical'
  if (status === 'warning') return 'Warning'
  return 'Healthy'
}

function statusHint(status: string) {
  if (status === 'critical') return 'Serious issue detected. Review the page as soon as possible.'
  if (status === 'warning') return 'Attention needed. Review the active warnings on the page.'
  return 'Everything looks normal.'
}

export default function RunHealthMonitorButton({ sendEmail = false }: Props) {
  const [loading, setLoading] = useState(false)

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
        headers: { 'cache-control': 'no-store' },
      })
      const json = await res.json().catch(() => null)

      if (!res.ok) {
        const msg = json?.details || json?.error || 'Failed'
        toast.error('Health monitor failed', { description: String(msg) })
        return
      }

      const status = String(json?.summary?.overall_status ?? 'healthy')
      const scans = Number(json?.summary?.counts?.scans_today ?? 0)
      const orphan = Number(json?.summary?.counts?.orphan_profiles ?? 0)
      const warningsCount = Array.isArray(json?.summary?.warnings) ? json.summary.warnings.length : 0
      const emailSent = !!json?.email_sent
      const persistError = json?.persist_error

      const description = [
        `${warningsCount} active warning(s).`,
        `Scans today: ${scans}.`,
        `Orphan profiles: ${orphan}.`,
        statusHint(status),
        sendEmail ? (emailSent ? 'Email sent.' : 'Email not sent.') : null,
        persistError ? `Saved with warning: ${persistError}` : 'Report saved.',
      ]
        .filter(Boolean)
        .join(' ')

      if (status === 'critical') {
        toast.error(`Health monitor: ${statusLabel(status)}`, { description })
      } else if (status === 'warning') {
        toast.warning(`Health monitor: ${statusLabel(status)}`, { description })
      } else {
        toast.success(`Health monitor: ${statusLabel(status)}`, { description })
      }
    } catch (e: any) {
      toast.error('Health monitor failed', { description: e?.message ?? 'Unknown error' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button onClick={run} disabled={loading} variant={sendEmail ? 'outline' : 'solid'}>
      {label}
    </Button>
  )
}
