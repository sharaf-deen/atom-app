// src/components/Header.tsx
import Link from 'next/link';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

async function getRoleAndEmail() {
  const cookieStore = cookies();

  // ⚠️ Ne pas écrire les cookies ici : no-ops
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set() { /* no-op in RSC */ },
        remove() { /* no-op in RSC */ },
      },
    } as any
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { isAdmin: false, email: null };

  const { data: prof } = await supabase
    .from('profiles')
    .select('role,email')
    .eq('user_id', user.id)
    .maybeSingle();

  return {
    isAdmin: prof?.role === 'admin',
    email: prof?.email ?? user.email ?? null,
  };
}

export default async function Header() {
  const { isAdmin, email } = await getRoleAndEmail();

  return (
    <header className="w-full border-b bg-white">
      <nav className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-4">
        <Link href="/" className="font-semibold">Atom JJ</Link>
        <Link href="/profile">Profile</Link>
        <Link href="/store">Store</Link>
        {isAdmin && (
          <>
            <Link href="/admin">Admin</Link>
            <Link href="/scan">Scan</Link>
            <Link href="/kiosk">Kiosk</Link>
          </>
        )}
        <div className="ml-auto text-sm text-gray-600">
          {email ? `Signed in: ${email}` : <Link href="/login" className="underline">Login</Link>}
        </div>
      </nav>
    </header>
  );
}
