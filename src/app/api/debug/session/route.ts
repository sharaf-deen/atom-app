import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

export async function GET() {
  const cookieStore = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name) { return cookieStore.get(name)?.value; },
        set(name, value, options) { cookieStore.set({ name, value, ...(options ?? {}) }); },
        remove(name, options) { cookieStore.set({ name, value: '', ...(options ?? {}), maxAge: 0 }); },
      },
    }
  );

  const { data: { user }, error } = await supabase.auth.getUser();

  // rôle
  let role: string | null = null;
  if (user?.id) {
    const { data: prof } = await supabase
      .from('profiles')
      .select('role')
      .eq('user_id', user.id)
      .maybeSingle();
    role = prof?.role ?? null;
  }

  return NextResponse.json({
    ok: true,
    url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? null,
    hasAccessCookie: !!cookieStore.get('sb-access-token'),
    user: user ? { id: user.id, email: user.email } : null,
    role,
    error: error?.message ?? null,
  });
}
