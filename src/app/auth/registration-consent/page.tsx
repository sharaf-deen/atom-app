// Registration-specific legal finalization. The existing server endpoint remains the authority.
'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabaseBrowser'

type Document = { id: string; title: string; version: string; url: string; status: string; required: boolean }
type Compliance = { ok?: boolean; code?: string; complete?: boolean; is_minor?: boolean; signer_name?: string | null; guardian_relationship?: string | null; guardian_review_required?: boolean; requiredCount?: number; missingDocuments?: { id: string }[] }
function safeNext(value: string | null) {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\') || value.includes('://') || value.startsWith('/auth/')) return '/profile'
  return value
}

function ConsentContent() {
  const params = useSearchParams()
  const router = useRouter()
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])
  const destination = safeNext(params.get('next'))
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [compliance, setCompliance] = useState<Compliance | null>(null)
  const [documents, setDocuments] = useState<Document[]>([])
  const [accepted, setAccepted] = useState<string[]>([])
  const [signer, setSigner] = useState('')

  useEffect(() => {
    let alive = true
    async function load() {
      try {
        const [{ data: identity }, status, docsResponse] = await Promise.all([
          supabase.auth.getUser(),
          fetch('/api/public-registration/legal-consent/finalize', { cache: 'no-store', credentials: 'same-origin' }),
          fetch('/api/legal-documents/registration', { cache: 'no-store', credentials: 'same-origin' }),
        ])
        if (!alive) return
        if (!identity.user) { router.replace('/login'); return }
        const state: Compliance = await status.json().catch(() => ({}))
        if (!status.ok || state.ok !== true) { setMessage(`Legal setup unavailable (${state.code || status.status}). Contact ATOM reception.`); return }
        if (state.is_minor) {
          setCompliance(state)
          setMessage('A staff review of parental or legal guardian authority is required before legal consent can be recorded. No document is accepted automatically.')
          return
        }
        if (state.complete && Number(state.requiredCount) > 0) { router.replace(destination); return }
        const result = await docsResponse.json().catch(() => ({}))
        if (!docsResponse.ok || result.ok !== true) { setMessage('Unable to load legal documents. Please try again later.'); return }
        const required: Document[] = (Array.isArray(result.documents) ? result.documents : []).filter((doc: Document) => doc.status === 'active' && doc.required)
        if (!required.length || required.length !== state.requiredCount) { setMessage('Legal document versions require review. Please contact ATOM reception.'); return }
        setCompliance(state)
        setDocuments(required)
        setSigner(typeof state.signer_name === 'string' ? state.signer_name : '')
      } catch { if (alive) setMessage('Unable to check legal requirements. Please try again later.') }
      finally { if (alive) setLoading(false) }
    }
    void load()
    return () => { alive = false }
  }, [destination, router, supabase])

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || documents.length === 0 || accepted.length !== documents.length || !signer.trim()) return
    setBusy(true); setMessage(null)
    try {
      const response = await fetch('/api/public-registration/legal-consent/finalize', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ legal_acceptance: {
          accepted_document_version_ids: accepted,
          acceptor_name: signer.trim(), acceptor_capacity: 'participant',
        } }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok || !result.ok || !result.complete) { setMessage(`Consent not completed (${result.code || response.status}). Please review the documents or contact reception.`); return }
      // Independent server recheck: never rely only on the mutation response.
      const check = await fetch('/api/public-registration/legal-consent/finalize', { cache: 'no-store', credentials: 'same-origin' })
      const verified: Compliance = await check.json().catch(() => ({}))
      if (!check.ok || verified.ok !== true || !verified.complete || Number(verified.requiredCount) === 0) {
        setMessage('Your acceptance was recorded, but completion could not be confirmed. Please contact reception.'); return
      }
      router.replace(destination)
    } catch { setMessage('Unable to finalize legal acceptance. Please try again or contact reception.') }
    finally { setBusy(false) }
  }

  return (
    <main className="min-h-[75vh] bg-gray-50 px-4 py-10">
      <div className="mx-auto w-full max-w-xl rounded-2xl border bg-white p-5 shadow-sm sm:p-7">
        <p className="text-xs font-semibold uppercase tracking-widest text-gray-500">ATOM · Member registration</p>
        <h1 className="mt-2 text-2xl font-semibold">Complete your legal setup</h1>
        <p className="mt-2 text-sm text-gray-600">Read each required document using its link, then accept each current version separately. Nothing is preselected.</p>
        {loading && <p className="mt-5 text-sm" role="status">Checking legal requirements…</p>}
        {message && <div className="mt-5 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" role="alert">{message}</div>}
        {!loading && compliance?.is_minor && (
          <div className="mt-5 rounded-xl border border-gray-200 bg-white p-4 text-sm">
            <p className="font-semibold">Parent / guardian review pending</p>
            <p className="mt-2">The parent account and child membership have been created, but guardian authority has not yet been independently verified by ATOM staff.</p>
            <p className="mt-2">Declared guardian: {compliance.signer_name || 'Not available'}</p>
            <p className="mt-1">Declared relationship: {compliance.guardian_relationship || 'Not available'}</p>
            <p className="mt-2 text-gray-600">Please contact ATOM reception for identity and legal authority review. Legal acceptance remains pending.</p>
          </div>
        )}
        {!loading && compliance && documents.length > 0 && (
          <form onSubmit={submit} className="mt-6 space-y-4">
            {documents.map(doc => (
              <div className="rounded-xl border p-4" key={doc.id}>
                <div className="text-sm font-semibold">{doc.title} <span className="font-normal text-gray-500">v{doc.version}</span></div>
                <a className="mt-2 inline-block text-sm underline underline-offset-2" href={doc.url} target="_blank" rel="noopener noreferrer">Open and read the document</a>
                <label className="mt-3 flex items-start gap-3 text-sm">
                  <input type="checkbox" className="mt-1 h-4 w-4" disabled={busy} checked={accepted.includes(doc.id)} onChange={e => setAccepted(current => e.target.checked ? [...current, doc.id] : current.filter(id => id !== doc.id))} />
                  <span>I have read and accept this document (version {doc.version}).</span>
                </label>
              </div>
            ))}
            <label className="block text-sm font-medium">Your full legal name
              <input className="mt-1 w-full rounded-lg border px-3 py-2" required disabled={busy} autoComplete="name" value={signer} onChange={e => setSigner(e.target.value)} />
            </label>
            <button className="w-full rounded-lg bg-black px-4 py-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40" type="submit" disabled={busy || accepted.length !== documents.length || !signer.trim()}>
              {busy ? 'Confirming…' : 'Accept documents and continue'}
            </button>
          </form>
        )}
      </div>
    </main>
  )
}
export default function RegistrationConsentPage() {
  return <Suspense fallback={<main className="p-8 text-sm">Loading legal setup…</main>}><ConsentContent /></Suspense>
}
