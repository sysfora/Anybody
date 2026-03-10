import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import pb from '@/lib/pocketbase';
import { getEffectiveUserId } from '@/lib/server-utils';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-11-17.clover',
});

interface PocketBaseUser {
  id: string;
  email?: string;
  credits?: number;
  credits_used?: number;
  auto_reload_enabled?: boolean;
  reload_amount?: number;
  reload_threshold?: number;
  stripe_id?: string;
  plan?: string;
  [key: string]: unknown;
}

/**
 * Auto-reload credits when they fall below threshold
 * Cost: 500 Credits = $10
 * Formula: credits = (amount / 10) * 500
 */
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

    const user = await pb.collection('users').getOne(effectiveUserId) as PocketBaseUser;

    // Check if auto-reload is enabled
    if (!user.auto_reload_enabled) {
      return NextResponse.json(
        { error: 'Auto-reload is not enabled' },
        { status: 400 }
      );
    }

    // Check if user has Stripe customer ID (required for charging)
    if (!user.stripe_id) {
      return NextResponse.json(
        { error: 'No payment method on file. Please add a payment method first.' },
        { status: 400 }
      );
    }

    // Check if user is on Pro plan (auto-reload only for Pro users)
    if (user.plan !== 'pro' && user.plan !== 'Pro') {
      return NextResponse.json(
        { error: 'Auto-reload is only available for Pro plan users' },
        { status: 400 }
      );
    }

    const currentCredits = user.credits || 0;
    const creditsUsed = user.credits_used || 0;
    const availableCredits = currentCredits - creditsUsed;
    const threshold = user.reload_threshold || 10;
    const reloadAmount = user.reload_amount || 10;

    // Check if credits are below threshold
    if (availableCredits > threshold) {
      return NextResponse.json(
        { 
          message: 'Credits are above threshold',
          availableCredits,
          threshold 
        },
        { status: 200 }
      );
    }

    // Calculate credits to add: $10 = 500 credits
    // Formula: credits = (amount / 10) * 500
    const creditsToAdd = Math.floor((reloadAmount / 10) * 500);

    // Get customer's default payment method
    try {
      const customer = await stripe.customers.retrieve(user.stripe_id);
      
      if (customer.deleted || typeof customer !== 'object') {
        return NextResponse.json(
          { error: 'Customer not found in Stripe' },
          { status: 400 }
        );
      }

      // Get customer's payment methods
      const paymentMethods = await stripe.paymentMethods.list({
        customer: user.stripe_id,
        type: 'card',
      });

      if (paymentMethods.data.length === 0) {
        return NextResponse.json(
          { error: 'No payment method on file. Please add a payment method in your subscription settings.' },
          { status: 400 }
        );
      }

      // Use the first payment method (or default if available)
      const paymentMethod = paymentMethods.data[0];

      // Create a payment intent to charge the customer
      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(reloadAmount * 100), // Convert to cents
        currency: 'usd',
        customer: user.stripe_id,
        payment_method: paymentMethod.id,
        description: `Auto-reload: ${creditsToAdd} credits for $${reloadAmount}`,
        metadata: {
          userId: effectiveUserId,
          type: 'auto_reload',
          credits: creditsToAdd.toString(),
        },
        confirm: true,
        return_url: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/settings`,
      });

      // If payment succeeded, update user credits
      if (paymentIntent.status === 'succeeded') {
        const newCredits = currentCredits + creditsToAdd;
        
        await pb.collection('users').update(effectiveUserId, {
          credits: newCredits,
        });

        console.log(`Auto-reload successful for user ${effectiveUserId}: Added ${creditsToAdd} credits (${currentCredits} -> ${newCredits})`);

        return NextResponse.json({
          success: true,
          message: `Successfully added ${creditsToAdd} credits`,
          creditsAdded: creditsToAdd,
          newTotalCredits: newCredits,
          amountCharged: reloadAmount,
        });
      } else if (paymentIntent.status === 'requires_action') {
        // Payment requires additional action (3D Secure, etc.)
        return NextResponse.json(
          { 
            error: 'Payment requires additional authentication',
            requiresAction: true,
            clientSecret: paymentIntent.client_secret 
          },
          { status: 400 }
        );
      } else {
        return NextResponse.json(
          { error: `Payment failed with status: ${paymentIntent.status}` },
          { status: 400 }
        );
      }
    } catch (stripeError) {
      console.error('Stripe payment error:', stripeError);
      
      // Handle specific Stripe errors
      if (stripeError instanceof Stripe.errors.StripeError) {
        return NextResponse.json(
          { error: `Payment failed: ${stripeError.message}` },
          { status: 400 }
        );
      }
      
      throw stripeError;
    }
  } catch (error) {
    console.error('Auto-reload error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to process auto-reload' },
      { status: 500 }
    );
  }
}

