// src/app/api/admin/audit/route.ts
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/apiAuth'

/**
 * GET /api/admin/audit
 * Retourne les 20 dernières actions de l’audit log.
 * (Utilise la SERVICE_ROLE, donc accessible seulement côté serveur)
 */
export async function GET() {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.res

  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    if (!url || !service) {
      return NextResponse.json({ ok: false, error: 'Server env missing' }, { status: 500 });
    }

    const admin = createClient(url, service);

    const { data, error } = await admin
      .from('audit_logs')
      .select('id, created_at, actor_user_id, target_user_id, action, action_details')
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true, logs: data ?? [] });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message ?? 'Server error' }, { status: 500 });
  }
}
