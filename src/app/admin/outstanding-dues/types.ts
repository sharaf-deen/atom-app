export type OutstandingDueRow = {
  subscription_id: string
  user_id: string
  member_code: string | null
  name: string
  email: string | null
  phone: string | null
  plan: string | null
  status: string | null
  paid_at: string | null
  paid: number
  due: number
  total: number
  payment_method: string | null
}
