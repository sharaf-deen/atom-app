// src/components/NotificationsSender.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
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

type Counts = {
  members: number
  coaches: number
  assistant_coaches: number
}

type SendFeedback = {
  count: number
  audience_label?: string
  eligible_roles?: string[]
  delivery_feedback?: {
    requested_user_ids?: number
    requested_emails?: number
    matched_email_profiles?: number
    filtered_out_user_ids?: number
    unmatched_email_count?: number
    unmatched_emails?: string[]
    deduped_recipient_count?: number
  }
}

function roleLabel(role: string) {
  switch (role) {
    case 'member':
      return 'Members'
    case 'coach':
      return 'Coaches'
    case 'assistant_coach':
      return 'Assistant coaches'
    default:
      return role
  }
}

export default function NotificationsSender() {
  const [audience, setAudience] = useState<Audience>('all_members')
  const [customMode, setCustomMode] = useState<'pick' | 'emails'>('pick')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [emails, setEmails] = useState('')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [kind, setKind] = useState('info')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string>('')
  const [counts, setCounts] = useState<Counts | null>(null)
  const [feedback, setFeedback] = useState<SendFeedback | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch('/api/notifications/audience-counts', { cache: 'no-store' })
        const j = await r.json().catch(() => ({}))
        if (!cancelled && r.ok && j?.ok) {
          setCounts({
            members: Number(j.members || 0),
            coaches: Number(j.coaches || 0),
            assistant_coaches: Number(j.assistant_coaches || 0),
          })
        }
      } catch {}
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const parsedEmails = useMemo(() => {
    const unique = new Set<string>()
    for (const part of emails.split(',')) {
      const value = part.trim().toLowerCase()
      if (value) unique.add(value)
    }
    return Array.from(unique)
  }, [emails])

  const targetPreview = useMemo(() => {
    const eligibleRoles =
      audience === 'all_members'
        ? ['member']
        : audience === 'all_coaches'
          ? ['coach']
          : audience === 'all_assistant_coaches'
            ? ['assistant_coach']
            : audience === 'all_staff'
              ? ['coach', 'assistant_coach']
              : ['member', 'coach', 'assistant_coach']

    const audienceLabel =
      audience === 'all_members'
        ? 'All members'
        : audience === 'all_coaches'
          ? 'All coaches'
          : audience === 'all_assistant_coaches'
            ? 'All assistant coaches'
            : audience === 'all_staff'
              ? 'All coaches + assistants'
              : customMode === 'pick'
                ? 'Custom selection'
                : 'Custom emails'

    let estimatedRecipients = 0
    let estimateHint = 'This is the exact current count for this role audience.'

    if (audience === 'all_members') {
      estimatedRecipients = counts?.members ?? 0
    } else if (audience === 'all_coaches') {
      estimatedRecipients = counts?.coaches ?? 0
    } else if (audience === 'all_assistant_coaches') {
      estimatedRecipients = counts?.assistant_coaches ?? 0
    } else if (audience === 'all_staff') {
      estimatedRecipients = (counts?.coaches ?? 0) + (counts?.assistant_coaches ?? 0)
    } else if (customMode === 'pick') {
      estimatedRecipients = selectedIds.length
      estimateHint =
        'Selected users are still filtered server-side to roles with a visible inbox: members, coaches, and assistant coaches.'
    } else {
      estimatedRecipients = parsedEmails.length
      estimateHint =
        'This is the number of email inputs. Only matching member, coach, or assistant coach profiles will actually receive the message.'
    }

    return {
      audienceLabel,
      eligibleRoles,
      estimatedRecipients,
      estimateHint,
    }
  }, [audience, counts, customMode, parsedEmails.length, selectedIds.length])

  const recipientGuardrail =
    'Only members, coaches, and assistant coaches can receive notifications from this screen. Admin, super admin, and reception are excluded until they have a visible inbox flow.'

  async function onSend(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMsg('')
    setFeedback(null)
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
            setMsg('Please select at least one recipient.')
            setBusy(false)
            return
          }
          payload.user_ids = selectedIds
        } else {
          if (parsedEmails.length === 0) {
            setMsg('Please provide at least one email for custom audience.')
            setBusy(false)
            return
          }
          payload.emails = parsedEmails
        }
      }

      const r = await fetch('/api/notifications/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j?.ok) {
        setMsg(j?.details || j?.error || 'Failed to send')
        return
      }

      setFeedback(j)
      const delivered = Number(j?.count || 0)
      const unmatched = Number(j?.delivery_feedback?.unmatched_email_count || 0)
      const filteredOut = Number(j?.delivery_feedback?.filtered_out_user_ids || 0)
      let summary = `Sent to ${delivered} eligible recipient${delivered === 1 ? '' : 's'}.`
      if (unmatched > 0 || filteredOut > 0) {
        summary += ` ${unmatched + filteredOut} input${unmatched + filteredOut === 1 ? '' : 's'} did not resolve to an eligible inbox recipient.`
      }
      setMsg(summary)
      setBody('')
      setSelectedIds([])
      setEmails('')
      window.dispatchEvent(new Event('notifications:updated'))
      window.dispatchEvent(new Event('atom:reload'))
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

          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {recipientGuardrail}
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-4">
              <div className="text-xs uppercase tracking-wide text-[hsl(var(--muted))]">Target group</div>
              <div className="mt-1 text-sm font-semibold">{targetPreview.audienceLabel}</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {targetPreview.eligibleRoles.map((role) => (
                  <span key={role} className="rounded-full border border-[hsl(var(--border))] px-2.5 py-1 text-xs font-medium">
                    {roleLabel(role)}
                  </span>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-4">
              <div className="text-xs uppercase tracking-wide text-[hsl(var(--muted))]">Estimated recipients</div>
              <div className="mt-1 text-2xl font-semibold">{targetPreview.estimatedRecipients}</div>
              <p className="mt-2 text-xs text-[hsl(var(--muted))]">{targetPreview.estimateHint}</p>
            </div>

            <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-4">
              <div className="text-xs uppercase tracking-wide text-[hsl(var(--muted))]">Delivery feedback</div>
              {feedback ? (
                <div className="mt-1 space-y-1 text-sm">
                  <div className="font-semibold">{feedback.count} recipient{feedback.count === 1 ? '' : 's'} received the last send.</div>
                  {typeof feedback.delivery_feedback?.unmatched_email_count === 'number' && feedback.delivery_feedback.unmatched_email_count > 0 ? (
                    <div className="text-[hsl(var(--muted))]">{feedback.delivery_feedback.unmatched_email_count} email input{feedback.delivery_feedback.unmatched_email_count === 1 ? '' : 's'} did not match an eligible profile.</div>
                  ) : null}
                  {typeof feedback.delivery_feedback?.filtered_out_user_ids === 'number' && feedback.delivery_feedback.filtered_out_user_ids > 0 ? (
                    <div className="text-[hsl(var(--muted))]">{feedback.delivery_feedback.filtered_out_user_ids} selected user{feedback.delivery_feedback.filtered_out_user_ids === 1 ? '' : 's'} were filtered out because the role has no visible inbox.</div>
                  ) : null}
                </div>
              ) : (
                <p className="mt-1 text-sm text-[hsl(var(--muted))]">After sending, this panel explains how many eligible recipients were reached and what was filtered out.</p>
              )}
            </div>
          </div>

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
                  <span>Pick recipients</span>
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
                  placeholder="member1@ex.com, coach1@ex.com"
                  disabled={busy}
                />
              )}
            </div>
          )}

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

          {feedback && (
            <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-soft">
              <div className="text-sm font-semibold">Last delivery summary</div>
              <div className="mt-2 grid gap-2 text-sm md:grid-cols-2">
                <div>
                  <span className="text-[hsl(var(--muted))]">Audience:</span> {feedback.audience_label || targetPreview.audienceLabel}
                </div>
                <div>
                  <span className="text-[hsl(var(--muted))]">Delivered:</span> {feedback.count}
                </div>
                {typeof feedback.delivery_feedback?.requested_user_ids === 'number' && feedback.delivery_feedback.requested_user_ids > 0 ? (
                  <div>
                    <span className="text-[hsl(var(--muted))]">Selected users:</span> {feedback.delivery_feedback.requested_user_ids}
                  </div>
                ) : null}
                {typeof feedback.delivery_feedback?.requested_emails === 'number' && feedback.delivery_feedback.requested_emails > 0 ? (
                  <div>
                    <span className="text-[hsl(var(--muted))]">Email inputs:</span> {feedback.delivery_feedback.requested_emails}
                  </div>
                ) : null}
                {typeof feedback.delivery_feedback?.matched_email_profiles === 'number' && feedback.delivery_feedback.matched_email_profiles > 0 ? (
                  <div>
                    <span className="text-[hsl(var(--muted))]">Matched emails:</span> {feedback.delivery_feedback.matched_email_profiles}
                  </div>
                ) : null}
                {typeof feedback.delivery_feedback?.filtered_out_user_ids === 'number' && feedback.delivery_feedback.filtered_out_user_ids > 0 ? (
                  <div>
                    <span className="text-[hsl(var(--muted))]">Filtered users:</span> {feedback.delivery_feedback.filtered_out_user_ids}
                  </div>
                ) : null}
              </div>
              {feedback.delivery_feedback?.unmatched_emails?.length ? (
                <p className="mt-3 text-xs text-[hsl(var(--muted))]">
                  Unmatched emails: {feedback.delivery_feedback.unmatched_emails.join(', ')}
                  {feedback.delivery_feedback.unmatched_email_count && feedback.delivery_feedback.unmatched_email_count > feedback.delivery_feedback.unmatched_emails.length ? '…' : ''}
                </p>
              ) : null}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="submit"
              disabled={
                busy ||
                !body.trim() ||
                (audience === 'custom' && customMode === 'pick' && selectedIds.length === 0) ||
                (audience === 'custom' && customMode === 'emails' && parsedEmails.length === 0)
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
