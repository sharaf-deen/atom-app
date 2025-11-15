export const runtime = 'nodejs';
import { NextResponse } from 'next/server';

// Petit alias qui redirige vers /api/admin/stats côté client
export async function GET() {
  // On pourrait aussi copier la logique de /api/admin/stats ici,
  // mais un alias simple suffit pour ton MVP.
  return NextResponse.redirect(new URL('/api/admin/stats', 'http://localhost:3000'));
}
