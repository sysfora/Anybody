import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import pb from '@/lib/pocketbase';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-11-17.clover',
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, autoReloadEnabled, reloadAmount, reloadThreshold } = body;

    if (!userId) {
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 400 }
      );
    }

    // Authenticate as admin first
    await pb.admins.authWithPassword(
      process.env.POCKETBASE_SUPERADMIN_EMAIL!,
      process.env.POCKETBASE_SUPERADMIN_PASSWORD!
    );

    if (autoReloadEnabled) {
      if (!reloadAmount || reloadAmount < 10) {
        return NextResponse.json(
          { error: 'Reload amount must be at least $10' },
          { status: 400 }
        );
      }

      if (!reloadThreshold || reloadThreshold < 100) {
        return NextResponse.json(
          { error: 'Reload threshold must be at least 100 credits' },
          { status: 400 }
        );
      }
    }

    const user = await pb.collection('users').getOne(userId);

    // Check if user is trying to enable auto-reload
    if (autoReloadEnabled) {
      const stripeCustomerId = user.stripe_id;

      if (!stripeCustomerId) {
        return NextResponse.json(
          { error: 'Please add a payment method first. You can do this by subscribing to Pro.' },
          { status: 400 }
        );
      }

      // Check subscription status directly from Stripe
      const subscriptions = await stripe.subscriptions.list({
        customer: stripeCustomerId,
        status: 'all',
        limit: 1,
      });

      const hasActiveSubscription = subscriptions.data.length > 0 && 
        (subscriptions.data[0].status === 'active' || subscriptions.data[0].status === 'trialing');

      if (!hasActiveSubscription) {
        return NextResponse.json(
          { error: 'Auto-reload is only available for Pro users. Please upgrade to Pro to use this feature.' },
          { status: 403 }
        );
      }

      // Check if user has a payment method in Stripe
      const paymentMethods = await stripe.paymentMethods.list({
        customer: stripeCustomerId,
        type: 'card',
      });

      if (paymentMethods.data.length === 0) {
        return NextResponse.json(
          { error: 'Please add a payment method first. You can do this by subscribing to Pro.' },
          { status: 400 }
        );
      }
    }

    const updatedUser = await pb.collection('users').update(userId, {
      auto_reload_enabled: autoReloadEnabled,
      reload_amount: reloadAmount,
      reload_threshold: reloadThreshold,
    });

    return NextResponse.json({
      success: true,
      user: {
        id: updatedUser.id,
        name: updatedUser.name,
        email: updatedUser.email,
        avatar: updatedUser.avatar,
        verified: updatedUser.verified,
        credits: updatedUser.credits,
        credits_used: updatedUser.credits_used,
        auto_reload_enabled: updatedUser.auto_reload_enabled,
        reload_amount: updatedUser.reload_amount,
        reload_threshold: updatedUser.reload_threshold,
      },
    });
  } catch (error: unknown) {
    console.error('Credits update error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update credits settings' },
      { status: 400 }
    );
  }
}

