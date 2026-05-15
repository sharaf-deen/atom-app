// src/components/ContactForm.tsx
'use client'

import { useState } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card'
import Input from '@/components/ui/Input'
import Textarea from '@/components/ui/Textarea'
import Button from '@/components/ui/Button'

type ContactFormProps = {
  variant?: 'card' | 'composer'
}

export default function ContactForm({ variant = 'card' }: ContactFormProps) {
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ kind: '' | 'success' | 'error'; msg: string }>({
    kind: '',
    msg: '',
  })

  const isComposer = variant === 'composer'

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

      setStatus({ kind: 'success', msg: 'Message sent to ATOM admin.' })
      setSubject('')
      setMessage('')
    } catch (e: any) {
      setStatus({ kind: 'error', msg: String(e?.message || e) })
    } finally {
      setBusy(false)
    }
  }

  const form = (
    <form onSubmit={onSubmit} className={isComposer ? 'grid gap-3' : 'grid gap-4'}>
      {!isComposer ? (
        <Input
          label="Subject (optional)"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Question about my subscription, order…"
          disabled={busy}
          aria-label="Subject"
        />
      ) : null}

      <Textarea
        label={isComposer ? 'Message to admin *' : 'Message *'}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder={isComposer ? 'Write your message to the ATOM team…' : 'Write your message…'}
        required
        disabled={busy}
        rows={isComposer ? 4 : 6}
        aria-label="Message"
      />

      {status.msg ? (
        <div
          className={
            'rounded-2xl px-3 py-2 text-sm ' +
            (status.kind === 'error'
              ? 'border border-red-300 bg-red-50 text-red-700'
              : 'border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--muted))]')
          }
          role={status.kind === 'error' ? 'alert' : 'status'}
        >
          {status.msg}
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={busy || !message.trim()}>
          {busy ? 'Sending…' : isComposer ? 'Send to admin' : 'Send'}
        </Button>
      </div>
    </form>
  )

  if (isComposer) {
    return (
      <div className="rounded-3xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3 shadow-soft">
        <div className="mb-3 text-sm leading-6 text-[hsl(var(--muted))]">
          Your message will be sent privately to the ATOM admin team.
        </div>
        {form}
      </div>
    )
  }

  return (
    <Card hover>
      <CardHeader className="flex items-center justify-between gap-4 sm:flex-row sm:items-center">
        <CardTitle className="text-base sm:text-lg">Contact Atom</CardTitle>
      </CardHeader>

      <CardContent>{form}</CardContent>
    </Card>
  )
}
