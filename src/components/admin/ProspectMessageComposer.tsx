'use client'

import { useEffect, useMemo, useState } from 'react'
import type {
  ProspectMessageTemplateRow,
  ProspectRow,
  ProspectSubmissionRow,
} from '@/app/admin/prospects/page'

export type MessageChannel = 'whatsapp' | 'email'
export type MessageTemplateKey = 'first_contact' | 'follow_up' | 'trial_reminder'
export type MessageLanguage = 'en' | 'ar'

export type MessageComposerRequest = {
  prospect: ProspectRow
  latestSubmission: ProspectSubmissionRow | null
  channel: MessageChannel
}

type ComposerProps = {
  request: MessageComposerRequest | null
  templates: ProspectMessageTemplateRow[]
  busy: boolean
  onClose: () => void
  onInitiate: (request: MessageComposerRequest, subject: string, message: string) => Promise<boolean>
}

type AdminProps = {
  templates: ProspectMessageTemplateRow[]
  onUpdated: (template: ProspectMessageTemplateRow) => void
}

const KEY_LABELS: Record<MessageTemplateKey, string> = {
  first_contact: 'First Contact',
  follow_up: 'Follow-Up',
  trial_reminder: 'Trial Reminder',
}

function defaultKey(prospect: ProspectRow): MessageTemplateKey {
  if (prospect.status === 'new') return 'first_contact'
  if (prospect.status === 'trial_booked') return 'trial_reminder'
  return 'follow_up'
}

function firstName(fullName: string) {
  return fullName.trim().split(/\s+/)[0] || fullName.trim() || 'there'
}

function formatTrialDate(value: string | null, language: MessageLanguage) {
  if (!value) return language === 'ar' ? 'الموعد المتفق عليه' : 'the agreed date'
  const date = new Date(`${value}T12:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(language === 'ar' ? 'ar-EG' : 'en-GB', {
    dateStyle: 'long',
    timeZone: 'Africa/Cairo',
  }).format(date)
}

function applyVariables(
  value: string | null,
  request: MessageComposerRequest,
  language: MessageLanguage,
) {
  const requestedClass = request.latestSubmission?.requested_classes?.[0]
    || (language === 'ar' ? 'تدريب الجيوجيتسو' : 'Jiu-Jitsu training')
  const variables: Record<string, string> = {
    first_name: firstName(request.prospect.full_name),
    requested_class: requestedClass,
    trial_date: formatTrialDate(request.prospect.linked_visitor_trial_date, language),
  }

  return String(value ?? '').replace(/{{\s*(first_name|requested_class|trial_date)\s*}}/g, (_, key: string) => variables[key] ?? '')
}

function templateId(channel: MessageChannel, key: MessageTemplateKey, language: MessageLanguage) {
  return `${channel}:${key}:${language}`
}

export default function ProspectMessageComposer({
  request,
  templates,
  busy,
  onClose,
  onInitiate,
}: ComposerProps) {
  const [templateKey, setTemplateKey] = useState<MessageTemplateKey>('first_contact')
  const [language, setLanguage] = useState<MessageLanguage>('en')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')

  const selected = useMemo(() => {
    if (!request) return null
    return templates.find((item) => (
      item.channel === request.channel
      && item.template_key === templateKey
      && item.language === language
      && item.is_active
    )) ?? null
  }, [templates, request, templateKey, language])

  useEffect(() => {
    if (!request) return
    setTemplateKey(defaultKey(request.prospect))
    setLanguage('en')
  }, [request])

  useEffect(() => {
    if (!request || !selected) {
      setSubject('')
      setMessage('')
      return
    }
    setSubject(applyVariables(selected.subject_template, request, language))
    setMessage(applyVariables(selected.body_template, request, language))
  }, [request, selected, language])

  if (!request) return null

  const isArabic = language === 'ar'
  const destination = request.channel === 'whatsapp' ? request.prospect.phone : request.prospect.email

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="Preview message">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Preview {request.channel === 'whatsapp' ? 'WhatsApp' : 'email'}</h2>
            <p className="text-sm text-[hsl(var(--muted))]">{request.prospect.full_name} · {destination}</p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} className="rounded-lg border px-3 py-1.5 text-sm font-semibold disabled:opacity-50">
            Close
          </button>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="font-medium">Message type</span>
            <select
              value={templateKey}
              onChange={(event) => setTemplateKey(event.target.value as MessageTemplateKey)}
              className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2"
            >
              {(Object.keys(KEY_LABELS) as MessageTemplateKey[]).map((key) => (
                <option key={key} value={key}>{KEY_LABELS[key]}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium">Language</span>
            <select
              value={language}
              onChange={(event) => setLanguage(event.target.value as MessageLanguage)}
              className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2"
            >
              <option value="en">English</option>
              <option value="ar">العربية</option>
            </select>
          </label>
        </div>

        {!selected ? (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            This template is unavailable. Ask a Super Admin to check the message templates.
          </div>
        ) : (
          <div className="mt-4 space-y-3" dir={isArabic ? 'rtl' : 'ltr'}>
            {request.channel === 'email' ? (
              <label className="block space-y-1 text-sm">
                <span className="font-medium">Subject</span>
                <input
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
                  maxLength={300}
                  className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2"
                />
              </label>
            ) : null}
            <label className="block space-y-1 text-sm">
              <span className="font-medium">Message preview</span>
              <textarea
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                rows={9}
                maxLength={4000}
                className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 leading-relaxed"
              />
            </label>
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-[hsl(var(--muted))]">
            Opening the app records “contact initiated”; it does not confirm delivery.
          </p>
          <button
            type="button"
            disabled={!selected || !message.trim() || (request.channel === 'email' && !subject.trim()) || busy}
            onClick={() => void onInitiate(request, subject.trim(), message.trim())}
            className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            {busy ? 'Opening…' : `Open ${request.channel === 'whatsapp' ? 'WhatsApp' : 'email app'}`}
          </button>
        </div>
      </div>
    </div>
  )
}

export function ProspectTemplateAdmin({ templates, onUpdated }: AdminProps) {
  const [channel, setChannel] = useState<MessageChannel>('whatsapp')
  const [templateKey, setTemplateKey] = useState<MessageTemplateKey>('first_contact')
  const [language, setLanguage] = useState<MessageLanguage>('en')
  const [label, setLabel] = useState('')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const selected = useMemo(() => templates.find((item) => (
    templateId(item.channel, item.template_key, item.language) === templateId(channel, templateKey, language)
  )) ?? null, [templates, channel, templateKey, language])

  useEffect(() => {
    setLabel(selected?.label ?? '')
    setSubject(selected?.subject_template ?? '')
    setMessage(selected?.body_template ?? '')
    setNotice(null)
    setError(null)
  }, [selected])

  async function save() {
    if (!selected || busy) return
    setBusy(true)
    setNotice(null)
    setError(null)
    try {
      const response = await fetch('/api/admin/prospects/templates', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel,
          template_key: templateKey,
          language,
          label,
          subject_template: subject,
          body_template: message,
        }),
      })
      const data = await response.json()
      if (!response.ok || !data?.ok) throw new Error(data?.error || 'Template update failed.')
      onUpdated(data.template as ProspectMessageTemplateRow)
      setNotice('Template saved.')
    } catch (caught: any) {
      setError(String(caught?.message ?? caught ?? 'Template update failed.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <details className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
      <summary className="cursor-pointer font-semibold">Message templates · Super Admin</summary>
      <div className="mt-4 space-y-4">
        <p className="text-sm text-[hsl(var(--muted))]">
          Edit the defaults used in previews. Available variables: {'{{first_name}}'}, {'{{requested_class}}'}, {'{{trial_date}}'}.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="space-y-1 text-sm">
            <span className="font-medium">Channel</span>
            <select value={channel} onChange={(event) => setChannel(event.target.value as MessageChannel)} className="w-full rounded-xl border px-3 py-2">
              <option value="whatsapp">WhatsApp</option>
              <option value="email">Email</option>
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium">Type</span>
            <select value={templateKey} onChange={(event) => setTemplateKey(event.target.value as MessageTemplateKey)} className="w-full rounded-xl border px-3 py-2">
              {(Object.keys(KEY_LABELS) as MessageTemplateKey[]).map((key) => <option key={key} value={key}>{KEY_LABELS[key]}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium">Language</span>
            <select value={language} onChange={(event) => setLanguage(event.target.value as MessageLanguage)} className="w-full rounded-xl border px-3 py-2">
              <option value="en">English</option>
              <option value="ar">العربية</option>
            </select>
          </label>
        </div>

        {!selected ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Template not found. Apply the lot 1F migration first.</div>
        ) : (
          <div className="space-y-3" dir={language === 'ar' ? 'rtl' : 'ltr'}>
            <label className="block space-y-1 text-sm">
              <span className="font-medium">Label</span>
              <input value={label} onChange={(event) => setLabel(event.target.value)} maxLength={120} className="w-full rounded-xl border px-3 py-2" />
            </label>
            {channel === 'email' ? (
              <label className="block space-y-1 text-sm">
                <span className="font-medium">Subject template</span>
                <input value={subject} onChange={(event) => setSubject(event.target.value)} maxLength={300} className="w-full rounded-xl border px-3 py-2" />
              </label>
            ) : null}
            <label className="block space-y-1 text-sm">
              <span className="font-medium">Message template</span>
              <textarea value={message} onChange={(event) => setMessage(event.target.value)} rows={7} maxLength={4000} className="w-full rounded-xl border px-3 py-2 leading-relaxed" />
            </label>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm">
            {notice ? <span className="text-emerald-700">{notice}</span> : null}
            {error ? <span className="text-rose-700">{error}</span> : null}
          </div>
          <button type="button" onClick={() => void save()} disabled={!selected || busy || !label.trim() || !message.trim() || (channel === 'email' && !subject.trim())} className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
            {busy ? 'Saving…' : 'Save template'}
          </button>
        </div>
      </div>
    </details>
  )
}
