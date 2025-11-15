// src/components/NotificationsSender.tsx
'use client'

import { useState } from 'react'
import MembersMultiPicker from './MembersMultiPicker'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import Textarea from '@/components/ui/Textarea'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card'

type Audience =
  | 'all_members'
  | 'all_coaches'
  | 'all_assistant_coaches'
  | 'all_staff'
  | 'custom'

export default function NotificationsSender() {
  const [audience, setAudience] = useState<Audience>('all_members')
  const [customMode, setCustomMode] = useState<'pick' | 'emails'>('pick')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [emails, setEmails] = useState('')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [kind, setKind] = useState('info') // optionnel, catégorisation
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string>('')

  async function onSend(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMsg('')
    try {
      const payload: any = {
        title: title.trim() || undefined,
        body: body.trim(),
        audience,
        kind: kind.trim() || undefined,
      }

      if (audience === 'custom') {
        if (customMode === 'pick') {
          if (selectedIds.length === 0) {
            setMsg('Please select at least one member.')
            setBusy(false)
            return
          }
          payload.user_ids = selectedIds
        } else {
          const arr = emails
            .split(',')
            .map((s) => s.trim().toLowerCase())
            .filter(Boolean)
          if (arr.length === 0) {
            setMsg('Please provide at least one email for custom audience.')
            setBusy(false)
            return
          }
          payload.emails = arr
        }
      }

      const r = await fetch('/api/notifications/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const j = await r.json()
      if (!r.ok || !j?.ok) {
        setMsg(j?.details || j?.error || 'Failed to send')
        return
      }
      setMsg(`Sent to ${j.count} recipient(s).`)
      setBody('')
      setSelectedIds([])
      setEmails('')
    } catch (e: any) {
      setMsg(String(e?.message || e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card hover>
      <CardHeader>
        <CardTitle>Send a notification</CardTitle>
      </CardHeader>

      <CardContent>
        <form onSubmit={onSend} className="grid gap-4">
          {/* Ligne audience / catégorie */}
          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              label="Audience"
              value={audience}
              onChange={(e) => setAudience(e.target.value as Audience)}
              disabled={busy}
            >
              <option value="all_members">All members</option>
              <option value="all_coaches">All coaches</option>
              <option value="all_assistant_coaches">All assistant coaches</option>
              <option value="all_staff">All coaches + assistants</option>
              <option value="custom">Custom…</option>
            </Select>

            <Select
              label="Category (optional)"
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              disabled={busy}
            >
              <option value="info">Info</option>
              <option value="order_update">Order update</option>
              <option value="billing">Billing</option>
              <option value="promo">Promo</option>
            </Select>
          </div>

          {/* Bloc custom audience */}
          {audience === 'custom' && (
            <div className="grid gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <label className="inline-flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-1.5 text-sm">
                  <input
                    type="radio"
                    name="customMode"
                    value="pick"
                    checked={customMode === 'pick'}
                    onChange={() => setCustomMode('pick')}
                    disabled={busy}
                  />
                  <span>Pick members</span>
                </label>
                <label className="inline-flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-1.5 text-sm">
                  <input
                    type="radio"
                    name="customMode"
                    value="emails"
                    checked={customMode === 'emails'}
                    onChange={() => setCustomMode('emails')}
                    disabled={busy}
                  />
                  <span>Emails</span>
                </label>
              </div>

              {customMode === 'pick' ? (
                <MembersMultiPicker onChange={setSelectedIds} disabled={busy} />
              ) : (
                <Input
                  label="Recipient emails (comma-separated)"
                  value={emails}
                  onChange={(e) => setEmails(e.target.value)}
                  placeholder="member1@ex.com, member2@ex.com"
                  disabled={busy}
                />
              )}
            </div>
          )}

          {/* Titre / Message */}
          <Input
            label="Title (optional)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Update…"
            disabled={busy}
          />

          <Textarea
            label="Message *"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Your message…"
            disabled={busy}
            required
            rows={6}
          />

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="submit"
              disabled={
                busy ||
                !body.trim() ||
                (audience === 'custom' && customMode === 'pick' && selectedIds.length === 0) ||
                (audience === 'custom' && customMode === 'emails' && !emails.trim())
              }
            >
              {busy ? 'Sending…' : 'Send'}
            </Button>

            {msg && <span className="text-xs text-[hsl(var(--muted))]">{msg}</span>}
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
