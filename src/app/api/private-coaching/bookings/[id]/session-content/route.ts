export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { PRIVATE_COACHING_MANAGER_ROLES } from '@/lib/privateCoaching'

type ProfileRow = {
  user_id: string
  role: string | null
}

type BookingRow = {
  id: string
  coach_id: string
  status: string
  archived_at: string | null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function json(status: number, body: unknown) {
  const response = NextResponse.json(body, { status })
  response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return response
}

function normalizeIds(value: unknown, limit: number) {
  if (!Array.isArray(value)) return []
  return Array.from(
    new Set(
      value
        .map((item) => String(item ?? '').trim())
        .filter((item) => UUID_RE.test(item)),
    ),
  ).slice(0, limit)
}

async function getContext(bookingId: string) {
  const route = createSupabaseServerActionClient()
  const { data: auth, error: authError } = await route.auth.getUser()
  if (authError) return { response: json(401, { ok: false, error: 'AUTH_ERROR', details: authError.message }) }
  if (!auth.user) return { response: json(401, { ok: false, error: 'NOT_AUTHENTICATED' }) }

  const admin = createSupabaseAdminClient()

  const { data: me, error: meError } = await admin
    .from('profiles')
    .select('user_id, role')
    .eq('user_id', auth.user.id)
    .maybeSingle<ProfileRow>()

  if (meError) return { response: json(500, { ok: false, error: 'PROFILE_LOOKUP_FAILED', details: meError.message }) }
  if (!me?.user_id || !(PRIVATE_COACHING_MANAGER_ROLES as readonly string[]).includes(String(me.role ?? ''))) {
    return { response: json(403, { ok: false, error: 'FORBIDDEN' }) }
  }

  const { data: booking, error: bookingError } = await admin
    .from('private_coaching_bookings')
    .select('id, coach_id, status, archived_at')
    .eq('id', bookingId)
    .maybeSingle<BookingRow>()

  if (bookingError) return { response: json(500, { ok: false, error: 'BOOKING_LOOKUP_FAILED', details: bookingError.message }) }
  if (!booking?.id) return { response: json(404, { ok: false, error: 'BOOKING_NOT_FOUND' }) }
  if (me.role === 'head_coach' && booking.coach_id !== auth.user.id) {
    return { response: json(403, { ok: false, error: 'FORBIDDEN' }) }
  }

  return { admin, auth, me, booking }
}

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const bookingId = String(params?.id ?? '').trim()
    if (!UUID_RE.test(bookingId)) return json(400, { ok: false, error: 'INVALID_BOOKING_ID' })

    const context = await getContext(bookingId)
    if ('response' in context) return context.response

    const { admin, booking } = context

    const [
      contentRes,
      selectedBlocksRes,
      selectedTechniquesRes,
      selectedSituationsRes,
      typesRes,
      blocksRes,
      techniquesRes,
      situationsRes,
    ] = await Promise.all([
      admin
        .from('private_coaching_session_contents')
        .select('session_notes, updated_at')
        .eq('booking_id', bookingId)
        .maybeSingle(),
      admin
        .from('private_coaching_session_blocks')
        .select('block_id, block_name_snapshot, sort_order')
        .eq('booking_id', bookingId)
        .order('sort_order', { ascending: true }),
      admin
        .from('private_coaching_session_techniques')
        .select('technique_id, technique_name_snapshot, block_name_snapshot, sort_order')
        .eq('booking_id', bookingId)
        .order('sort_order', { ascending: true }),
      admin
        .from('private_coaching_session_situations')
        .select('situation_id, situation_name_snapshot, technique_name_snapshot, sort_order')
        .eq('booking_id', bookingId)
        .order('sort_order', { ascending: true }),
      admin
        .from('coach_curriculum_types')
        .select('id, name, sort_order')
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true }),
      admin
        .from('coach_curriculum_blocks')
        .select('id, type_id, name, sort_order')
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true }),
      admin
        .from('coach_curriculum_techniques')
        .select('id, block_id, name, technical_level, training_format, sort_order')
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true }),
      admin
        .from('coach_curriculum_situations')
        .select('id, technique_id, name, opponent_reaction, coaching_response, training_format, sort_order')
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true }),
    ])

    const error =
      contentRes.error ||
      selectedBlocksRes.error ||
      selectedTechniquesRes.error ||
      selectedSituationsRes.error ||
      typesRes.error ||
      blocksRes.error ||
      techniquesRes.error ||
      situationsRes.error

    if (error) return json(500, { ok: false, error: 'SESSION_CONTENT_LOAD_FAILED', details: error.message })

    return json(200, {
      ok: true,
      read_only: Boolean(booking.archived_at),
      booking_status: booking.status,
      content: {
        session_notes: contentRes.data?.session_notes ?? '',
        updated_at: contentRes.data?.updated_at ?? null,
        block_ids: (selectedBlocksRes.data ?? []).map((row: any) => row.block_id).filter(Boolean),
        technique_ids: (selectedTechniquesRes.data ?? []).map((row: any) => row.technique_id).filter(Boolean),
        situation_ids: (selectedSituationsRes.data ?? []).map((row: any) => row.situation_id).filter(Boolean),
        snapshots: {
          blocks: selectedBlocksRes.data ?? [],
          techniques: selectedTechniquesRes.data ?? [],
          situations: selectedSituationsRes.data ?? [],
        },
      },
      library: {
        types: typesRes.data ?? [],
        blocks: blocksRes.data ?? [],
        techniques: techniquesRes.data ?? [],
        situations: situationsRes.data ?? [],
      },
    })
  } catch (error: any) {
    return json(500, { ok: false, error: 'SERVER_ERROR', details: error?.message || String(error) })
  }
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const bookingId = String(params?.id ?? '').trim()
    if (!UUID_RE.test(bookingId)) return json(400, { ok: false, error: 'INVALID_BOOKING_ID' })

    const context = await getContext(bookingId)
    if ('response' in context) return context.response

    const { admin, auth, booking } = context
    if (booking.archived_at) {
      return json(409, {
        ok: false,
        error: 'BOOKING_ARCHIVED',
        details: 'Archived bookings are read-only. Restore the booking before editing session content.',
      })
    }

    if (booking.status === 'cancelled') {
      return json(409, {
        ok: false,
        error: 'BOOKING_CANCELLED',
        details: 'Cancelled bookings cannot receive technical session content.',
      })
    }

    const body = await request.json().catch(() => ({} as any))
    const blockIds = normalizeIds(body?.block_ids, 20)
    const techniqueIds = normalizeIds(body?.technique_ids, 50)
    const situationIds = normalizeIds(body?.situation_ids, 100)
    const sessionNotes = String(body?.session_notes ?? '').replace(/\r\n/g, '\n').trim()

    if (sessionNotes.length > 3000) return json(400, { ok: false, error: 'SESSION_NOTES_TOO_LONG' })

    const [blocksRes, techniquesRes, situationsRes] = await Promise.all([
      blockIds.length
        ? admin
            .from('coach_curriculum_blocks')
            .select('id, name, sort_order')
            .in('id', blockIds)
        : Promise.resolve({ data: [], error: null } as any),
      techniqueIds.length
        ? admin
            .from('coach_curriculum_techniques')
            .select('id, block_id, name, sort_order')
            .in('id', techniqueIds)
        : Promise.resolve({ data: [], error: null } as any),
      situationIds.length
        ? admin
            .from('coach_curriculum_situations')
            .select('id, technique_id, name, sort_order')
            .in('id', situationIds)
        : Promise.resolve({ data: [], error: null } as any),
    ])

    const lookupError = blocksRes.error || techniquesRes.error || situationsRes.error
    if (lookupError) return json(500, { ok: false, error: 'CURRICULUM_LOOKUP_FAILED', details: lookupError.message })

    if ((blocksRes.data ?? []).length !== blockIds.length) return json(400, { ok: false, error: 'INVALID_BLOCK_SELECTION' })
    if ((techniquesRes.data ?? []).length !== techniqueIds.length) return json(400, { ok: false, error: 'INVALID_TECHNIQUE_SELECTION' })
    if ((situationsRes.data ?? []).length !== situationIds.length) return json(400, { ok: false, error: 'INVALID_SITUATION_SELECTION' })

    const selectedBlockSet = new Set(blockIds)
    for (const technique of techniquesRes.data ?? []) {
      if (!selectedBlockSet.has(String((technique as any).block_id))) {
        return json(400, {
          ok: false,
          error: 'TECHNIQUE_BLOCK_MISMATCH',
          details: 'Every selected technique must belong to a selected block.',
        })
      }
    }

    const selectedTechniqueSet = new Set(techniqueIds)
    for (const situation of situationsRes.data ?? []) {
      if (!selectedTechniqueSet.has(String((situation as any).technique_id))) {
        return json(400, {
          ok: false,
          error: 'SITUATION_TECHNIQUE_MISMATCH',
          details: 'Every selected situation must belong to a selected technique.',
        })
      }
    }

    const techniqueById = new Map<string, any>((techniquesRes.data ?? []).map((row: any) => [String(row.id), row]))
    const blockById = new Map<string, any>((blocksRes.data ?? []).map((row: any) => [String(row.id), row]))

    const { error: upsertError } = await admin
      .from('private_coaching_session_contents')
      .upsert({
        booking_id: bookingId,
        session_notes: sessionNotes || null,
        created_by: auth.user.id,
        updated_by: auth.user.id,
      }, { onConflict: 'booking_id' })

    if (upsertError) return json(500, { ok: false, error: 'SESSION_CONTENT_SAVE_FAILED', details: upsertError.message })

    const deleteResults = await Promise.all([
      admin.from('private_coaching_session_blocks').delete().eq('booking_id', bookingId),
      admin.from('private_coaching_session_techniques').delete().eq('booking_id', bookingId),
      admin.from('private_coaching_session_situations').delete().eq('booking_id', bookingId),
    ])
    const deleteError = deleteResults.find((result) => result.error)?.error
    if (deleteError) return json(500, { ok: false, error: 'SESSION_CONTENT_REPLACE_FAILED', details: deleteError.message })

    const blockRows = (blocksRes.data ?? []).map((block: any, index: number) => ({
      booking_id: bookingId,
      block_id: block.id,
      block_name_snapshot: block.name,
      sort_order: index * 10 + 10,
      created_by: auth.user.id,
    }))

    const techniqueRows = (techniquesRes.data ?? []).map((technique: any, index: number) => ({
      booking_id: bookingId,
      technique_id: technique.id,
      technique_name_snapshot: technique.name,
      block_name_snapshot: blockById.get(String(technique.block_id))?.name ?? null,
      sort_order: index * 10 + 10,
      created_by: auth.user.id,
    }))

    const situationRows = (situationsRes.data ?? []).map((situation: any, index: number) => ({
      booking_id: bookingId,
      situation_id: situation.id,
      situation_name_snapshot: situation.name,
      technique_name_snapshot: techniqueById.get(String(situation.technique_id))?.name ?? null,
      sort_order: index * 10 + 10,
      created_by: auth.user.id,
    }))

    for (const [table, rows] of [
      ['private_coaching_session_blocks', blockRows],
      ['private_coaching_session_techniques', techniqueRows],
      ['private_coaching_session_situations', situationRows],
    ] as const) {
      if (!rows.length) continue
      const { error } = await admin.from(table).insert(rows as any)
      if (error) return json(500, { ok: false, error: 'SESSION_CONTENT_INSERT_FAILED', details: error.message })
    }

    return json(200, {
      ok: true,
      counts: {
        blocks: blockRows.length,
        techniques: techniqueRows.length,
        situations: situationRows.length,
      },
    })
  } catch (error: any) {
    return json(500, { ok: false, error: 'SERVER_ERROR', details: error?.message || String(error) })
  }
}
