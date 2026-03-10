import Stripe from 'stripe';
import pb from '@/lib/pocketbase';

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
 * Server-side function to check and process auto-reload
 * This can be called directly from API routes without HTTP calls
 */
export async function checkAndProcessAutoReloadServer(userId: string): Promise<{ success: boolean; message?: string; error?: string }> {
  try {
    await pb.admins.authWithPassword(
      process.env.POCKETBASE_SUPERADMIN_EMAIL!,
      process.env.POCKETBASE_SUPERADMIN_PASSWORD!
    );

    const user = await pb.collection('users').getOne(userId) as PocketBaseUser;

    // Check if auto-reload is enabled
    if (!user.auto_reload_enabled) {
      return { success: false, message: 'Auto-reload is not enabled' };
    }

    // Check if user has Stripe customer ID
    if (!user.stripe_id) {
      return { success: false, error: 'No payment method on file' };
    }

    // Check if user is on Pro plan
    if (user.plan !== 'pro' && user.plan !== 'Pro') {
      return { success: false, error: 'Auto-reload is only available for Pro plan users' };
    }

    const currentCredits = user.credits || 0;
    const creditsUsed = user.credits_used || 0;
    const availableCredits = currentCredits - creditsUsed;
    const threshold = user.reload_threshold || 10;
    const reloadAmount = user.reload_amount || 10;

    // Check if credits are below threshold
    if (availableCredits > threshold) {
      return { success: false, message: 'Credits are above threshold' };
    }

    // Calculate credits to add: $10 = 500 credits
    const creditsToAdd = Math.floor((reloadAmount / 10) * 500);

    // Get customer's payment methods
    const paymentMethods = await stripe.paymentMethods.list({
      customer: user.stripe_id,
      type: 'card',
    });

    if (paymentMethods.data.length === 0) {
      return { success: false, error: 'No payment method on file' };
    }

    // Use the first payment method
    const paymentMethod = paymentMethods.data[0];

    // Create and confirm payment intent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(reloadAmount * 100),
      currency: 'usd',
      customer: user.stripe_id,
      payment_method: paymentMethod.id,
      description: `Auto-reload: ${creditsToAdd} credits for $${reloadAmount}`,
      metadata: {
        userId: userId,
        type: 'auto_reload',
        credits: creditsToAdd.toString(),
      },
      confirm: true,
      return_url: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/settings`,
    });

    // If payment succeeded, update credits
    if (paymentIntent.status === 'succeeded') {
      const newCredits = currentCredits + creditsToAdd;
      
      await pb.collection('users').update(userId, {
        credits: newCredits,
      });

      console.log(`Auto-reload successful for user ${userId}: Added ${creditsToAdd} credits (${currentCredits} -> ${newCredits})`);

      return {
        success: true,
        message: `Successfully added ${creditsToAdd} credits`,
      };
    }

    return { success: false, error: `Payment status: ${paymentIntent.status}` };
  } catch (error) {
    console.error('Auto-reload server error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to process auto-reload',
    };
  }
}

