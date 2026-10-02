'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { InactiveTemplateRow } from '@/components/admin/members/InactiveFollowupActions'

const LABELS: Record<InactiveTemplateRow['template_key'], string> = {
  general_follow_up: 'General follow-up',
  renewal: 'Renewal',
  no_membership: 'No membership yet',
  cancelled: 'Cancelled membership',
  win_back: 'Win-back',
}

export default function InactiveMessageTemplateAdmin({ templates }: { templates: InactiveTemplateRow[] }) {
  const router = useRouter()
  const [channel, setChannel] = useState<'whatsapp' | 'email'>('whatsapp')
  const [templateKey, setTemplateKey] = useState<InactiveTemplateRow['template_key']>('general_follow_up')
  const [language, setLanguage] = useState<'en' | 'ar'>('en')
  const [label, setLabel] = useState('')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const selected = useMemo(() => templates.find((row) =>
    row.channel === channel && row.template_key === templateKey && row.language === language
  ) ?? null, [templates, channel, templateKey, language])

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
      const response = await fetch('/api/admin/members/inactive-templates', {
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
      if (!response.ok || !data?.ok) throw new Error(data?.details || data?.error || 'Template update failed.')
      setNotice('Inactive template saved.')
      router.refresh()
    } catch (caught: any) {
      setError(String(caught?.message ?? caught ?? 'Template update failed.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <details className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
      <summary className="cursor-pointer font-semibold">Inactive message templates · Super Admin</summary>
      <div className="mt-4 space-y-4">
        <p className="text-sm text-[hsl(var(--muted))]">
          Variables: {'{{first_name}}'}, {'{{inactive_days}}'}, {'{{expiry_date}}'}, {'{{due_amount}}'}, {'{{plan}}'}.
        </p>

        <div className="grid gap-3 sm:grid-cols-3">
          <label className="space-y-1 text-sm">
            <span className="font-medium">Channel</span>
            <select value={channel} onChange={(event) => setChannel(event.target.value as 'whatsapp' | 'email')} className="w-full rounded-xl border px-3 py-2">
              <option value="whatsapp">WhatsApp</option>
              <option value="email">Email</option>
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium">Type</span>
            <select value={templateKey} onChange={(event) => setTemplateKey(event.target.value as InactiveTemplateRow['template_key'])} className="w-full rounded-xl border px-3 py-2">
              {(Object.keys(LABELS) as InactiveTemplateRow['template_key'][]).map((key) => <option key={key} value={key}>{LABELS[key]}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium">Language</span>
            <select value={language} onChange={(event) => setLanguage(event.target.value as 'en' | 'ar')} className="w-full rounded-xl border px-3 py-2">
              <option value="en">English</option>
              <option value="ar">العربية</option>
            </select>
          </label>
        </div>

        {!selected ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Template not found. Apply the Inactive UX 1A migration.</div>
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
          <button type="button" disabled={!selected || busy || !label.trim() || !message.trim() || (channel === 'email' && !subject.trim())} onClick={() => void save()} className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
            {busy ? 'Saving…' : 'Save template'}
          </button>
        </div>
      </div>
    </details>
  )
}
