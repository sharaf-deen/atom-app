// src/components/ResendInviteButton.tsx
'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import Button from '@/components/ui/Button'

function fmt(dt: any) {
  try {
    const d = new Date(dt)
    if (isNaN(d.getTime())) return null
    return d.toLocaleString()
  } catch {
    return null
  }
}

export default function ResendInviteButton({
  userId,
  email,
  size = 'sm',
}: {
  userId: string
  email?: string | null
  size?: 'sm' | 'md' | 'lg'
}) {
  const [loading, setLoading] = useState(false)
  const disabled = !email || loading

  async function run() {
    if (!email) return
    setLoading(true)
    try {
      const r = await fetch(`/api/members/${userId}/resend-invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })

      const j = await r.json().catch(() => ({}))

      if (r.status === 429 && j?.error === 'RATE_LIMITED') {
        const when = fmt(j?.reset_at)
        toast.error('Too many invites', {
          description: when ? `Try again at ${when}` : 'Please try again later.',
        })
        return
      }

      if (r.ok && j?.ok) {
        toast.success('Invite sent', { description: `Email sent to ${email}` })
        return
      }

      if (r.status === 409 && j?.error === 'ALREADY_ACTIVE') {
        toast.message('Already active', { description: 'This member already activated their account.' })
        return
      }

      toast.error('Resend failed', { description: j?.details || j?.error || 'Unknown error' })
    } catch (e: any) {
      toast.error('Resend failed', { description: e?.message || String(e) })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button
      variant="outline"
      size={size}
      onClick={run}
      disabled={disabled}
      title={!email ? 'Member has no email' : 'Resend invite email'}
    >
      {loading ? 'Sending…' : 'Resend invite'}
    </Button>
  )
}
