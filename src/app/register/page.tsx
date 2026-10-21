import type { Metadata } from 'next'
import Link from 'next/link'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { loadActiveMemberProgramOptions } from '@/lib/memberPrograms'
import PublicRegistrationForm from '@/components/public-registration/PublicRegistrationForm'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

export const metadata: Metadata = {
  title: 'Member registration | ATOM Jiu-Jitsu',
  description: 'ATOM Jiu-Jitsu member registration',
  robots: { index: false, follow: false },
}

type LegalDocument = { id: string; title: string; version: string; url: string }

export default async function PublicRegistrationPage() {
  // Do not advertise or activate this page until the secure public registration
  // endpoint, email verification and rate limits are deployed (1D.1B/1D.1C).
  if (process.env.ATOM_PUBLIC_REGISTRATION_PREVIEW !== 'true') {
    return (
      <main className="mx-auto max-w-xl px-5 py-16 text-center">
        <h1 className="text-2xl font-semibold">ATOM Member Registration</h1>
        <p className="mt-4 text-sm text-[hsl(var(--muted))]">Online registration is not available yet. Please contact ATOM Reception.</p>
        <Link className="mt-6 inline-block underline underline-offset-4" href="/">Back to ATOM App</Link>
      </main>
    )
  }

  try {
    const admin = createSupabaseAdminClient()
    const [programs, legalResult] = await Promise.all([
      loadActiveMemberProgramOptions(admin),
      admin.from('legal_document_versions')
        .select('id,title,version_label,published_url')
        .eq('status', 'active')
        .eq('is_required', true)
        .order('document_key', { ascending: true }),
    ])
    if (legalResult.error) throw legalResult.error
    const documents: LegalDocument[] = (legalResult.data ?? []).map((d: any) => ({
      id: String(d.id), title: String(d.title), version: String(d.version_label),
      url: String(d.published_url),
    }))
    if (!documents.length || !programs.length) throw new Error('PUBLIC_REGISTRATION_CONFIGURATION_INCOMPLETE')

    return <PublicRegistrationForm programs={programs} documents={documents} />
  } catch {
    return (
      <main className="mx-auto max-w-xl px-5 py-16 text-center">
        <h1 className="text-2xl font-semibold">Registration temporarily unavailable</h1>
        <p className="mt-4 text-sm text-[hsl(var(--muted))]">We could not load the registration requirements. Please contact ATOM Reception.</p>
        <Link className="mt-6 inline-block underline underline-offset-4" href="/">Back to ATOM App</Link>
      </main>
    )
  }
}
