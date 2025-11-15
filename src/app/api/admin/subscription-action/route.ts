// src/app/api/admin/subscription-action/route.ts
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

type Action = 'renew' | 'pause' | 'resume' | 'add_dropin';
type Plan = 'monthly' | 'quarterly' | 'yearly';
type PaymentMethod = 'cash' | 'card' | 'transfer' | 'online';

function isISODate(s?: string): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function addMonths(isoDate: string, months: number) {
  const d = new Date(isoDate);
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  if (d.getDate() < day) d.setDate(0);
  return d.toISOString().slice(0, 10);
}

async function writeAudit(
  admin: SupabaseClient,
  actor_user_id: string | null,
  target_user_id: string,
  action: string,
  action_details: any
) {
  const row = { actor_user_id, target_user_id, action, action_details };
  const { error } = await admin.from('audit_logs').insert(row as any);
  if (error) console.error('audit_logs insert error:', error.message);
}

async function createPayment(
  admin: SupabaseClient,
  args: {
    user_id: string;
    subscription_id: string | null;
    amount: number;
    method: PaymentMethod;
    paid_at?: string;
    currency?: string;
    note?: string;
  }
) {
  const { error } = await admin.from('payments').insert({
    user_id: args.user_id,
    subscription_id: args.subscription_id,
    amount: args.amount,
    method: args.method,
    paid_at: args.paid_at ?? new Date().toISOString(),
    currency: args.currency ?? 'EGP',
    note: args.note ?? null,
  });
  if (error) throw error;
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    hint:
      "POST { user_id, action: 'renew'|'pause'|'resume'|'add_dropin', start_date?: 'YYYY-MM-DD', plan?, amount?, actor_user_id?, payment?: { amount, method, paid_at?, currency?, note? } }",
  });
}

export async function POST(req: NextRequest) {
  try {
    const {
      user_id,
      action,
      plan,
      amount,
      actor_user_id,
      start_date,
      payment,
    } = (await req.json()) as {
      user_id?: string;
      action?: Action;
      plan?: Plan;
      amount?: number;
      actor_user_id?: string | null;
      start_date?: string; // YYYY-MM-DD
      payment?: { amount: number; method: PaymentMethod; paid_at?: string; currency?: string; note?: string };
    };

    if (!user_id || !action) {
      return NextResponse.json({ ok: false, error: 'Missing user_id or action' }, { status: 400 });
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    if (!url || !service) {
      return NextResponse.json({ ok: false, error: 'Server env missing' }, { status: 500 });
    }

    const admin = createClient(url, service);

    // Dernière souscription (si existe)
    const { data: subs, error: subErr } = await admin
      .from('subscriptions')
      .select('*')
      .eq('user_id', user_id)
      .order('start_date', { ascending: false })
      .limit(1);
    if (subErr) return NextResponse.json({ ok: false, error: subErr.message }, { status: 400 });

    const sub = subs?.[0] ?? null;

    const today = new Date().toISOString().slice(0, 10);
    const start = isISODate(start_date) ? start_date : today; // ← on prend la date saisie si fournie et valide

    if (action === 'renew') {
      const usePlan: Plan = plan ?? 'monthly';
      const monthsMap: Record<Plan, number> = { monthly: 1, quarterly: 3, yearly: 12 };

      // Cas 1 : pas de standard en cours OU dernier est un drop-in → créer une nouvelle standard en partant de "start"
      if (!sub || sub.subscription_type === 'pay_per_class') {
        const end = addMonths(start, monthsMap[usePlan]);
        const { data: inserted, error } = await admin
          .from('subscriptions')
          .insert({
            user_id,
            subscription_type: usePlan,
            start_date: start,
            end_date: end,
            status: 'active',
          })
          .select('id')
          .single();
        if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });

        await writeAudit(admin, actor_user_id ?? null, user_id, 'renew', {
          mode: 'insert',
          plan: usePlan,
          start_date: start,
          end_date: end,
        });

        // Paiement (optionnel)
        if (payment?.amount && payment.method) {
          await createPayment(admin, {
            user_id,
            subscription_id: inserted.id,
            amount: payment.amount,
            method: payment.method,
            paid_at: payment.paid_at,
            currency: payment.currency,
            note: payment.note,
          });
        }

        return NextResponse.json({ ok: true, action, mode: 'insert', start_date: start, end_date: end });
      }

      // Cas 2 : standard existe → on étend depuis max(end_date existante, start saisi)
      // - Si l'abo actuel finit après la date saisie, on prolonge à partir de la fin actuelle.
      // - Sinon, on repart de la date saisie (utile pour backdating).
      const base = sub.end_date && sub.end_date > start ? sub.end_date : start;
      const newEnd = addMonths(base, monthsMap[usePlan]);

      const { error } = await admin
        .from('subscriptions')
        .update({ end_date: newEnd, status: 'active', subscription_type: usePlan })
        .eq('id', sub.id);
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });

      await writeAudit(admin, actor_user_id ?? null, user_id, 'renew', {
        mode: 'extend',
        plan: usePlan,
        base_from: base,
        start_requested: start,
        new_end_date: newEnd,
      });

      if (payment?.amount && payment.method) {
        await createPayment(admin, {
          user_id,
          subscription_id: sub.id,
          amount: payment.amount,
          method: payment.method,
          paid_at: payment.paid_at,
          currency: payment.currency,
          note: payment.note,
        });
      }

      return NextResponse.json({ ok: true, action, mode: 'extend', start_base: base, end_date: newEnd });
    }

    if (action === 'pause') {
      if (!sub || sub.subscription_type === 'pay_per_class') {
        return NextResponse.json({ ok: false, error: 'No standard subscription to pause' }, { status: 400 });
      }
      const { error } = await admin.from('subscriptions').update({ status: 'suspended' }).eq('id', sub.id);
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });

      await writeAudit(admin, actor_user_id ?? null, user_id, 'pause', { sub_id: sub.id });
      return NextResponse.json({ ok: true, action, status: 'suspended' });
    }

    if (action === 'resume') {
      if (!sub || sub.subscription_type === 'pay_per_class') {
        return NextResponse.json({ ok: false, error: 'No standard subscription to resume' }, { status: 400 });
      }
      const { error } = await admin.from('subscriptions').update({ status: 'active' }).eq('id', sub.id);
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });

      await writeAudit(admin, actor_user_id ?? null, user_id, 'resume', { sub_id: sub.id });
      return NextResponse.json({ ok: true, action, status: 'active' });
    }

    if (action === 'add_dropin') {
      const add = Number.isFinite(amount) ? Number(amount) : 5;

      const validDropIn = (() => {
        if (!sub || sub.subscription_type !== 'pay_per_class') return false;
        const anchor = isISODate(sub.start_date) ? sub.start_date : today;
        const exp = new Date(anchor);
        exp.setDate(exp.getDate() + 45);
        return exp.toISOString().slice(0, 10) >= today && (sub.remaining_classes ?? 0) >= 0;
      })();

      // Si drop-in valide → on incrémente
      if (validDropIn) {
        const newRemaining = (sub.remaining_classes ?? 0) + add;
        const { error } = await admin
          .from('subscriptions')
          .update({ remaining_classes: newRemaining, status: 'active' })
          .eq('id', sub.id);
        if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });

        await writeAudit(admin, actor_user_id ?? null, user_id, 'add_dropin', {
          mode: 'increment',
          add,
          new_remaining: newRemaining,
          sub_id: sub.id,
        });

        if (payment?.amount && payment.method) {
          await createPayment(admin, {
            user_id,
            subscription_id: sub.id,
            amount: payment.amount,
            method: payment.method,
            paid_at: payment.paid_at,
            currency: payment.currency,
            note: payment.note,
          });
        }

        return NextResponse.json({ ok: true, action, mode: 'increment', remaining_classes: newRemaining });
      }

      // Sinon, créer un nouveau drop-in avec start_date choisi (ou aujourd’hui)
      const dropStart = start; // ← respecte la date saisie
      const { data: inserted, error } = await admin
        .from('subscriptions')
        .insert({
          user_id,
          subscription_type: 'pay_per_class',
          remaining_classes: add,
          start_date: dropStart,
          status: 'active',
        })
        .select('id')
        .single();
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });

      await writeAudit(admin, actor_user_id ?? null, user_id, 'add_dropin', {
        mode: 'insert',
        add,
        start_date: dropStart,
      });

      if (payment?.amount && payment.method) {
        await createPayment(admin, {
          user_id,
          subscription_id: inserted.id,
          amount: payment.amount,
          method: payment.method,
          paid_at: payment.paid_at,
          currency: payment.currency,
          note: payment.note,
        });
      }

      return NextResponse.json({ ok: true, action, mode: 'insert', remaining_classes: add, start_date: dropStart });
    }

    return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message ?? 'Server error' }, { status: 500 });
  }
}
