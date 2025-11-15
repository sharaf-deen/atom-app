// src/app/api/admin/find-member/route.ts
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

/**
 * POST /api/admin/find-member
 * Body: { email: string }
 * Retourne le profil et la dernière souscription du membre.
 * Utilise SERVICE_ROLE pour bypass RLS côté admin.
 */
export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();
    if (!email || typeof email !== 'string') {
      return NextResponse.json({ ok: false, error: 'Missing email' }, { status: 400 });
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    if (!url || !service) {
      return NextResponse.json({ ok: false, error: 'Server env missing' }, { status: 500 });
    }

    const admin = createClient(url, service);

    // 1) Profil
    const { data: profile, error: pErr } = await admin
      .from('profiles')
      .select('user_id,email,first_name,last_name,phone,role')
      .eq('email', email)
      .maybeSingle();

    if (pErr) return NextResponse.json({ ok: false, error: pErr.message }, { status: 400 });
    if (!profile) return NextResponse.json({ ok: false, error: 'Member not found' }, { status: 404 });

    // 2) Dernière souscription
    const { data: subs, error: sErr } = await admin
      .from('subscriptions')
      .select('*')
      .eq('user_id', profile.user_id)
      .order('start_date', { ascending: false })
      .limit(1);

    if (sErr) return NextResponse.json({ ok: false, error: sErr.message }, { status: 400 });

    const last_subscription = subs?.[0] ?? null;

    return NextResponse.json({ ok: true, profile, last_subscription });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message ?? 'Server error' }, { status: 500 });
  }
}

/**
 * GET /api/admin/find-member
 * Hint pour tests rapides.
 */
export async function GET() {
  return NextResponse.json({ ok: true, hint: 'POST { email }' });
}
