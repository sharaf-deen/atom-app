// src/components/ContactForm.tsx
'use client'

import { useState } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card'
import Input from '@/components/ui/Input'
import Textarea from '@/components/ui/Textarea'
import Button from '@/components/ui/Button'

export default function ContactForm() {
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')

  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ kind: '' | 'success' | 'error'; msg: string }>({
    kind: '',
    msg: '',
  })

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setStatus({ kind: '', msg: '' })

    try {
      const r = await fetch('/api/contact/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, message }),
      })
      const j = await r.json().catch(() => ({}))

      if (!r.ok || !j?.ok) {
        setStatus({ kind: 'error', msg: j?.details || j?.error || 'Failed to send message' })
        return
      }

      setStatus({ kind: 'success', msg: 'Message sent to Atom admin.' })
      setSubject('')
      setMessage('')
    } catch (e: any) {
      setStatus({ kind: 'error', msg: String(e?.message || e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card hover>
      <CardHeader className="flex items-center justify-between gap-4 sm:flex-row sm:items-center">
        <CardTitle className="text-base sm:text-lg">Contact Atom</CardTitle>
      </CardHeader>

      <CardContent>
        <form onSubmit={onSubmit} className="grid gap-4">
          <Input
            label="Subject (optional)"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Question about my subscription, order…"
            disabled={busy}
            aria-label="Subject"
          />

          <Textarea
            label="Message *"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Write your message…"
            required
            disabled={busy}
            rows={6}
            aria-label="Message"
          />

          {status.msg && (
            <div
              className={
                'text-sm rounded-2xl px-3 py-2 ' +
                (status.kind === 'error'
                  ? 'border border-red-300 bg-red-50 text-red-700'
                  : 'border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--muted))]')
              }
              role={status.kind === 'error' ? 'alert' : 'status'}
            >
              {status.msg}
            </div>
          )}

          <div className="flex items-center gap-2">
            <Button type="submit" disabled={busy || !message.trim()}>
              {busy ? 'Sending…' : 'Send'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
