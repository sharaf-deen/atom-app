export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireStaff } from '@/lib/apiAuth'
import { getAppUrl } from '@/lib/appUrl'

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!, // server only
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export async function POST(req: NextRequest) {
  try {
    const gate = await requireStaff()
    if (!gate.ok) return gate.res

    const { first_name, last_name, email, phone } = await req.json();

    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      return NextResponse.json({ ok: false, error: 'Invalid email' }, { status: 400 });
    }

    // 1) Invite l’utilisateur (envoie l’email via Resend SMTP configuré dans Supabase)
    const { data: invite, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(
      email.toLowerCase(),
      {
        data: { first_name, last_name, phone, role: 'member' },
        redirectTo: `${getAppUrl()}/auth/complete-invite`,
      }
    );
    if (inviteErr) {
      return NextResponse.json({ ok: false, error: `inviteUserByEmail: ${inviteErr.message}` }, { status: 500 });
    }

    const userId = invite.user?.id;
    if (!userId) {
      return NextResponse.json({ ok: false, error: 'No user id returned' }, { status: 500 });
    }

    // 2) Upsert du profil (first/last/phone/role)
    const { error: profErr } = await admin
      .from('profiles')
      .upsert(
        {
          user_id: userId,
          email: email.toLowerCase(),
          first_name,
          last_name,
          phone,
          role: 'member',
        },
        { onConflict: 'user_id' }
      );

    if (profErr) {
      return NextResponse.json({ ok: false, error: `profiles upsert: ${profErr.message}` }, { status: 500 });
    }

    return NextResponse.json({ ok: true, user_id: userId });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Unexpected error' }, { status: 500 });
  }
}
