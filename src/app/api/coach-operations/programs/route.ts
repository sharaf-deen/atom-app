export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { canManageCoachTrainingPrograms } from '@/lib/rbac'
import { getSessionUser } from '@/lib/session'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'

type ProgramStatus = 'draft' | 'published' | 'archived'
type Operation = 'save' | 'set_status'

type Body = {
  operation?: Operation
  id?: string
  title?: string
  targetGroup?: string
  startDate?: string
  endDate?: string
  notes?: string | null
  blockIds?: string[]
  techniqueIds?: string[]
  situationIds?: string[]
  status?: ProgramStatus
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function json(body: unknown, status = 200) {
  const response = NextResponse.json(body, { status })
  response.headers.set('Cache-Control', 'no-store')
  return response
}

function cleanText(value: unknown, max: number) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function cleanLongText(value: unknown, max: number) {
  const normalized = String(value ?? '').replace(/\r\n/g, '\n').trim()
  return normalized ? normalized.slice(0, max) : null
}

function uniqueUuidList(value: unknown) {
  if (!Array.isArray(value)) return [] as string[]
  return Array.from(new Set(value.map((item) => String(item ?? '').trim()).filter((item) => UUID_RE.test(item))))
}

function isValidDateRange(startDate: string, endDate: string) {
  return DATE_RE.test(startDate) && DATE_RE.test(endDate) && endDate >= startDate
}

export async function POST(request: Request) {
  const me = await getSessionUser()
  if (!me) return json({ ok: false, error: 'NOT_AUTHENTICATED' }, 401)
  if (!canManageCoachTrainingPrograms(me.role)) return json({ ok: false, error: 'FORBIDDEN' }, 403)

  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    return json({ ok: false, error: 'INVALID_BODY' }, 400)
  }

  const operation = body.operation
  if (!operation || !['save', 'set_status'].includes(operation)) {
    return json({ ok: false, error: 'INVALID_OPERATION' }, 400)
  }

  const supabase = createSupabaseServerActionClient()
  const now = new Date().toISOString()

  if (operation === 'set_status') {
    const id = String(body.id ?? '').trim()
    const status = body.status
    if (!UUID_RE.test(id)) return json({ ok: false, error: 'INVALID_ID' }, 400)
    if (!status || !['draft', 'published', 'archived'].includes(status)) {
      return json({ ok: false, error: 'INVALID_STATUS' }, 400)
    }

    if (status === 'published') {
      const { count, error: countError } = await supabase
        .from('coach_training_program_items')
        .select('id', { count: 'exact', head: true })
        .eq('program_id', id)
      if (countError) return json({ ok: false, error: 'ITEM_CHECK_FAILED', details: countError.message }, 500)
      if (!count) return json({ ok: false, error: 'PROGRAM_EMPTY', details: 'Add at least one curriculum item before publishing.' }, 400)
    }

    const patch: Record<string, unknown> = {
      status,
      updated_by: me.id,
      updated_at: now,
    }
    if (status === 'published') {
      patch.published_by = me.id
      patch.published_at = now
    }

    const { data, error } = await supabase
      .from('coach_training_programs')
      .update(patch)
      .eq('id', id)
      .select('*')
      .maybeSingle()

    if (error) return json({ ok: false, error: 'STATUS_UPDATE_FAILED', details: error.message }, 500)
    if (!data) return json({ ok: false, error: 'NOT_FOUND' }, 404)

    revalidatePath('/coach-operations/programs')
    return json({ ok: true, program: data })
  }

  const id = String(body.id ?? '').trim()
  if (id && !UUID_RE.test(id)) return json({ ok: false, error: 'INVALID_ID' }, 400)

  const title = cleanText(body.title, 160)
  const targetGroup = cleanText(body.targetGroup, 180)
  const startDate = String(body.startDate ?? '').trim()
  const endDate = String(body.endDate ?? '').trim()
  const notes = cleanLongText(body.notes, 3000)

  if (title.length < 2) return json({ ok: false, error: 'INVALID_TITLE' }, 400)
  if (targetGroup.length < 2) return json({ ok: false, error: 'INVALID_TARGET_GROUP' }, 400)
  if (!isValidDateRange(startDate, endDate)) return json({ ok: false, error: 'INVALID_DATE_RANGE' }, 400)

  const blockIds = uniqueUuidList(body.blockIds)
  const techniqueIds = uniqueUuidList(body.techniqueIds)
  const situationIds = uniqueUuidList(body.situationIds)
  if (blockIds.length + techniqueIds.length + situationIds.length === 0) {
    return json({ ok: false, error: 'PROGRAM_EMPTY', details: 'Select at least one curriculum block.' }, 400)
  }

  const [blocksResult, techniquesResult, situationsResult] = await Promise.all([
    blockIds.length
      ? supabase.from('coach_curriculum_blocks').select('id,type_id,is_active').in('id', blockIds)
      : Promise.resolve({ data: [], error: null } as any),
    techniqueIds.length
      ? supabase.from('coach_curriculum_techniques').select('id,block_id,is_active').in('id', techniqueIds)
      : Promise.resolve({ data: [], error: null } as any),
    situationIds.length
      ? supabase.from('coach_curriculum_situations').select('id,technique_id,is_active').in('id', situationIds)
      : Promise.resolve({ data: [], error: null } as any),
  ])

  const curriculumError = blocksResult.error || techniquesResult.error || situationsResult.error
  if (curriculumError) return json({ ok: false, error: 'CURRICULUM_LOOKUP_FAILED', details: curriculumError.message }, 500)

  const blocks = (blocksResult.data ?? []) as Array<{ id: string; type_id: string; is_active: boolean }>
  const techniques = (techniquesResult.data ?? []) as Array<{ id: string; block_id: string; is_active: boolean }>
  const situations = (situationsResult.data ?? []) as Array<{ id: string; technique_id: string; is_active: boolean }>

  if (blocks.length !== blockIds.length || techniques.length !== techniqueIds.length || situations.length !== situationIds.length) {
    return json({ ok: false, error: 'CURRICULUM_ITEM_NOT_FOUND' }, 400)
  }
  if ([...blocks, ...techniques, ...situations].some((item) => item.is_active !== true)) {
    return json({ ok: false, error: 'ARCHIVED_CURRICULUM_ITEM', details: 'Only active curriculum can be assigned to a new or edited program.' }, 400)
  }

  const blockMap = new Map(blocks.map((row) => [row.id, row]))
  const techniqueMap = new Map(techniques.map((row) => [row.id, row]))

  for (const technique of techniques) {
    if (!blockMap.has(technique.block_id)) {
      return json({ ok: false, error: 'TECHNIQUE_REQUIRES_BLOCK', details: 'Select the parent block before selecting a technique.' }, 400)
    }
  }
  for (const situation of situations) {
    const technique = techniqueMap.get(situation.technique_id)
    if (!technique || !blockMap.has(technique.block_id)) {
      return json({ ok: false, error: 'SITUATION_REQUIRES_TECHNIQUE', details: 'Select the parent technique before selecting a situation.' }, 400)
    }
  }

  const basePatch = {
    title,
    target_group: targetGroup,
    start_date: startDate,
    end_date: endDate,
    notes,
    updated_by: me.id,
    updated_at: now,
  }

  let programId = id
  if (programId) {
    const { data, error } = await supabase
      .from('coach_training_programs')
      .update(basePatch)
      .eq('id', programId)
      .select('id')
      .maybeSingle()
    if (error) return json({ ok: false, error: 'PROGRAM_UPDATE_FAILED', details: error.message }, 500)
    if (!data) return json({ ok: false, error: 'NOT_FOUND' }, 404)
  } else {
    const { data, error } = await supabase
      .from('coach_training_programs')
      .insert({ ...basePatch, status: 'draft', created_by: me.id })
      .select('id')
      .single()
    if (error) return json({ ok: false, error: 'PROGRAM_CREATE_FAILED', details: error.message }, 500)
    programId = String(data.id)
  }

  const rows: Array<Record<string, unknown>> = []
  let sortOrder = 10
  for (const blockId of blockIds) {
    const block = blockMap.get(blockId)!
    rows.push({
      program_id: programId,
      selected_level: 'block',
      type_id: block.type_id,
      block_id: block.id,
      technique_id: null,
      situation_id: null,
      sort_order: sortOrder,
    })
    sortOrder += 10
  }
  for (const techniqueId of techniqueIds) {
    const technique = techniqueMap.get(techniqueId)!
    const block = blockMap.get(technique.block_id)!
    rows.push({
      program_id: programId,
      selected_level: 'technique',
      type_id: block.type_id,
      block_id: block.id,
      technique_id: technique.id,
      situation_id: null,
      sort_order: sortOrder,
    })
    sortOrder += 10
  }
  for (const situationId of situationIds) {
    const situation = situations.find((row) => row.id === situationId)!
    const technique = techniqueMap.get(situation.technique_id)!
    const block = blockMap.get(technique.block_id)!
    rows.push({
      program_id: programId,
      selected_level: 'situation',
      type_id: block.type_id,
      block_id: block.id,
      technique_id: technique.id,
      situation_id: situation.id,
      sort_order: sortOrder,
    })
    sortOrder += 10
  }

  const { error: deleteError } = await supabase.from('coach_training_program_items').delete().eq('program_id', programId)
  if (deleteError) return json({ ok: false, error: 'PROGRAM_ITEMS_RESET_FAILED', details: deleteError.message }, 500)

  const { error: insertError } = await supabase.from('coach_training_program_items').insert(rows)
  if (insertError) return json({ ok: false, error: 'PROGRAM_ITEMS_SAVE_FAILED', details: insertError.message }, 500)

  revalidatePath('/coach-operations/programs')
  return json({ ok: true, id: programId })
}
