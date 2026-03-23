import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import { Award, Dumbbell, FileText, Medal, Save, ShieldCheck, Trash2, Trophy, Upload } from 'lucide-react'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { createSupabaseRSC } from '@/lib/supabaseServer'
import { isMemberLikeRole } from '@/lib/rbac'
import { getSessionUser, type Role } from '@/lib/session'

type TrainingProfileRow = {
  member_user_id: string
  program_level: ProgramLevel | null
  notes: string | null
  updated_at: string | null
  updated_by: string | null
}

type BeltPromotionRow = {
  id: string
  member_user_id: string
  belt_code: string
  promoted_at: string
  certificate_path: string | null
  certificate_filename: string | null
  certificate_mime: string | null
  certificate_size_bytes: number | null
  notes: string | null
  created_at: string | null
  created_by: string | null
  updated_at?: string | null
  updated_by?: string | null
}

type CompetitionResult = 'gold' | 'silver' | 'bronze' | 'other'

type CompetitionResultRow = {
  id: string
  member_user_id: string
  competition_name: string
  competition_date: string
  division: string | null
  category: string | null
  result: CompetitionResult
  notes: string | null
  created_at: string | null
  created_by: string | null
  updated_at: string | null
  updated_by: string | null
}

type ProgramLevel = 'beginner' | 'intermediate' | 'advanced' | 'competitor'

type Props = {
  memberUserId: string
  targetRole: Role | null
  viewerRole: Role
  isSelf: boolean
  age: number | null
  nextPath: string
}

const PROGRAM_OPTIONS = ['beginner', 'intermediate', 'advanced', 'competitor'] as const satisfies readonly ProgramLevel[]
const KID_BELTS = ['white', 'grey', 'yellow', 'orange', 'green'] as const
const ADULT_BELTS = ['white', 'blue', 'purple', 'brown', 'black'] as const
const ALL_BELTS = Array.from(new Set([...KID_BELTS, ...ADULT_BELTS]))
const RESULT_OPTIONS = ['gold', 'silver', 'bronze', 'other'] as const satisfies readonly CompetitionResult[]
const CERTIFICATE_MAX_BYTES = 8 * 1024 * 1024

function fmtDate(dateStr?: string | null) {
  if (!dateStr) return '—'
  const dt = new Date(dateStr.length === 10 ? `${dateStr}T00:00:00Z` : dateStr)
  if (Number.isNaN(dt.getTime())) return dateStr
  return new Intl.DateTimeFormat('en-GB', { year: 'numeric', month: 'short', day: '2-digit' }).format(dt)
}

function formatBytes(value?: number | null) {
  const size = Number(value ?? 0)
  if (!Number.isFinite(size) || size <= 0) return '—'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function titleCase(value: string) {
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function beltLabel(code?: string | null) {
  if (!code) return '—'
  return titleCase(code)
}

function resultLabel(result?: CompetitionResult | null) {
  if (!result) return '—'
  return titleCase(result)
}

function normalizeFileName(name: string) {
  return (name || 'certificate').replace(/[^a-zA-Z0-9._-]+/g, '_')
}

function inferCertificateMime(file: File) {
  const typed = (file.type || '').toLowerCase()
  if (typed === 'application/pdf' || typed === 'image/jpeg' || typed === 'image/png' || typed === 'image/webp') return typed

  const lower = (file.name || '').toLowerCase()
  if (lower.endsWith('.pdf')) return 'application/pdf'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.webp')) return 'image/webp'
  return ''
}

function isProgramLevel(value: string): value is ProgramLevel {
  return (PROGRAM_OPTIONS as readonly string[]).includes(value)
}

function isBeltCode(value: string) {
  return (ALL_BELTS as readonly string[]).includes(value)
}

function isCompetitionResult(value: string): value is CompetitionResult {
  return (RESULT_OPTIONS as readonly string[]).includes(value)
}

function canEditAthleteProfile(viewerRole: Role | null | undefined, targetRole: Role | null | undefined) {
  if (viewerRole !== 'head_coach' && viewerRole !== 'super_admin') return false
  return isMemberLikeRole(targetRole)
}

async function uploadCertificateFile(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  memberUserId: string,
  beltPromotionId: string,
  certificate: FormDataEntryValue | null,
) {
  if (!(certificate && typeof (certificate as any)?.arrayBuffer === 'function')) {
    return {
      certificate_path: null as string | null,
      certificate_mime: null as string | null,
      certificate_filename: null as string | null,
      certificate_size_bytes: null as number | null,
    }
  }

  const file = certificate as File
  if (file.size <= 0) {
    return {
      certificate_path: null as string | null,
      certificate_mime: null as string | null,
      certificate_filename: null as string | null,
      certificate_size_bytes: null as number | null,
    }
  }

  if (file.size > CERTIFICATE_MAX_BYTES) {
    throw new Error('Certificate file is too large (max 8MB).')
  }

  const mime = inferCertificateMime(file)
  if (!mime) {
    throw new Error('Certificate must be a PDF, JPG, PNG, or WEBP file.')
  }

  const safeName = normalizeFileName(file.name || 'certificate')
  const path = `belt-certificates/${memberUserId}/${beltPromotionId}/${Date.now()}-${safeName}`
  const ab = await file.arrayBuffer()
  const up = await admin.storage.from('belt-certificates').upload(path, ab, {
    contentType: mime,
    upsert: false,
  })

  if (up.error) {
    throw new Error(up.error.message || 'Certificate upload failed.')
  }

  return {
    certificate_path: path,
    certificate_mime: mime,
    certificate_filename: file.name || safeName,
    certificate_size_bytes: file.size,
  }
}

async function deleteCertificatePath(admin: ReturnType<typeof createSupabaseAdminClient>, path?: string | null) {
  if (!path) return
  await admin.storage.from('belt-certificates').remove([path])
}

async function saveTrainingProfileAction(formData: FormData) {
  'use server'

  const me = await getSessionUser()
  const nextPath = String(formData.get('nextPath') || '/members')
  const memberUserId = String(formData.get('memberUserId') || '')
  const targetRoleRaw = String(formData.get('targetRole') || '')
  const programLevelRaw = String(formData.get('program_level') || '').trim().toLowerCase()

  if (!me || !memberUserId || !targetRoleRaw || !isProgramLevel(programLevelRaw)) {
    redirect(nextPath)
  }

  const targetRole = targetRoleRaw as Role
  if (!canEditAthleteProfile(me.role, targetRole)) {
    redirect(nextPath)
  }

  const admin = createSupabaseAdminClient()
  const upsert = await admin
    .from('member_training_profiles')
    .upsert(
      {
        member_user_id: memberUserId,
        program_level: programLevelRaw,
        updated_by: me.id,
      },
      { onConflict: 'member_user_id' },
    )

  if (upsert.error) {
    throw new Error(upsert.error.message)
  }

  revalidatePath(nextPath)
  redirect(nextPath)
}

async function deleteTrainingProfileAction(formData: FormData) {
  'use server'

  const me = await getSessionUser()
  const nextPath = String(formData.get('nextPath') || '/members')
  const memberUserId = String(formData.get('memberUserId') || '')
  const targetRoleRaw = String(formData.get('targetRole') || '')

  if (!me || !memberUserId || !targetRoleRaw) {
    redirect(nextPath)
  }

  const targetRole = targetRoleRaw as Role
  if (!canEditAthleteProfile(me.role, targetRole)) {
    redirect(nextPath)
  }

  const admin = createSupabaseAdminClient()
  const del = await admin
    .from('member_training_profiles')
    .delete()
    .eq('member_user_id', memberUserId)

  if (del.error) {
    throw new Error(del.error.message)
  }

  revalidatePath(nextPath)
  redirect(nextPath)
}

async function addBeltPromotionAction(formData: FormData) {
  'use server'

  const me = await getSessionUser()
  const nextPath = String(formData.get('nextPath') || '/members')
  const memberUserId = String(formData.get('memberUserId') || '')
  const targetRoleRaw = String(formData.get('targetRole') || '')
  const beltCode = String(formData.get('belt_code') || '').trim().toLowerCase()
  const promotedAt = String(formData.get('promoted_at') || '').trim()
  const notes = String(formData.get('notes') || '').trim() || null
  const certificate = formData.get('certificate')

  if (!me || !memberUserId || !targetRoleRaw || !beltCode || !promotedAt) {
    redirect(nextPath)
  }

  const targetRole = targetRoleRaw as Role
  if (!canEditAthleteProfile(me.role, targetRole) || !isBeltCode(beltCode)) {
    redirect(nextPath)
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(promotedAt)) {
    redirect(nextPath)
  }

  const admin = createSupabaseAdminClient()
  const beltPromotionId = crypto.randomUUID()
  const upload = await uploadCertificateFile(admin, memberUserId, beltPromotionId, certificate)

  const insert = await admin.from('member_belt_promotions').insert({
    id: beltPromotionId,
    member_user_id: memberUserId,
    belt_code: beltCode,
    promoted_at: promotedAt,
    certificate_path: upload.certificate_path,
    certificate_mime: upload.certificate_mime,
    certificate_filename: upload.certificate_filename,
    certificate_size_bytes: upload.certificate_size_bytes,
    notes,
    created_by: me.id,
    updated_by: me.id,
  })

  if (insert.error) {
    throw new Error(insert.error.message)
  }

  revalidatePath(nextPath)
  redirect(nextPath)
}

async function saveBeltPromotionAction(formData: FormData) {
  'use server'

  const me = await getSessionUser()
  const nextPath = String(formData.get('nextPath') || '/members')
  const memberUserId = String(formData.get('memberUserId') || '')
  const targetRoleRaw = String(formData.get('targetRole') || '')
  const beltPromotionId = String(formData.get('beltPromotionId') || '').trim()
  const beltCode = String(formData.get('belt_code') || '').trim().toLowerCase()
  const promotedAt = String(formData.get('promoted_at') || '').trim()
  const notes = String(formData.get('notes') || '').trim() || null
  const certificate = formData.get('certificate')

  if (!me || !memberUserId || !targetRoleRaw || !beltPromotionId || !beltCode || !promotedAt) {
    redirect(nextPath)
  }

  const targetRole = targetRoleRaw as Role
  if (!canEditAthleteProfile(me.role, targetRole) || !isBeltCode(beltCode)) {
    redirect(nextPath)
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(promotedAt)) {
    redirect(nextPath)
  }

  const admin = createSupabaseAdminClient()
  const existingRes = await admin
    .from('member_belt_promotions')
    .select('id, certificate_path')
    .eq('id', beltPromotionId)
    .eq('member_user_id', memberUserId)
    .maybeSingle<{ id: string; certificate_path: string | null }>()

  if (existingRes.error || !existingRes.data) {
    throw new Error(existingRes.error?.message || 'Belt promotion not found.')
  }

  let upload = {
    certificate_path: existingRes.data.certificate_path,
    certificate_mime: null as string | null,
    certificate_filename: null as string | null,
    certificate_size_bytes: null as number | null,
  }

  const hasReplacement = certificate && typeof (certificate as any)?.arrayBuffer === 'function' && Number((certificate as File).size || 0) > 0
  if (hasReplacement) {
    const newUpload = await uploadCertificateFile(admin, memberUserId, beltPromotionId, certificate)
    await deleteCertificatePath(admin, existingRes.data.certificate_path)
    upload = newUpload
  }

  const update = await admin
    .from('member_belt_promotions')
    .update({
      belt_code: beltCode,
      promoted_at: promotedAt,
      notes,
      certificate_path: upload.certificate_path,
      certificate_mime: hasReplacement ? upload.certificate_mime : undefined,
      certificate_filename: hasReplacement ? upload.certificate_filename : undefined,
      certificate_size_bytes: hasReplacement ? upload.certificate_size_bytes : undefined,
      updated_by: me.id,
    })
    .eq('id', beltPromotionId)
    .eq('member_user_id', memberUserId)

  if (update.error) {
    throw new Error(update.error.message)
  }

  revalidatePath(nextPath)
  redirect(nextPath)
}

async function deleteBeltPromotionAction(formData: FormData) {
  'use server'

  const me = await getSessionUser()
  const nextPath = String(formData.get('nextPath') || '/members')
  const memberUserId = String(formData.get('memberUserId') || '')
  const targetRoleRaw = String(formData.get('targetRole') || '')
  const beltPromotionId = String(formData.get('beltPromotionId') || '').trim()

  if (!me || !memberUserId || !targetRoleRaw || !beltPromotionId) {
    redirect(nextPath)
  }

  const targetRole = targetRoleRaw as Role
  if (!canEditAthleteProfile(me.role, targetRole)) {
    redirect(nextPath)
  }

  const admin = createSupabaseAdminClient()
  const existingRes = await admin
    .from('member_belt_promotions')
    .select('id, certificate_path')
    .eq('id', beltPromotionId)
    .eq('member_user_id', memberUserId)
    .maybeSingle<{ id: string; certificate_path: string | null }>()

  if (existingRes.error || !existingRes.data) {
    throw new Error(existingRes.error?.message || 'Belt promotion not found.')
  }

  await deleteCertificatePath(admin, existingRes.data.certificate_path)

  const del = await admin
    .from('member_belt_promotions')
    .delete()
    .eq('id', beltPromotionId)
    .eq('member_user_id', memberUserId)

  if (del.error) {
    throw new Error(del.error.message)
  }

  revalidatePath(nextPath)
  redirect(nextPath)
}

async function saveCompetitionResultAction(formData: FormData) {
  'use server'

  const me = await getSessionUser()
  const nextPath = String(formData.get('nextPath') || '/members')
  const memberUserId = String(formData.get('memberUserId') || '')
  const targetRoleRaw = String(formData.get('targetRole') || '')
  const resultId = String(formData.get('resultId') || '').trim()
  const competitionName = String(formData.get('competition_name') || '').trim()
  const competitionDate = String(formData.get('competition_date') || '').trim()
  const division = String(formData.get('division') || '').trim() || null
  const category = String(formData.get('category') || '').trim() || null
  const result = String(formData.get('result') || '').trim().toLowerCase()
  const notes = String(formData.get('notes') || '').trim() || null

  if (!me || !memberUserId || !targetRoleRaw || !competitionName || !competitionDate || !isCompetitionResult(result)) {
    redirect(nextPath)
  }

  const targetRole = targetRoleRaw as Role
  if (!canEditAthleteProfile(me.role, targetRole)) {
    redirect(nextPath)
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(competitionDate)) {
    redirect(nextPath)
  }

  const admin = createSupabaseAdminClient()

  if (resultId) {
    const update = await admin
      .from('member_competition_results')
      .update({
        competition_name: competitionName,
        competition_date: competitionDate,
        division,
        category,
        result,
        notes,
        updated_by: me.id,
      })
      .eq('id', resultId)
      .eq('member_user_id', memberUserId)

    if (update.error) {
      throw new Error(update.error.message)
    }
  } else {
    const insert = await admin.from('member_competition_results').insert({
      id: crypto.randomUUID(),
      member_user_id: memberUserId,
      competition_name: competitionName,
      competition_date: competitionDate,
      division,
      category,
      result,
      notes,
      created_by: me.id,
      updated_by: me.id,
    })

    if (insert.error) {
      throw new Error(insert.error.message)
    }
  }

  revalidatePath(nextPath)
  redirect(nextPath)
}

async function deleteCompetitionResultAction(formData: FormData) {
  'use server'

  const me = await getSessionUser()
  const nextPath = String(formData.get('nextPath') || '/members')
  const memberUserId = String(formData.get('memberUserId') || '')
  const targetRoleRaw = String(formData.get('targetRole') || '')
  const resultId = String(formData.get('resultId') || '').trim()

  if (!me || !memberUserId || !targetRoleRaw || !resultId) {
    redirect(nextPath)
  }

  const targetRole = targetRoleRaw as Role
  if (!canEditAthleteProfile(me.role, targetRole)) {
    redirect(nextPath)
  }

  const admin = createSupabaseAdminClient()
  const del = await admin
    .from('member_competition_results')
    .delete()
    .eq('id', resultId)
    .eq('member_user_id', memberUserId)

  if (del.error) {
    throw new Error(del.error.message)
  }

  revalidatePath(nextPath)
  redirect(nextPath)
}

function badgeToneClass(tone: 'neutral' | 'success' | 'warning') {
  if (tone === 'success') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (tone === 'warning') return 'border-amber-200 bg-amber-50 text-amber-800'
  return 'border-[hsl(var(--border))] bg-[hsl(var(--bg))] text-[hsl(var(--muted))]'
}

function TinyBadge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'success' | 'warning' }) {
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${badgeToneClass(tone)}`}>{children}</span>
}

function DetailsEditor({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details className="group mt-3 rounded-2xl border border-[hsl(var(--border))] bg-white">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-4 py-3 text-sm font-medium text-black marker:content-none">
        <span>{label}</span>
        <span className="text-xs text-[hsl(var(--muted))] group-open:hidden">Open</span>
        <span className="hidden text-xs text-[hsl(var(--muted))] group-open:inline">Close</span>
      </summary>
      <div className="border-t border-[hsl(var(--border))] p-4">{children}</div>
    </details>
  )
}

export default async function AthleteProfileSection({ memberUserId, targetRole, viewerRole, isSelf, age, nextPath }: Props) {
  const adminDb = createSupabaseAdminClient()
  const sessionDb = createSupabaseRSC()
  const canReadViaAdmin = !isSelf && (viewerRole === 'reception' || viewerRole === 'admin' || viewerRole === 'super_admin' || viewerRole === 'coach' || viewerRole === 'head_coach')
  const db = canReadViaAdmin ? adminDb : sessionDb

  const [{ data: training }, { data: belts }, { data: competitions }] = await Promise.all([
    db
      .from('member_training_profiles')
      .select('member_user_id, program_level, notes, updated_at, updated_by')
      .eq('member_user_id', memberUserId)
      .maybeSingle<TrainingProfileRow>(),
    db
      .from('member_belt_promotions')
      .select('id, member_user_id, belt_code, promoted_at, certificate_path, certificate_filename, certificate_mime, certificate_size_bytes, notes, created_at, created_by, updated_at, updated_by')
      .eq('member_user_id', memberUserId)
      .order('promoted_at', { ascending: false })
      .order('created_at', { ascending: false })
      .returns<BeltPromotionRow[]>(),
    db
      .from('member_competition_results')
      .select('id, member_user_id, competition_name, competition_date, division, category, result, notes, created_at, created_by, updated_at, updated_by')
      .eq('member_user_id', memberUserId)
      .order('competition_date', { ascending: false })
      .order('created_at', { ascending: false })
      .returns<CompetitionResultRow[]>(),
  ])

  const beltRows = belts ?? []
  const competitionRows = competitions ?? []
  const currentBelt = beltRows[0]?.belt_code ?? null
  const currentYear = new Date().getUTCFullYear()
  const podiumsThisYear = competitionRows.filter((row) => {
    const year = Number(String(row.competition_date || '').slice(0, 4))
    return year === currentYear && ['gold', 'silver', 'bronze'].includes(row.result)
  }).length

  const certificateUrls = await Promise.all(
    beltRows.map(async (row) => {
      if (!row.certificate_path) return [row.id, null] as const
      const signed = await adminDb.storage.from('belt-certificates').createSignedUrl(row.certificate_path, 60 * 60)
      return [row.id, signed.data?.signedUrl ?? null] as const
    }),
  )
  const certificateUrlById = new Map<string, string | null>(certificateUrls)

  const canEdit = canEditAthleteProfile(viewerRole, targetRole)
  const beltChoices = age !== null ? (age < 16 ? KID_BELTS : ADULT_BELTS) : ALL_BELTS

  return (
    <section className="rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck size={18} className="text-black" />
            <h2 className="text-base font-semibold tracking-tight">Athlete profile</h2>
          </div>
          <p className="mt-1 text-sm text-[hsl(var(--muted))]">
            Program level, belt history, and competition results in one place.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <TinyBadge>{training?.program_level ? titleCase(training.program_level) : 'Program pending'}</TinyBadge>
          <TinyBadge tone={currentBelt ? 'success' : 'neutral'}>{currentBelt ? `${beltLabel(currentBelt)} belt` : 'No belt yet'}</TinyBadge>
          <TinyBadge tone={podiumsThisYear >= 3 ? 'success' : podiumsThisYear > 0 ? 'warning' : 'neutral'}>
            {podiumsThisYear} podium(s) in {currentYear}
          </TinyBadge>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-black">
            <Dumbbell size={16} />
            Program
          </div>
          <div className="mt-3 text-lg font-semibold tracking-tight">{training?.program_level ? titleCase(training.program_level) : 'Not set yet'}</div>
          <div className="mt-1 text-sm text-[hsl(var(--muted))]">
            {training?.updated_at ? `Last updated ${fmtDate(training.updated_at)}` : 'No program level saved yet.'}
          </div>
        </div>

        <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-black">
            <Award size={16} />
            Current belt
          </div>
          <div className="mt-3 text-lg font-semibold tracking-tight">{currentBelt ? beltLabel(currentBelt) : 'Not set yet'}</div>
          <div className="mt-1 text-sm text-[hsl(var(--muted))]">
            {beltRows[0]?.promoted_at ? `Promoted ${fmtDate(beltRows[0].promoted_at)}` : 'No promotion history yet.'}
          </div>
        </div>

        <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-black">
            <Medal size={16} />
            Competition results
          </div>
          <div className="mt-3 text-lg font-semibold tracking-tight">{competitionRows.length}</div>
          <div className="mt-1 text-sm text-[hsl(var(--muted))]">
            {competitionRows.length > 0
              ? canEdit
                ? 'Editable by head coach and super admin.'
                : 'Competition record available.'
              : 'No competition result added yet.'}
          </div>
        </div>

        <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-black">
            <FileText size={16} />
            Renewal benefit
          </div>
          <div className="mt-3 text-lg font-semibold tracking-tight">{podiumsThisYear >= 3 ? 'Eligible now' : 'Track podiums'}</div>
          <div className="mt-1 text-sm text-[hsl(var(--muted))]">
            3 podiums in one calendar year can unlock a 50% discount on any membership renewal.
          </div>
        </div>
      </div>

      {canEdit ? (
        <div className="mt-4 grid gap-4 xl:grid-cols-3">
          <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-soft">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold tracking-tight">Program tools</h3>
                <p className="mt-1 text-xs text-[hsl(var(--muted))]">Head coach and super admin only.</p>
              </div>
              <TinyBadge tone="warning">Editable</TinyBadge>
            </div>
            <DetailsEditor label={training ? 'Edit program' : 'Add program'}>
              <form action={saveTrainingProfileAction} className="grid gap-3">
                <input type="hidden" name="memberUserId" value={memberUserId} />
                <input type="hidden" name="targetRole" value={targetRole ?? 'member'} />
                <input type="hidden" name="nextPath" value={nextPath} />
                <label className="block text-sm">
                  <span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Program level</span>
                  <select
                    name="program_level"
                    defaultValue={training?.program_level ?? 'beginner'}
                    className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black"
                  >
                    {PROGRAM_OPTIONS.map((option) => (
                      <option key={option} value={option}>{titleCase(option)}</option>
                    ))}
                  </select>
                </label>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="submit"
                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-black bg-black px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
                  >
                    <Save size={14} />
                    Save program
                  </button>
                  {training ? (
                    <button
                      type="submit"
                      formAction={deleteTrainingProfileAction}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-medium text-rose-700 transition hover:bg-rose-100"
                    >
                      <Trash2 size={14} />
                      Remove program
                    </button>
                  ) : null}
                </div>
              </form>
            </DetailsEditor>
          </div>

          <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-soft">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold tracking-tight">Belt tools</h3>
                <p className="mt-1 text-xs text-[hsl(var(--muted))]">New promotions stay collapsed until you choose to add one.</p>
              </div>
              <TinyBadge tone="warning">Editable</TinyBadge>
            </div>
            <DetailsEditor label="Add belt promotion">
              <form action={addBeltPromotionAction} className="grid gap-3">
                <input type="hidden" name="memberUserId" value={memberUserId} />
                <input type="hidden" name="targetRole" value={targetRole ?? 'member'} />
                <input type="hidden" name="nextPath" value={nextPath} />

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm">
                    <span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Belt</span>
                    <select
                      name="belt_code"
                      defaultValue={beltChoices[0]}
                      className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black"
                    >
                      {beltChoices.map((belt) => (
                        <option key={belt} value={belt}>{beltLabel(belt)}</option>
                      ))}
                    </select>
                  </label>

                  <label className="block text-sm">
                    <span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Promotion date</span>
                    <input
                      type="date"
                      name="promoted_at"
                      defaultValue={new Date().toISOString().slice(0, 10)}
                      className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black"
                    />
                  </label>
                </div>

                <label className="block text-sm">
                  <span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Attestation note</span>
                  <textarea
                    name="notes"
                    rows={3}
                    placeholder="Optional note"
                    className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black"
                  />
                </label>

                <label className="block text-sm">
                  <span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Certificate file</span>
                  <input
                    type="file"
                    name="certificate"
                    accept=".pdf,image/jpeg,image/png,image/webp"
                    className="block w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm"
                  />
                  <span className="mt-2 block text-xs text-[hsl(var(--muted))]">PDF, JPG, PNG, or WEBP · max 8MB</span>
                </label>

                <button
                  type="submit"
                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-black bg-black px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
                >
                  <Upload size={14} />
                  Save promotion
                </button>
              </form>
            </DetailsEditor>
          </div>

          <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-soft">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold tracking-tight">Competition tools</h3>
                <p className="mt-1 text-xs text-[hsl(var(--muted))]">New results stay collapsed until you choose to add one.</p>
              </div>
              <TinyBadge tone="warning">Editable</TinyBadge>
            </div>
            <DetailsEditor label="Add competition result">
              <form action={saveCompetitionResultAction} className="grid gap-3">
                <input type="hidden" name="memberUserId" value={memberUserId} />
                <input type="hidden" name="targetRole" value={targetRole ?? 'member'} />
                <input type="hidden" name="nextPath" value={nextPath} />

                <label className="block text-sm">
                  <span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Competition name</span>
                  <input
                    type="text"
                    name="competition_name"
                    placeholder="AJP Cairo Open"
                    className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black"
                  />
                </label>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm">
                    <span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Competition date</span>
                    <input
                      type="date"
                      name="competition_date"
                      defaultValue={new Date().toISOString().slice(0, 10)}
                      className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black"
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Result</span>
                    <select
                      name="result"
                      defaultValue="gold"
                      className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black"
                    >
                      {RESULT_OPTIONS.map((option) => (
                        <option key={option} value={option}>{resultLabel(option)}</option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm">
                    <span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Division</span>
                    <input
                      type="text"
                      name="division"
                      placeholder="Gi / NoGi / Teens"
                      className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black"
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Category</span>
                    <input
                      type="text"
                      name="category"
                      placeholder="-42kg / Kids 3"
                      className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black"
                    />
                  </label>
                </div>

                <label className="block text-sm">
                  <span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Note</span>
                  <textarea
                    name="notes"
                    rows={3}
                    placeholder="Optional note"
                    className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black"
                  />
                </label>

                <button
                  type="submit"
                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-black bg-black px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
                >
                  <Trophy size={14} />
                  Save result
                </button>
              </form>
            </DetailsEditor>
          </div>
        </div>
      ) : null}

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-soft">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold tracking-tight">Belt history</h3>
            <TinyBadge>{beltRows.length} entr{beltRows.length === 1 ? 'y' : 'ies'}</TinyBadge>
          </div>

          {beltRows.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-4 py-3 text-sm text-[hsl(var(--muted))]">
              No belt promotion history yet.
            </div>
          ) : (
            <div className="mt-4 grid gap-3">
              {beltRows.map((row, index) => {
                const certificateUrl = certificateUrlById.get(row.id) ?? null
                return (
                  <div key={row.id} className="rounded-2xl border border-[hsl(var(--border))] bg-white/70 p-4">
                    <>
                      <div className="flex flex-wrap items-center gap-2">
                        {index === 0 ? <TinyBadge tone="success">Current</TinyBadge> : null}
                        <TinyBadge>{beltLabel(row.belt_code)}</TinyBadge>
                        <TinyBadge>{fmtDate(row.promoted_at)}</TinyBadge>
                        {row.updated_at ? <TinyBadge>Updated {fmtDate(row.updated_at)}</TinyBadge> : null}
                        {row.certificate_path ? <TinyBadge tone="warning">Certificate attached</TinyBadge> : null}
                      </div>
                      {row.notes ? <p className="mt-3 text-sm text-[hsl(var(--muted))]">{row.notes}</p> : null}
                      {row.certificate_path ? (
                        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
                          {certificateUrl ? (
                            <a
                              href={certificateUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center justify-center rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-1.5 shadow-soft transition hover:bg-[hsl(var(--bg))]"
                            >
                              View certificate
                            </a>
                          ) : null}
                          <span className="break-all text-[hsl(var(--muted))]">
                            {row.certificate_filename || 'certificate'}{row.certificate_size_bytes ? ` · ${formatBytes(row.certificate_size_bytes)}` : ''}
                          </span>
                        </div>
                      ) : null}
                      {canEdit ? (
                        <DetailsEditor label="Edit belt entry">
                          <form action={saveBeltPromotionAction} className="grid gap-3">
                            <input type="hidden" name="memberUserId" value={memberUserId} />
                            <input type="hidden" name="targetRole" value={targetRole ?? 'member'} />
                            <input type="hidden" name="nextPath" value={nextPath} />
                            <input type="hidden" name="beltPromotionId" value={row.id} />

                            <div className="grid gap-3 sm:grid-cols-2">
                              <label className="block text-sm">
                                <span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Belt</span>
                                <select
                                  name="belt_code"
                                  defaultValue={row.belt_code}
                                  className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black"
                                >
                                  {beltChoices.map((belt) => (
                                    <option key={belt} value={belt}>{beltLabel(belt)}</option>
                                  ))}
                                </select>
                              </label>
                              <label className="block text-sm">
                                <span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Promotion date</span>
                                <input
                                  type="date"
                                  name="promoted_at"
                                  defaultValue={row.promoted_at}
                                  className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black"
                                />
                              </label>
                            </div>

                            <label className="block text-sm">
                              <span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Attestation note</span>
                              <textarea
                                name="notes"
                                rows={2}
                                defaultValue={row.notes ?? ''}
                                className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black"
                              />
                            </label>

                            <label className="block text-sm">
                              <span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Replace certificate</span>
                              <input
                                type="file"
                                name="certificate"
                                accept=".pdf,image/jpeg,image/png,image/webp"
                                className="block w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm"
                              />
                              <span className="mt-2 block text-xs text-[hsl(var(--muted))]">Leave empty to keep the current file.</span>
                            </label>

                            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                              <div className="flex flex-wrap gap-2 text-xs text-[hsl(var(--muted))]">
                                {row.created_at ? <TinyBadge>Created {fmtDate(row.created_at)}</TinyBadge> : null}
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="submit"
                                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-black bg-black px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
                                >
                                  <Save size={14} />
                                  Save
                                </button>
                                <button
                                  type="submit"
                                  formAction={deleteBeltPromotionAction}
                                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-medium text-rose-700 transition hover:bg-rose-100"
                                >
                                  <Trash2 size={14} />
                                  Remove
                                </button>
                              </div>
                            </div>
                          </form>
                        </DetailsEditor>
                      ) : null}
                    </>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-soft">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold tracking-tight">Competition results</h3>
            <TinyBadge>{competitionRows.length} entr{competitionRows.length === 1 ? 'y' : 'ies'}</TinyBadge>
          </div>

          {competitionRows.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-4 py-3 text-sm text-[hsl(var(--muted))]">
              No competition results yet.
            </div>
          ) : (
            <div className="mt-4 grid gap-3">
              {competitionRows.map((row) => (
                <div key={row.id} className="rounded-2xl border border-[hsl(var(--border))] bg-white/70 p-4">
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <TinyBadge>{resultLabel(row.result)}</TinyBadge>
                      <TinyBadge>{fmtDate(row.competition_date)}</TinyBadge>
                      {row.division ? <TinyBadge>{row.division}</TinyBadge> : null}
                      {row.category ? <TinyBadge>{row.category}</TinyBadge> : null}
                      {row.updated_at ? <TinyBadge>Updated {fmtDate(row.updated_at)}</TinyBadge> : null}
                    </div>
                    <div className="mt-3 text-sm font-medium">{row.competition_name}</div>
                    {row.notes ? <p className="mt-2 text-sm text-[hsl(var(--muted))]">{row.notes}</p> : null}
                    {canEdit ? (
                      <DetailsEditor label="Edit result">
                        <form action={saveCompetitionResultAction} className="grid gap-3">
                          <input type="hidden" name="memberUserId" value={memberUserId} />
                          <input type="hidden" name="targetRole" value={targetRole ?? 'member'} />
                          <input type="hidden" name="nextPath" value={nextPath} />
                          <input type="hidden" name="resultId" value={row.id} />

                          <div className="grid gap-3 sm:grid-cols-2">
                            <label className="block text-sm">
                              <span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Competition name</span>
                              <input
                                type="text"
                                name="competition_name"
                                defaultValue={row.competition_name}
                                className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black"
                              />
                            </label>
                            <label className="block text-sm">
                              <span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Competition date</span>
                              <input
                                type="date"
                                name="competition_date"
                                defaultValue={row.competition_date}
                                className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black"
                              />
                            </label>
                          </div>

                          <div className="grid gap-3 sm:grid-cols-3">
                            <label className="block text-sm">
                              <span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Result</span>
                              <select
                                name="result"
                                defaultValue={row.result}
                                className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black"
                              >
                                {RESULT_OPTIONS.map((option) => (
                                  <option key={option} value={option}>{resultLabel(option)}</option>
                                ))}
                              </select>
                            </label>
                            <label className="block text-sm">
                              <span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Division</span>
                              <input
                                type="text"
                                name="division"
                                defaultValue={row.division ?? ''}
                                className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black"
                              />
                            </label>
                            <label className="block text-sm">
                              <span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Category</span>
                              <input
                                type="text"
                                name="category"
                                defaultValue={row.category ?? ''}
                                className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black"
                              />
                            </label>
                          </div>

                          <label className="block text-sm">
                            <span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Note</span>
                            <textarea
                              name="notes"
                              rows={2}
                              defaultValue={row.notes ?? ''}
                              className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black"
                            />
                          </label>

                          <div className="flex flex-wrap gap-2">
                            <button
                              type="submit"
                              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-black bg-black px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
                            >
                              <Save size={14} />
                              Save
                            </button>
                            <button
                              type="submit"
                              formAction={deleteCompetitionResultAction}
                              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-medium text-rose-700 transition hover:bg-rose-100"
                            >
                              <Trash2 size={14} />
                              Remove
                            </button>
                          </div>
                        </form>
                      </DetailsEditor>
                    ) : null}
                  </>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
