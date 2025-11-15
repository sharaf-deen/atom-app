// src/components/ContactForm.tsx
'use client'

import { useMemo, useState } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card'
import Input from '@/components/ui/Input'
import Textarea from '@/components/ui/Textarea'
import Button from '@/components/ui/Button'

type Mode = 'message' | 'freeze'

export default function ContactForm() {
  const [mode, setMode] = useState<Mode>('message')

  // Message form state
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')

  // Freeze form state
  const [freezeDate, setFreezeDate] = useState<string>('')
  const [freezeReason, setFreezeReason] = useState<string>('')

  // Common UI state
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ kind: '' | 'success' | 'error'; msg: string }>({
    kind: '',
    msg: '',
  })

  const today = useMemo(() => {
    return new Date().toISOString().slice(0, 10) // YYYY-MM-DD
  }, [])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setStatus({ kind: '', msg: '' })

    try {
      if (mode === 'message') {
        // --- Send normal contact message
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

      } else {
        // --- Send freeze request
        // Simple client validation
        if (!freezeDate) {
          setStatus({ kind: 'error', msg: 'Please select a freeze start date.' })
          return
        }
        if (freezeDate < today) {
          setStatus({ kind: 'error', msg: 'Freeze start date cannot be in the past.' })
          return
        }
        if (!freezeReason || freezeReason.trim().length < 8) {
          setStatus({ kind: 'error', msg: 'Please provide a short reason (at least 8 characters).' })
          return
        }

        const r = await fetch('/api/freeze-requests', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requested_start_date: freezeDate,
            reason: freezeReason.trim(),
          }),
        })
        const j = await r.json().catch(() => ({}))
        if (!r.ok) {
          setStatus({ kind: 'error', msg: j?.error || 'Failed to submit freeze request.' })
          return
        }

        setStatus({ kind: 'success', msg: 'Freeze request submitted. You will receive an email once reviewed.' })
        // On garde la date choisie visible, on reset juste la raison
        setFreezeReason('')
      }
    } catch (e: any) {
      setStatus({ kind: 'error', msg: String(e?.message || e) })
    } finally {
      setBusy(false)
    }
  }

  // Boutons d’onglets simples (sans dépendances)
  function Tabs() {
    const base =
      'text-sm px-3 py-1.5 rounded-2xl border transition-colors'
    const active = 'bg-[hsl(var(--primary))] text-white border-[hsl(var(--primary))]'
    const inactive =
      'bg-[hsl(var(--card))] text-[hsl(var(--muted))] border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]/10'

    return (
      <div className="inline-flex gap-2 p-1 rounded-2xl bg-[hsl(var(--muted))]/10">
        <button
          type="button"
          className={`${base} ${mode === 'message' ? active : inactive}`}
          onClick={() => setMode('message')}
          aria-pressed={mode === 'message'}
        >
          Contact admin
        </button>
        <button
          type="button"
          className={`${base} ${mode === 'freeze' ? active : inactive}`}
          onClick={() => setMode('freeze')}
          aria-pressed={mode === 'freeze'}
        >
          Freeze membership request
        </button>
      </div>
    )
  }

  return (
    <Card hover>
      <CardHeader className="flex items-center justify-between gap-4 sm:flex-row sm:items-center">
        <CardTitle className="text-base sm:text-lg">Contact Atom</CardTitle>
        <Tabs />
      </CardHeader>

      <CardContent>
        <form onSubmit={onSubmit} className="grid gap-4">

          {mode === 'message' ? (
            <>
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
            </>
          ) : (
            <>
              <Input
                label="Freeze start date *"
                type="date"
                value={freezeDate}
                onChange={(e) => setFreezeDate(e.target.value)}
                min={today}
                required
                disabled={busy}
                aria-label="Freeze start date"
              />

              <Textarea
                label="Reason *"
                value={freezeReason}
                onChange={(e) => setFreezeReason(e.target.value)}
                placeholder="Briefly explain why you need to freeze your membership."
                required
                disabled={busy}
                rows={5}
                aria-label="Freeze reason"
              />

              <p className="text-xs text-[hsl(var(--muted))]">
                Note: Freeze requests are subject to approval by the admin team.
              </p>
            </>
          )}

          {/* Status */}
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

          {/* Actions */}
          <div className="flex items-center gap-2">
            <Button
              type="submit"
              disabled={
                busy ||
                (mode === 'message' ? !message.trim() : !freezeDate || !freezeReason.trim())
              }
            >
              {busy ? (mode === 'message' ? 'Sending…' : 'Submitting…') : (mode === 'message' ? 'Send' : 'Submit freeze request')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
