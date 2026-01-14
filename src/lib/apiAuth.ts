@'
import { NextResponse } from "next/server";
import { getSessionUser, type Role, type SessionUser } from "@/lib/session";

type GateOk = { ok: true; user: SessionUser };
type GateKo = { ok: false; res: NextResponse };
type Gate = GateOk | GateKo;

function deny(status: number, error: string) {
  return { ok: false as const, res: NextResponse.json({ ok: false, error }, { status }) };
}

export async function requireUser(): Promise<Gate> {
  const user = await getSessionUser();
  if (!user) return deny(401, "NOT_AUTHENTICATED");
  return { ok: true, user };
}

const STAFF: Role[] = ["reception", "assistant_coach", "coach", "admin", "super_admin"];
export async function requireStaff(): Promise<Gate> {
  const gate = await requireUser();
  if (!gate.ok) return gate;
  if (!STAFF.includes(gate.user.role)) return deny(403, "FORBIDDEN");
  return gate;
}

const ADMINS: Role[] = ["admin", "super_admin"];
export async function requireAdmin(): Promise<Gate> {
  const gate = await requireUser();
  if (!gate.ok) return gate;
  if (!ADMINS.includes(gate.user.role)) return deny(403, "FORBIDDEN");
  return gate;
}
'@ | Set-Content -Encoding UTF8 .\src\lib\apiAuth.ts
