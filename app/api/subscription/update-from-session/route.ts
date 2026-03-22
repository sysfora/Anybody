import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import pb from '@/lib/pocketbase';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-11-17.clover',
});

interface PocketBaseError extends Error {
  status?: number;
  response?: {
    code?: number;
    message?: string;
    data?: unknown;
  };
}

async function ensureAdminAuth() {
  try {
    // Check if already authenticated
    if (!pb.authStore.isValid || !pb.authStore.isSuperuser) {
      await pb.admins.authWithPassword(
        process.env.POCKETBASE_SUPERADMIN_EMAIL!,
        process.env.POCKETBASE_SUPERADMIN_PASSWORD!
      );
    }
  } catch (error) {
    console.error("Error authenticating admin:", error);
    throw error;
  }
}

export async function POST(request: NextRequest) {
  try {
    const { sessionId, userId } = await request.json();

    if (!sessionId || !userId) {
      return NextResponse.json(
        { error: 'Session ID and User ID are required' },
        { status: 400 }
      );
    }

    // Authenticate admin before any PocketBase operations
    await ensureAdminAuth();

    // Use userId directly - no team checks needed for subscription updates
    const effectiveUserId = userId;

    // Retrieve the checkout session
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['subscription', 'customer'],
    });

    // Handle customer - it can be a string ID or a Customer object
    let customerId: string | null = null;
    if (typeof session.customer === 'string') {
      customerId = session.customer;
    } else if (session.customer && typeof session.customer === 'object' && 'id' in session.customer) {
      customerId = (session.customer as Stripe.Customer).id;
    } else if (session.customer_details?.email) {
      // If customer is not set but we have email, try to find or create customer
      try {
        const customers = await stripe.customers.list({
          email: session.customer_details.email,
          limit: 1,
        });
        if (customers.data.length > 0) {
          customerId = customers.data[0].id;
        } else {
          // Create customer if not found
          const customer = await stripe.customers.create({
            email: session.customer_details.email,
            metadata: { userId: effectiveUserId },
          });
          customerId = customer.id;
        }
      } catch (error) {
        console.error('Error finding/creating customer:', error);
      }
    }

    // If still no customer ID, try to get it from the subscription
    if (!customerId && session.subscription) {
      try {
        const subscription = typeof session.subscription === 'string'
          ? await stripe.subscriptions.retrieve(session.subscription)
          : session.subscription;
        
        if (subscription.customer && typeof subscription.customer === 'string') {
          customerId = subscription.customer;
        }
      } catch (error) {
        console.warn('Could not get customer from subscription:', error);
      }
    }

    if (!customerId) {
      return NextResponse.json(
        { error: 'Could not determine customer ID from session. The webhook will handle the update.' },
        { status: 400 }
      );
    }

    // Get subscription details
    let subscriptionId: string | null = null;
    let billingCycle: 'monthly' | 'yearly' | null = null;

    if (session.subscription) {
      try {
        const subscription = typeof session.subscription === 'string'
          ? await stripe.subscriptions.retrieve(session.subscription)
          : session.subscription;

        subscriptionId = subscription.id;
        const priceId = subscription.items.data[0]?.price.id;
        
        const isMonthly = priceId === process.env.NEXT_PUBLIC_STRIPE_MONTHLY_PRICE_ID;
        const isYearly = priceId === process.env.NEXT_PUBLIC_STRIPE_YEARLY_PRICE_ID;
        
        billingCycle = isYearly ? 'yearly' : isMonthly ? 'monthly' : null;
      } catch (error) {
        console.warn('Could not retrieve subscription details:', error);
        // Continue without subscription details - webhook will handle it
      }
    }

    // Cancel all existing subscriptions for this customer except the new one
    if (customerId && subscriptionId) {
      try {
        const subscriptions = await stripe.subscriptions.list({
          customer: customerId,
          status: 'all',
          limit: 100,
        });

        for (const sub of subscriptions.data) {
          // Skip the new subscription
          if (sub.id === subscriptionId) {
            continue;
          }

          // Cancel any active or trialing subscriptions
          if (sub.status === 'active' || sub.status === 'trialing' || sub.status === 'past_due') {
            try {
              await stripe.subscriptions.cancel(sub.id);
              console.log(`Cancelled existing subscription: ${sub.id}`);
            } catch (error) {
              console.error(`Error cancelling subscription ${sub.id}:`, error);
            }
          }
        }
      } catch (error) {
        console.error('Error cancelling existing subscriptions:', error);
        // Continue even if cancellation fails
      }
    }

    // Update user in PocketBase
    try {
      // Ensure admin is authenticated before user operations
      await ensureAdminAuth();
      
      // Check if user was already on Pro plan
      let currentUser;
      try {
        currentUser = await pb.collection('users').getOne(effectiveUserId);
      } catch (error: unknown) {
        const pbError = error as PocketBaseError;
        if (pbError?.status === 404) {
          console.error(`User ${effectiveUserId} not found in PocketBase`);
          return NextResponse.json(
            { error: 'User not found' },
            { status: 404 }
          );
        }
        throw error;
      }
      
      const wasPro = currentUser.plan === 'pro' || currentUser.plan === 'Pro';
      const isFirstTimePro = !wasPro;
      
      const updateData: { stripe_id: string; plan: string; credits?: number } = {
        stripe_id: customerId,
        plan: 'pro',
      };

      // If first time Pro subscription, set credits to 1000
      if (isFirstTimePro) {
        updateData.credits = 1000;
      }

      await pb.collection('users').update(effectiveUserId, updateData);

      return NextResponse.json({
        success: true,
        customerId,
        subscriptionId,
        billingCycle,
      });
    } catch (pbError: unknown) {
      console.error('Error updating user in PocketBase:', pbError);
      
      // If user not found or other error, return error but don't fail completely
      const error = pbError as PocketBaseError;
      if (error?.status === 404) {
        return NextResponse.json(
          { error: 'User not found' },
          { status: 404 }
        );
      }
      
      throw pbError;
    }
  } catch (error) {
    console.error('Error updating subscription from session:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

