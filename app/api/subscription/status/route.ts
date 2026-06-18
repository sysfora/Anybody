import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import pb from '@/lib/pocketbase';
import { getBillingCycleForPriceId, getCreditsForPriceId } from '@/lib/stripe';

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

    // No team checks - allow all users to access subscription status
    // Get user to find their Stripe customer ID
    const user = await pb.collection('users').getOne(userId);
    const stripeCustomerId = user.stripe_id;

    if (!stripeCustomerId) {
      return NextResponse.json({
        hasActiveSubscription: false,
        plan: 'free',
        billingCycle: null,
        status: null,
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
        hasActiveSubscription: false,
        plan: 'free',
        billingCycle: null,
        status: null,
      });
    }

    const subscription = subscriptions.data[0];
    const priceId = subscription.items.data[0]?.price.id;
    const billingCycle = priceId ? getBillingCycleForPriceId(priceId) : null;
    const subscriptionCredits = priceId ? getCreditsForPriceId(priceId) : undefined;
    const isActive = subscription.status === 'active' || subscription.status === 'trialing';

    // Access subscription properties safely
    const subData = subscription as Stripe.Subscription & { current_period_end?: number; cancel_at_period_end?: boolean };

    return NextResponse.json({
      hasActiveSubscription: isActive,
      plan: isActive ? 'pro' : 'free',
      billingCycle: billingCycle,
      subscriptionCredits,
      status: subscription.status,
      currentPeriodEnd: subData.current_period_end ? subData.current_period_end * 1000 : undefined,
      cancelAtPeriodEnd: subData.cancel_at_period_end || false,
    });
  } catch (error) {
    console.error('Error fetching subscription status:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

