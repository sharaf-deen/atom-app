import { NextResponse } from 'next/server'
import { getSessionUser, type SessionUser } from '@/lib/session'
import { type Role, hasAnyRole, STAFF_ROLES, ADMIN_ROLES, SUPER_ADMIN_ROLES } from '@/lib/rbac'

type GateOk = { ok: true; user: SessionUser }
type GateKo = { ok: false; res: NextResponse }
export type Gate = GateOk | GateKo

function deny(status: number, error: string): GateKo {
  return {
    ok: false,
    res: NextResponse.json({ ok: false, error }, { status }),
  }
}

export async function requireUser(): Promise<Gate> {
  const user = await getSessionUser()
  if (!user) return deny(401, 'NOT_AUTHENTICATED')
  return { ok: true, user }
}

export async function requireRoles(allowed: readonly Role[]): Promise<Gate> {
  const gate = await requireUser()
  if (!gate.ok) return gate
  if (!hasAnyRole(gate.user.role, allowed)) return deny(403, 'FORBIDDEN')
  return gate
}

export async function requireStaff(): Promise<Gate> {
  return requireRoles(STAFF_ROLES)
}

export async function requireAdmin(): Promise<Gate> {
  return requireRoles(ADMIN_ROLES)
}

export async function requireSuperAdmin(): Promise<Gate> {
  return requireRoles(SUPER_ADMIN_ROLES)
}
