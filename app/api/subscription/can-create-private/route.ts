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

    // Get user to find their Stripe customer ID
    const user = await pb.collection('users').getOne(effectiveUserId);
    const stripeCustomerId = user.stripe_id;

    if (!stripeCustomerId) {
      return NextResponse.json({
        canCreatePrivate: false,
        plan: 'free',
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
        canCreatePrivate: false,
        plan: 'free',
      });
    }

    const subscription = subscriptions.data[0];
    const isActive = subscription.status === 'active' || subscription.status === 'trialing';

    return NextResponse.json({
      canCreatePrivate: isActive,
      plan: isActive ? 'pro' : 'free',
    });
  } catch (error) {
    console.error('Error checking private project permission:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

