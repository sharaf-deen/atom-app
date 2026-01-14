export const runtime = 'nodejs';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/apiAuth'

export async function POST(req: NextRequest) {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.res

  const { q, role, limit = 50 } = await req.json().catch(() => ({}));
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  let query = admin.from('profiles')
    .select('user_id,email,first_name,last_name,phone,role')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (role) {
    query = query.eq('role', role);
  }
  if (q && typeof q === 'string' && q.trim()) {
    const like = `%${q.trim()}%`;
    query = query.or(`email.ilike.${like},first_name.ilike.${like},last_name.ilike.${like},phone.ilike.${like}`);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ ok:false, error:error.message }, { status:400 });

  return NextResponse.json({ ok:true, members:data });
}
