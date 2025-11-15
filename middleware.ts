// middleware.ts
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export async function middleware(req: NextRequest) {
  // Routes protégées (auth obligatoire)
  const protectedPaths = [/^\/admin(?:\/|$)/, /^\/scan$/, /^\/kiosk$/];
  const { pathname } = req.nextUrl;
  const needsAuth = protectedPaths.some((re) => re.test(pathname));

  if (!needsAuth) {
    return NextResponse.next();
  }

  // On prépare une réponse modifiable (pour écrire les cookies si besoin)
  const res = NextResponse.next();

  // Crée un client Supabase SSR en pontant l'API cookies de Next middleware
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (name: string) => req.cookies.get(name)?.value,
        set: (name: string, value: string, options: any) => {
          // Refléter la mise à jour de cookie dans la réponse
          res.cookies.set({ name, value, ...options });
        },
        remove: (name: string, options: any) => {
          res.cookies.set({ name, value: '', ...options, maxAge: 0 });
        },
      },
    }
  );

  // Vérifie la session
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('redirectedFrom', pathname);
    return NextResponse.redirect(url);
  }

  // Auth OK → laisser passer (les pages vérifieront le rôle)
  return res;
}

// Limiter le middleware aux routes utiles
export const config = {
  matcher: ['/admin/:path*', '/scan', '/kiosk'],
};
