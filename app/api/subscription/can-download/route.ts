import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import pb from '@/lib/pocketbase';
import { getEffectiveUserId } from '@/lib/server-utils';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-11-17.clover',
});

export async function POST(request: NextRequest) {
  try {
    const { userId } = await request.json();

    if (!userId) {
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 400 }
      );
    }

    await pb.admins.authWithPassword(
      process.env.POCKETBASE_SUPERADMIN_EMAIL!,
      process.env.POCKETBASE_SUPERADMIN_PASSWORD!
    );

    // Get effective user ID (owner ID if team member, otherwise user's own ID)
    const effectiveUserId = await getEffectiveUserId(userId);

    // Get user to find their Stripe customer ID and credits
    const user = await pb.collection('users').getOne(effectiveUserId);
    const stripeCustomerId = user.stripe_id;
    const credits = user.credits || 0;
    const creditsUsed = user.credits_used || 0;
    const availableCredits = credits - creditsUsed;

    if (!stripeCustomerId) {
      return NextResponse.json({
        canDownload: false,
        plan: 'free',
        reason: 'subscription_required',
      });
    }

    // Get active subscriptions from Stripe
    const subscriptions = await stripe.subscriptions.list({
      customer: stripeCustomerId,
      status: 'all',
      limit: 1,
    });

    if (subscriptions.data.length === 0) {
      return NextResponse.json({
        canDownload: false,
        plan: 'free',
        reason: 'subscription_required',
      });
    }

    const subscription = subscriptions.data[0];
    const isActive = subscription.status === 'active' || subscription.status === 'trialing';

    if (!isActive) {
      return NextResponse.json({
        canDownload: false,
        plan: 'free',
        reason: 'subscription_required',
      });
    }

    // Pro plan users can download (unlimited downloads)
    return NextResponse.json({
      canDownload: true,
      plan: 'pro',
      availableCredits,
    });
  } catch (error) {
    console.error('Error checking download permission:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

