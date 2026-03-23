import { NextResponse } from 'next/server';
import pb from '@/lib/pocketbase';
import { getSessionRecord } from '@/lib/session-user';
import { getEffectiveUserId } from '@/lib/server-utils';

export const dynamic = 'force-dynamic';

const CREDIT_COST_PER_GENERATION = 10;

interface PocketBaseUser {
  id: string;
  credits?: number;
  credits_used?: number;
  auto_reload_enabled?: boolean;
  plan?: string;
  [key: string]: unknown;
}

export async function GET() {
  try {
    const session = await getSessionRecord();
    if (!session?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await pb.admins.authWithPassword(
      process.env.POCKETBASE_SUPERADMIN_EMAIL!,
      process.env.POCKETBASE_SUPERADMIN_PASSWORD!
    );

    const effectiveUserId = await getEffectiveUserId(session.id);
    const user = (await pb.collection('users').getOne(effectiveUserId)) as PocketBaseUser;

    const credits = user.credits ?? 0;
    const creditsUsed = user.credits_used ?? 0;
    const availableCredits = credits - creditsUsed;
    const plan: 'free' | 'pro' =
      user.plan === 'pro' || user.plan === 'Pro' ? 'pro' : 'free';
    const autoReloadEnabled = user.auto_reload_enabled === true;

    const hasEnoughCredits = availableCredits >= CREDIT_COST_PER_GENERATION;
    // Pro + auto-reload enabled: allow through even if credits are low
    // (auto-reload will fire during deduction)
    const canGenerate = hasEnoughCredits || (plan === 'pro' && autoReloadEnabled);

    return NextResponse.json({
      canGenerate,
      availableCredits,
      plan,
      autoReloadEnabled,
    });
  } catch (error) {
    console.error('check-credits error:', error);
    // Fail open so a server error never silently blocks generation
    return NextResponse.json({ canGenerate: true, availableCredits: 0, plan: 'free', autoReloadEnabled: false });
  }
}
