export const runtime = 'nodejs';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/apiAuth'

export async function POST(req: NextRequest) {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.res

  const { user_id, plan_type, remaining_classes, start_date, end_date } = await req.json();

  if (!user_id || !plan_type) {
    return NextResponse.json({ ok:false, error:'Missing user_id or plan_type' }, { status:400 });
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Normalise les champs
  const payload: any = {
    user_id,
    subscription_type: plan_type,   // 'monthly' | 'quarterly' | 'yearly' | 'pay_per_class'
    status: 'active',
    start_date: start_date ?? new Date().toISOString().slice(0,10),
  };

  if (plan_type === 'pay_per_class') {
    payload.remaining_classes = Number(remaining_classes ?? 10);
    payload.end_date = null;
  } else {
    // si end_date pas fourni, calcule selon plan_type
    if (!end_date) {
      const start = new Date(payload.start_date);
      if (plan_type === 'monthly') start.setMonth(start.getMonth() + 1);
      if (plan_type === 'quarterly') start.setMonth(start.getMonth() + 3);
      if (plan_type === 'yearly') start.setFullYear(start.getFullYear() + 1);
      payload.end_date = start.toISOString().slice(0,10);
    } else {
      payload.end_date = end_date;
    }
  }

  const { error } = await admin.from('subscriptions').insert(payload);
  if (error) return NextResponse.json({ ok:false, error:error.message }, { status:400 });

  return NextResponse.json({ ok:true });
}
