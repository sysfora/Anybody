import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import pb from '@/lib/pocketbase';
import { getSessionRecord } from '@/lib/session-user';
import { getEffectiveUserId } from '@/lib/server-utils';

export const dynamic = 'force-dynamic';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-11-17.clover',
});

const CREDIT_COST_PER_GENERATION = 100;

interface PocketBaseUser {
  id: string;
  credits?: number;
  credits_used?: number;
  auto_reload_enabled?: boolean;
  reload_amount?: number;
  reload_threshold?: number;
  stripe_id?: string;
  plan?: string;
  [key: string]: unknown;
}

export async function POST() {
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
    const newCreditsUsed = creditsUsed + CREDIT_COST_PER_GENERATION;

    await pb.collection('users').update(effectiveUserId, {
      credits_used: newCreditsUsed,
    });

    const newAvailable = credits - newCreditsUsed;
    const threshold = user.reload_threshold ?? 10;
    const isPro = user.plan === 'pro' || user.plan === 'Pro';

    const shouldAutoReload =
      isPro &&
      user.auto_reload_enabled === true &&
      !!user.stripe_id &&
      newAvailable <= threshold;

    if (!shouldAutoReload) {
      return NextResponse.json({
        success: true,
        creditsRemaining: newAvailable,
        creditsUsed: newCreditsUsed,
        totalCredits: credits,
        insufficientCredits: newAvailable < 0,
        autoReloaded: false,
      });
    }

    // --- Inline auto-reload via Stripe ---
    const reloadAmount = user.reload_amount ?? 10;
    const creditsToAdd = Math.floor((reloadAmount / 10) * 500);

    try {
      const customer = await stripe.customers.retrieve(user.stripe_id!);
      if (customer.deleted || typeof customer !== 'object') {
        throw new Error('Stripe customer not found');
      }

      const paymentMethods = await stripe.paymentMethods.list({
        customer: user.stripe_id!,
        type: 'card',
      });

      if (paymentMethods.data.length === 0) {
        throw new Error('No payment method on file');
      }

      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(reloadAmount * 100),
        currency: 'usd',
        customer: user.stripe_id!,
        payment_method: paymentMethods.data[0].id,
        description: `Auto-reload: ${creditsToAdd} credits for $${reloadAmount}`,
        metadata: {
          userId: effectiveUserId,
          type: 'auto_reload',
          credits: creditsToAdd.toString(),
        },
        confirm: true,
        return_url: `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/settings`,
      });

      if (paymentIntent.status === 'succeeded') {
        const newCredits = credits + creditsToAdd;
        await pb.collection('users').update(effectiveUserId, { credits: newCredits });

        return NextResponse.json({
          success: true,
          creditsRemaining: newCredits - newCreditsUsed,
          creditsUsed: newCreditsUsed,
          totalCredits: newCredits,
          insufficientCredits: false,
          autoReloaded: true,
          creditsAdded: creditsToAdd,
          amountCharged: reloadAmount,
        });
      }

      if (paymentIntent.status === 'requires_action') {
        return NextResponse.json({
          success: true,
          creditsRemaining: newAvailable,
          creditsUsed: newCreditsUsed,
          totalCredits: credits,
          insufficientCredits: newAvailable < 0,
          autoReloaded: false,
          autoReloadError: 'Payment requires additional authentication',
          requiresAction: true,
          clientSecret: paymentIntent.client_secret,
        });
      }

      throw new Error(`Payment failed with status: ${paymentIntent.status}`);
    } catch (stripeError) {
      const message =
        stripeError instanceof Error ? stripeError.message : 'Auto-reload payment failed';

      return NextResponse.json({
        success: true,
        creditsRemaining: newAvailable,
        creditsUsed: newCreditsUsed,
        totalCredits: credits,
        insufficientCredits: newAvailable < 0,
        autoReloaded: false,
        autoReloadError: message,
      });
    }
  } catch (error) {
    console.error('Deduct credit error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to deduct credit' },
      { status: 500 }
    );
  }
}
