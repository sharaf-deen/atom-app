export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { canCreateCoachTrainingLogs, canManageCoachTrainingLogs } from '@/lib/rbac'
import { getSessionUser } from '@/lib/session'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'

type Operation = 'save' | 'reopen'

type Body = {
  operation?: Operation
  id?: string
  programId?: string
  trainingDate?: string
  sessionTime?: string
  notes?: string | null
  blockIds?: string[]
  techniqueIds?: string[]
  situationIds?: string[]
  complete?: boolean
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

function json(body: unknown, status = 200) {
  const response = NextResponse.json(body, { status })
  response.headers.set('Cache-Control', 'no-store')
  return response
}

function cleanLongText(value: unknown, max: number) {
  const normalized = String(value ?? '').replace(/\r\n/g, '\n').trim()
  return normalized ? normalized.slice(0, max) : null
}

function uniqueUuidList(value: unknown) {
  if (!Array.isArray(value)) return [] as string[]
  return Array.from(new Set(value.map((item) => String(item ?? '').trim()).filter((item) => UUID_RE.test(item))))
}

function normalizeTime(value: unknown) {
  const raw = String(value ?? '').trim()
  const match = raw.match(/^(\d{2}):(\d{2})(?::\d{2})?$/)
  if (!match) return ''
  return `${match[1]}:${match[2]}`
}

function mapOfSets(rows: Array<{ key: string; value: string }>) {
  const map = new Map<string, Set<string>>()
  for (const row of rows) {
    const current = map.get(row.key) ?? new Set<string>()
    current.add(row.value)
    map.set(row.key, current)
  }
  return map
}

export async function POST(request: Request) {
  const me = await getSessionUser()
  if (!me) return json({ ok: false, error: 'NOT_AUTHENTICATED' }, 401)
  if (!canCreateCoachTrainingLogs(me.role)) return json({ ok: false, error: 'FORBIDDEN' }, 403)

  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    return json({ ok: false, error: 'INVALID_BODY' }, 400)
  }

  const operation = body.operation
  if (!operation || !['save', 'reopen'].includes(operation)) {
    return json({ ok: false, error: 'INVALID_OPERATION' }, 400)
  }

  const supabase = createSupabaseServerActionClient()
  const canManage = canManageCoachTrainingLogs(me.role)
  const now = new Date().toISOString()

  if (operation === 'reopen') {
    if (!canManage) return json({ ok: false, error: 'FORBIDDEN' }, 403)
    const id = String(body.id ?? '').trim()
    if (!UUID_RE.test(id)) return json({ ok: false, error: 'INVALID_ID' }, 400)

    const { data, error } = await supabase
      .from('coach_training_session_logs')
      .update({ status: 'draft', reopened_by: me.id, reopened_at: now, updated_at: now })
      .eq('id', id)
      .eq('status', 'completed')
      .select('id')
      .maybeSingle()

    if (error) return json({ ok: false, error: 'REOPEN_FAILED', details: error.message }, 500)
    if (!data) return json({ ok: false, error: 'NOT_FOUND_OR_NOT_COMPLETED' }, 404)

    revalidatePath('/coach-operations/training-logs')
    return json({ ok: true })
  }

  const id = String(body.id ?? '').trim()
  if (id && !UUID_RE.test(id)) return json({ ok: false, error: 'INVALID_ID' }, 400)

  const programId = String(body.programId ?? '').trim()
  const trainingDate = String(body.trainingDate ?? '').trim()
  const sessionTime = normalizeTime(body.sessionTime)
  const notes = cleanLongText(body.notes, 3000)
  const complete = body.complete === true

  if (!UUID_RE.test(programId)) return json({ ok: false, error: 'INVALID_PROGRAM' }, 400)
  if (!DATE_RE.test(trainingDate)) return json({ ok: false, error: 'INVALID_DATE' }, 400)
  if (!TIME_RE.test(sessionTime)) return json({ ok: false, error: 'INVALID_TIME' }, 400)

  const blockIds = uniqueUuidList(body.blockIds)
  const techniqueIds = uniqueUuidList(body.techniqueIds)
  const situationIds = uniqueUuidList(body.situationIds)
  if (complete && blockIds.length + techniqueIds.length + situationIds.length === 0) {
    return json({ ok: false, error: 'LOG_EMPTY', details: 'Select at least one curriculum item before completing the training log.' }, 400)
  }

  const { data: program, error: programError } = await supabase
    .from('coach_training_programs')
    .select('id,title,target_group,start_date,end_date,status')
    .eq('id', programId)
    .eq('status', 'published')
    .maybeSingle()

  if (programError) return json({ ok: false, error: 'PROGRAM_LOOKUP_FAILED', details: programError.message }, 500)
  if (!program) return json({ ok: false, error: 'PUBLISHED_PROGRAM_NOT_FOUND' }, 400)
  if (trainingDate < String(program.start_date) || trainingDate > String(program.end_date)) {
    return json({ ok: false, error: 'DATE_OUTSIDE_PROGRAM', details: `Choose a date between ${program.start_date} and ${program.end_date}.` }, 400)
  }

  const { data: programItemData, error: programItemError } = await supabase
    .from('coach_training_program_items')
    .select('selected_level,block_id,technique_id,situation_id')
    .eq('program_id', programId)

  if (programItemError) return json({ ok: false, error: 'PROGRAM_ITEMS_LOOKUP_FAILED', details: programItemError.message }, 500)
  const programItems = (programItemData ?? []) as Array<{
    selected_level: 'block' | 'technique' | 'situation'
    block_id: string
    technique_id: string | null
    situation_id: string | null
  }>

  const programBlockIds = new Set(programItems.filter((row) => row.selected_level === 'block').map((row) => row.block_id))
  const explicitTechniquesByBlock = mapOfSets(
    programItems
      .filter((row) => row.selected_level === 'technique' && row.technique_id)
      .map((row) => ({ key: row.block_id, value: row.technique_id! })),
  )
  const explicitSituationsByTechnique = mapOfSets(
    programItems
      .filter((row) => row.selected_level === 'situation' && row.technique_id && row.situation_id)
      .map((row) => ({ key: row.technique_id!, value: row.situation_id! })),
  )

  if (!programBlockIds.size) return json({ ok: false, error: 'PROGRAM_EMPTY' }, 400)
  if (blockIds.some((blockId) => !programBlockIds.has(blockId))) {
    return json({ ok: false, error: 'BLOCK_NOT_IN_PROGRAM' }, 400)
  }

  const [blocksResult, techniquesResult, situationsResult] = await Promise.all([
    blockIds.length
      ? supabase.from('coach_curriculum_blocks').select('id,type_id,name,is_active').in('id', blockIds)
      : Promise.resolve({ data: [], error: null } as any),
    techniqueIds.length
      ? supabase.from('coach_curriculum_techniques').select('id,block_id,name,is_active').in('id', techniqueIds)
      : Promise.resolve({ data: [], error: null } as any),
    situationIds.length
      ? supabase
          .from('coach_curriculum_situations')
          .select('id,technique_id,name,opponent_reaction,coaching_response,is_active')
          .in('id', situationIds)
      : Promise.resolve({ data: [], error: null } as any),
  ])

  const lookupError = blocksResult.error || techniquesResult.error || situationsResult.error
  if (lookupError) return json({ ok: false, error: 'CURRICULUM_LOOKUP_FAILED', details: lookupError.message }, 500)

  const blocks = (blocksResult.data ?? []) as Array<{ id: string; type_id: string; name: string; is_active: boolean }>
  const techniques = (techniquesResult.data ?? []) as Array<{ id: string; block_id: string; name: string; is_active: boolean }>
  const situations = (situationsResult.data ?? []) as Array<{
    id: string
    technique_id: string
    name: string
    opponent_reaction: string
    coaching_response: string | null
    is_active: boolean
  }>

  if (blocks.length !== blockIds.length || techniques.length !== techniqueIds.length || situations.length !== situationIds.length) {
    return json({ ok: false, error: 'CURRICULUM_ITEM_NOT_FOUND' }, 400)
  }

  const blockMap = new Map(blocks.map((row) => [row.id, row]))
  const techniqueMap = new Map(techniques.map((row) => [row.id, row]))

  for (const technique of techniques) {
    if (!blockIds.includes(technique.block_id)) {
      return json({ ok: false, error: 'TECHNIQUE_REQUIRES_SELECTED_BLOCK' }, 400)
    }
    const explicit = explicitTechniquesByBlock.get(technique.block_id)
    if (explicit?.size) {
      if (!explicit.has(technique.id)) return json({ ok: false, error: 'TECHNIQUE_NOT_IN_PROGRAM' }, 400)
    } else if (technique.is_active !== true) {
      return json({ ok: false, error: 'ARCHIVED_TECHNIQUE_NOT_ASSIGNED' }, 400)
    }
  }

  for (const situation of situations) {
    const technique = techniqueMap.get(situation.technique_id)
    if (!technique || !techniqueIds.includes(technique.id)) {
      return json({ ok: false, error: 'SITUATION_REQUIRES_SELECTED_TECHNIQUE' }, 400)
    }
    const explicit = explicitSituationsByTechnique.get(technique.id)
    if (explicit?.size) {
      if (!explicit.has(situation.id)) return json({ ok: false, error: 'SITUATION_NOT_IN_PROGRAM' }, 400)
    } else if (situation.is_active !== true) {
      return json({ ok: false, error: 'ARCHIVED_SITUATION_NOT_ASSIGNED' }, 400)
    }
  }

  const typeIds = Array.from(new Set(blocks.map((row) => row.type_id)))
  const { data: typeData, error: typeError } = typeIds.length
    ? await supabase.from('coach_curriculum_types').select('id,name').in('id', typeIds)
    : ({ data: [], error: null } as any)
  if (typeError) return json({ ok: false, error: 'CURRICULUM_TYPE_LOOKUP_FAILED', details: typeError.message }, 500)
  const typeMap = new Map(((typeData ?? []) as Array<{ id: string; name: string }>).map((row) => [row.id, row.name]))

  let sessionLogId = id
  if (sessionLogId) {
    const { data: existing, error: existingError } = await supabase
      .from('coach_training_session_logs')
      .select('id,coach_user_id,status')
      .eq('id', sessionLogId)
      .maybeSingle()

    if (existingError) return json({ ok: false, error: 'LOG_LOOKUP_FAILED', details: existingError.message }, 500)
    if (!existing) return json({ ok: false, error: 'NOT_FOUND' }, 404)
    if (existing.status !== 'draft') return json({ ok: false, error: 'LOG_COMPLETED_REOPEN_FIRST' }, 409)
    if (!canManage && existing.coach_user_id !== me.id) return json({ ok: false, error: 'FORBIDDEN' }, 403)

    const { error: updateError } = await supabase
      .from('coach_training_session_logs')
      .update({
        program_id: programId,
        program_title_snapshot: program.title,
        target_group_snapshot: program.target_group,
        training_date: trainingDate,
        session_time: sessionTime,
        notes,
        updated_at: now,
      })
      .eq('id', sessionLogId)

    if (updateError) return json({ ok: false, error: 'LOG_UPDATE_FAILED', details: updateError.message }, 500)
  } else {
    const coachName = String(me.full_name || me.email || 'ATOM Coach').trim().slice(0, 180)
    const { data: created, error: createError } = await supabase
      .from('coach_training_session_logs')
      .insert({
        program_id: programId,
        program_title_snapshot: program.title,
        target_group_snapshot: program.target_group,
        training_date: trainingDate,
        session_time: sessionTime,
        coach_user_id: me.id,
        coach_name_snapshot: coachName.length >= 2 ? coachName : 'ATOM Coach',
        coach_role_snapshot: me.role,
        notes,
        status: 'draft',
      })
      .select('id')
      .single()

    if (createError) return json({ ok: false, error: 'LOG_CREATE_FAILED', details: createError.message }, 500)
    sessionLogId = String(created.id)
  }

  const rows: Array<Record<string, unknown>> = []
  let sortOrder = 10
  for (const blockId of blockIds) {
    const block = blockMap.get(blockId)!
    rows.push({
      session_log_id: sessionLogId,
      selected_level: 'block',
      type_id: block.type_id,
      block_id: block.id,
      technique_id: null,
      situation_id: null,
      type_name_snapshot: typeMap.get(block.type_id) ?? 'Technical',
      block_name_snapshot: block.name,
      technique_name_snapshot: null,
      situation_name_snapshot: null,
      opponent_reaction_snapshot: null,
      coaching_response_snapshot: null,
      sort_order: sortOrder,
    })
    sortOrder += 10
  }
  for (const techniqueId of techniqueIds) {
    const technique = techniqueMap.get(techniqueId)!
    const block = blockMap.get(technique.block_id)!
    rows.push({
      session_log_id: sessionLogId,
      selected_level: 'technique',
      type_id: block.type_id,
      block_id: block.id,
      technique_id: technique.id,
      situation_id: null,
      type_name_snapshot: typeMap.get(block.type_id) ?? 'Technical',
      block_name_snapshot: block.name,
      technique_name_snapshot: technique.name,
      situation_name_snapshot: null,
      opponent_reaction_snapshot: null,
      coaching_response_snapshot: null,
      sort_order: sortOrder,
    })
    sortOrder += 10
  }
  for (const situationId of situationIds) {
    const situation = situations.find((row) => row.id === situationId)!
    const technique = techniqueMap.get(situation.technique_id)!
    const block = blockMap.get(technique.block_id)!
    rows.push({
      session_log_id: sessionLogId,
      selected_level: 'situation',
      type_id: block.type_id,
      block_id: block.id,
      technique_id: technique.id,
      situation_id: situation.id,
      type_name_snapshot: typeMap.get(block.type_id) ?? 'Technical',
      block_name_snapshot: block.name,
      technique_name_snapshot: technique.name,
      situation_name_snapshot: situation.name,
      opponent_reaction_snapshot: situation.opponent_reaction,
      coaching_response_snapshot: situation.coaching_response,
      sort_order: sortOrder,
    })
    sortOrder += 10
  }

  const { error: resetError } = await supabase.from('coach_training_session_log_items').delete().eq('session_log_id', sessionLogId)
  if (resetError) return json({ ok: false, error: 'LOG_ITEMS_RESET_FAILED', details: resetError.message }, 500)

  if (rows.length) {
    const { error: insertError } = await supabase.from('coach_training_session_log_items').insert(rows)
    if (insertError) return json({ ok: false, error: 'LOG_ITEMS_SAVE_FAILED', details: insertError.message }, 500)
  }

  if (complete) {
    if (!rows.length) return json({ ok: false, error: 'LOG_EMPTY' }, 400)
    const { data: completedLog, error: completeError } = await supabase
      .from('coach_training_session_logs')
      .update({ status: 'completed', completed_by: me.id, completed_at: now, updated_at: now })
      .eq('id', sessionLogId)
      .eq('status', 'draft')
      .select('id')
      .maybeSingle()
    if (completeError) return json({ ok: false, error: 'LOG_COMPLETE_FAILED', details: completeError.message }, 500)
    if (!completedLog) return json({ ok: false, error: 'LOG_NOT_DRAFT' }, 409)
  }

  revalidatePath('/coach-operations/training-logs')
  return json({ ok: true, id: sessionLogId, status: complete ? 'completed' : 'draft' })
}
