// src/app/packages-and-promos/actions.ts
'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseRSC, createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { getSessionUser } from '@/lib/session'

function assertSuperAdmin(role?: string | null) {
  if (role !== 'super_admin') throw new Error('Forbidden')
}

function parseApplies(form: FormData): Array<'membership' | 'dropin' | 'private'> {
  const vals = form.getAll('applies_to').map(String)
  const allowed = new Set(['membership', 'dropin', 'private'])
  return vals.filter((v) => allowed.has(v)) as Array<'membership' | 'dropin' | 'private'>
}

export async function createPromo(formData: FormData) {
  const user = await getSessionUser()
  assertSuperAdmin(user?.role)
  const supabase = createSupabaseRSC()

  const title = String(formData.get('title') || '').trim()
  const description = (String(formData.get('description') || '').trim() || null) as string | null
  const discount_type = String(formData.get('discount_type')) === 'amount' ? 'amount' : 'percent'
  const discount_value = Number(formData.get('discount_value') || 0)
  const applies_to = parseApplies(formData)
  const min_months = formData.get('min_months') ? Number(formData.get('min_months')) : null
  const start_date = formData.get('start_date') ? String(formData.get('start_date')) : null
  const end_date = formData.get('end_date') ? String(formData.get('end_date')) : null

  if (!title) throw new Error('Title is required')
  if (!discount_value || discount_value <= 0) throw new Error('Discount value must be > 0')
  if (!applies_to.length) throw new Error('Choose at least one Applies to')

  const { error } = await supabase.from('promotions').insert({
    title,
    description,
    discount_type,
    discount_value,
    applies_to,
    min_months,
    start_date,
    end_date,
    created_by: user?.id ?? null,
  })
  if (error) throw error

  revalidatePath('/packages-and-promos')
}

export async function updatePromo(id: string, formData: FormData) {
  const user = await getSessionUser()
  assertSuperAdmin(user?.role)
  const supabase = createSupabaseRSC()

  const title = String(formData.get('title') || '').trim()
  const description = (String(formData.get('description') || '').trim() || null) as string | null
  const discount_type = String(formData.get('discount_type')) === 'amount' ? 'amount' : 'percent'
  const discount_value = Number(formData.get('discount_value') || 0)
  const applies_to = parseApplies(formData)
  const min_months = formData.get('min_months') ? Number(formData.get('min_months')) : null
  const start_date = formData.get('start_date') ? String(formData.get('start_date')) : null
  const end_date = formData.get('end_date') ? String(formData.get('end_date')) : null

  if (!title) throw new Error('Title is required')
  if (!discount_value || discount_value <= 0) throw new Error('Discount value must be > 0')
  if (!applies_to.length) throw new Error('Choose at least one Applies to')

  const { error } = await supabase
    .from('promotions')
    .update({
      title,
      description,
      discount_type,
      discount_value,
      applies_to,
      min_months,
      start_date,
      end_date,
    })
    .eq('id', id)

  if (error) throw error
  revalidatePath('/packages-and-promos')
}

export async function deletePromo(id: string) {
  const user = await getSessionUser()
  assertSuperAdmin(user?.role)
  const supabase = createSupabaseServerActionClient()
  const { error } = await supabase.from('promotions').delete().eq('id', id)
  if (error) throw error
  revalidatePath('/packages-and-promos')
  return { ok: true }
}
