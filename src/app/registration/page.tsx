export const dynamic = 'force-dynamic'
export const revalidate = 0

import PublicRegistrationForm from '@/components/public-registration/PublicRegistrationForm'
import { loadActiveMemberProgramOptions } from '@/lib/memberPrograms'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'

/** Public invitation link: form submission never creates or activates an Auth account. */
export default async function RegistrationPage() {
  const admin = createSupabaseAdminClient()
  const [{ data: versions, error: documentsError }, programsResult] = await Promise.all([
    admin.from('legal_document_versions')
      .select('id,title,version_label,published_url,is_required')
      .eq('status', 'active').eq('is_required', true)
      .order('document_key', { ascending: true }),
    loadActiveMemberProgramOptions(admin).catch(() => null),
  ])
  const documents = (versions ?? [])
    .filter((d: any) => d.is_required && typeof d.published_url === 'string' && /^https:\/\//i.test(d.published_url))
    .map((d: any) => ({ id: String(d.id), title: String(d.title), version: String(d.version_label), url: String(d.published_url) }))
  const isPreview = process.env.VERCEL_ENV === 'preview' || process.env.VERCEL_ENV === 'development'
  const launchMode = process.env.ATOM_REGISTRATION_ACCESS_MODE
  const launchAllowed = isPreview || launchMode === 'pilot' || launchMode === 'public'
  const enabled = process.env.ATOM_PUBLIC_REGISTRATION_SUBMIT_ENABLED === 'true'
    && Boolean(process.env.ATOM_REGISTRATION_RATE_LIMIT_SECRET && process.env.ATOM_REGISTRATION_RATE_LIMIT_SECRET.length >= 32)
    && launchAllowed && !documentsError && documents.length > 0 && Boolean(programsResult?.length)

  return <PublicRegistrationForm programs={programsResult ?? []} documents={documents} submitEnabled={enabled} />
}
