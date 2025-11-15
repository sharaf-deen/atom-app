export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET(req: NextRequest) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    if (!url || !service) {
      return NextResponse.json({ ok:false, error:'Server env missing' }, { status:500 });
    }

    const user_id = req.nextUrl.searchParams.get('user_id');
    if (!user_id) {
      return NextResponse.json({ ok:false, error:'Missing user_id' }, { status:400 });
    }

    const admin = createClient(url, service);
    const { data, error } = await admin
      .from('subscriptions')
      .select('*')
      .eq('user_id', user_id)
      .order('start_date', { ascending: false })
      .limit(3);

    if (error) return NextResponse.json({ ok:false, error:error.message }, { status:400 });
    return NextResponse.json({ ok:true, rows:data });
  } catch (e:any) {
    return NextResponse.json({ ok:false, error:e.message ?? 'Server error' }, { status:500 });
  }
}
