'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { getSessionUser } from '@/lib/session'

export async function reserveEquipment(formData: FormData) {
  // Vérifier la session (empêche les réservations anonymes)
  const user = await getSessionUser()
  if (!user) {
    // tu peux aussi renvoyer un message au lieu d'une redirection
    redirect('/login?next=/reserve')
  }

  const item_name = String(formData.get('item_name') ?? '').trim()
  const advance_str = String(formData.get('advance') ?? '0').trim()
  const advance_paid = Number(advance_str)

  if (!item_name) {
    throw new Error('Item name is required')
  }
  if (!Number.isFinite(advance_paid) || advance_paid < 0) {
    throw new Error('Advance must be a positive number')
  }

  const supabase = createSupabaseServerActionClient()

  const { error } = await supabase.from('equipment_reservations').insert({
    user_id: user.id,
    item_name,
    advance_paid,
  })

  if (error) {
    console.error('reserveEquipment error', error)
    throw new Error(error.message)
  }

  // Si tu as une page listant les réservations, revalide-la
  revalidatePath('/reserve')

  // feedback minimal via querystring (ou utilise useFormState si tu préfères)
  redirect('/reserve?ok=1')
}
