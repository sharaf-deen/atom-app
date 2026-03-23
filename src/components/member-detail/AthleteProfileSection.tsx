import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { Award, Dumbbell, FileText, Medal, ShieldCheck, Upload } from 'lucide-react'
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
}

type CompetitionResultRow = {
  id: string
  member_user_id: string
  competition_name: string
  competition_date: string
  division: string | null
  category: string | null
  result: 'gold' | 'silver' | 'bronze' | 'other'
  notes: string | null
  created_at: string | null
  created_by: string | null
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

function resultLabel(result?: CompetitionResultRow['result'] | null) {
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
    .upsert({
      member_user_id: memberUserId,
      program_level: programLevelRaw,
      updated_by: me.id,
    }, { onConflict: 'member_user_id' })

  if (upsert.error) {
    throw new Error(upsert.error.message)
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
  })

  if (insert.error) {
    throw new Error(insert.error.message)
  }

  revalidatePath(nextPath)
  redirect(nextPath)
}

function badgeToneClass(tone: 'neutral' | 'success' | 'warning') {
  if (tone === 'success') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (tone === 'warning') return 'border-amber-200 bg-amber-50 text-amber-800'
  return 'border-[hsl(var(--border))] bg-[hsl(var(--bg))] text-[hsl(var(--muted))]'
}

function TinyBadge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'success' | 'warning' }) {
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${badgeToneClass(tone)}`}>{children}</span>
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
      .select('id, member_user_id, belt_code, promoted_at, certificate_path, certificate_filename, certificate_mime, certificate_size_bytes, notes, created_at, created_by')
      .eq('member_user_id', memberUserId)
      .order('promoted_at', { ascending: false })
      .order('created_at', { ascending: false })
      .returns<BeltPromotionRow[]>(),
    db
      .from('member_competition_results')
      .select('id, member_user_id, competition_name, competition_date, division, category, result, notes, created_at, created_by')
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
            {competitionRows.length > 0 ? 'Read-only for now.' : 'No competition result added yet.'}
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
        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          <form action={saveTrainingProfileAction} className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-soft">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold tracking-tight">Update program</h3>
                <p className="mt-1 text-xs text-[hsl(var(--muted))]">Head coach and super admin only.</p>
              </div>
              <TinyBadge tone="warning">Editable</TinyBadge>
            </div>
            <input type="hidden" name="memberUserId" value={memberUserId} />
            <input type="hidden" name="targetRole" value={targetRole ?? 'member'} />
            <input type="hidden" name="nextPath" value={nextPath} />
            <label className="mt-4 block text-sm">
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
            <button
              type="submit"
              className="mt-4 inline-flex items-center justify-center rounded-2xl border border-black bg-black px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
            >
              Save program
            </button>
          </form>

          <form action={addBeltPromotionAction} className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-soft">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold tracking-tight">Add belt promotion</h3>
                <p className="mt-1 text-xs text-[hsl(var(--muted))]">Creates a new promotion entry in the history.</p>
              </div>
              <TinyBadge tone="warning">Editable</TinyBadge>
            </div>
            <input type="hidden" name="memberUserId" value={memberUserId} />
            <input type="hidden" name="targetRole" value={targetRole ?? 'member'} />
            <input type="hidden" name="nextPath" value={nextPath} />

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
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

            <label className="mt-3 block text-sm">
              <span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Attestation note</span>
              <textarea
                name="notes"
                rows={3}
                placeholder="Optional note"
                className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black"
              />
            </label>

            <label className="mt-3 block text-sm">
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
              className="mt-4 inline-flex items-center justify-center gap-2 rounded-2xl border border-black bg-black px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
            >
              <Upload size={14} />
              Save promotion
            </button>
          </form>
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
                    <div className="flex flex-wrap items-center gap-2">
                      {index === 0 ? <TinyBadge tone="success">Current</TinyBadge> : null}
                      <TinyBadge>{beltLabel(row.belt_code)}</TinyBadge>
                      <TinyBadge>{fmtDate(row.promoted_at)}</TinyBadge>
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
                        <span className="text-[hsl(var(--muted))] break-all">
                          {row.certificate_filename || 'certificate'}{row.certificate_size_bytes ? ` · ${formatBytes(row.certificate_size_bytes)}` : ''}
                        </span>
                      </div>
                    ) : null}
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
                  <div className="flex flex-wrap items-center gap-2">
                    <TinyBadge>{resultLabel(row.result)}</TinyBadge>
                    <TinyBadge>{fmtDate(row.competition_date)}</TinyBadge>
                    {row.division ? <TinyBadge>{row.division}</TinyBadge> : null}
                    {row.category ? <TinyBadge>{row.category}</TinyBadge> : null}
                  </div>
                  <div className="mt-3 text-sm font-medium">{row.competition_name}</div>
                  {row.notes ? <p className="mt-2 text-sm text-[hsl(var(--muted))]">{row.notes}</p> : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
