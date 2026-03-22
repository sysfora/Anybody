import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { headers } from "next/headers";
import pb from "@/lib/pocketbase";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2025-11-17.clover",
});

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

async function cancelOtherSubscriptions(customerId: string, keepSubscriptionId: string) {
  try {
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: 'all',
      limit: 100,
    });

    for (const sub of subscriptions.data) {
      // Skip the subscription we want to keep
      if (sub.id === keepSubscriptionId) {
        continue;
      }

      // Cancel any active or trialing subscriptions
      if (sub.status === 'active' || sub.status === 'trialing' || sub.status === 'past_due') {
        try {
          await stripe.subscriptions.cancel(sub.id);
          console.log(`Cancelled existing subscription: ${sub.id} (keeping ${keepSubscriptionId})`);
        } catch (error) {
          console.error(`Error cancelling subscription ${sub.id}:`, error);
        }
      }
    }
  } catch (error) {
    console.error('Error cancelling other subscriptions:', error);
  }
}

interface PocketBaseUser {
  id: string;
  email?: string;
  plan?: string;
  stripe_id?: string;
  credits?: number;
  credits_used?: number;
  [key: string]: unknown;
}

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
    if (!pb.authStore.isValid || !pb.authStore.isAdmin) {
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

async function updateProUserCredits(userId: string, isFirstTime: boolean = false) {
  try {
    await ensureAdminAuth();

    try {
      // Pro plan: 1000 credits per month, credits_used reset to 0 on every
      // upgrade and on every monthly renewal.
      await pb.collection('users').update(userId, {
        credits: 1000,
        credits_used: 0,
      });

      console.log(
        `Reset credits for user ${userId}: 1000 credits, 0 used (${isFirstTime ? 'first time pro' : 'monthly renewal'})`,
      );
    } catch (error: unknown) {
      const pbError = error as PocketBaseError;
      if (pbError?.status === 404) {
        console.warn(`User ${userId} not found when trying to update credits`);
      } else {
        throw error;
      }
    }
  } catch (error) {
    console.error(`Error updating credits for user ${userId}:`, error);
  }
}

async function updateUserSubscription(customerId: string, plan: 'pro' | 'free', email?: string | null, userId?: string | null) {
  try {
    await ensureAdminAuth();

    // No team checks - webhook processes subscription updates directly from Stripe
    let user: PocketBaseUser | null = null;

    // Try to find user by stripe_id first
    if (customerId) {
      try {
        const users = await pb.collection('users').getList(1, 1, {
          filter: `stripe_id = "${customerId}"`,
        });
        if (users.items.length > 0) {
          user = users.items[0];
        }
      } catch (error) {
        console.warn(`Error searching by stripe_id ${customerId}:`, error);
      }
    }

    // If not found and userId is provided, find by userId
    if (!user && userId) {
      try {
        user = await pb.collection('users').getOne(userId) as PocketBaseUser;
      } catch (error: unknown) {
        const pbError = error as PocketBaseError;
        if (pbError?.status === 404) {
          console.warn(`User not found with userId: ${userId}`);
        } else {
          console.warn(`Error fetching user by userId ${userId}:`, error);
        }
      }
    }

    // If still not found and email is provided, find by email
    if (!user && email) {
      try {
        const users = await pb.collection('users').getList(1, 1, {
          filter: `email = "${email}"`,
        });
        if (users.items.length > 0) {
          user = users.items[0];
        }
      } catch (error) {
        console.warn(`Error searching by email ${email}:`, error);
      }
    }

    if (user) {
      const wasPro = user.plan === 'pro' || user.plan === 'Pro';
      const isNowPro = plan === 'pro';
      const isFirstTimePro = !wasPro && isNowPro;
      
      try {
        await pb.collection('users').update(user.id, {
          plan: plan,
          stripe_id: customerId,
        });
        console.log(`Updated user ${user.id} to plan: ${plan}`);
        
        // Update credits for Pro users
        if (isNowPro) {
          await updateProUserCredits(user.id, isFirstTimePro);
        }
      } catch (error: unknown) {
        const pbError = error as PocketBaseError;
        if (pbError?.status === 404) {
          console.error(`User ${user.id} was found but then not found when updating (may have been deleted)`);
        } else {
          throw error;
        }
      }
    } else {
      console.warn(`User not found for customer: ${customerId}, email: ${email}, userId: ${userId}`);
    }
  } catch (error) {
    console.error("Error updating user subscription:", error);
    // Don't throw - log and continue to avoid breaking webhook processing
  }
}

// Disable body parsing to get raw body for Stripe signature verification
export const runtime = 'nodejs';
// Ensure we don't parse the body as JSON
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    // Read the body as a raw Buffer — this is byte-perfect and avoids the
    // string-encoding inconsistencies that cause "No signatures found" errors
    // when using req.text() with certain Next.js App Router versions.
    const rawBody = Buffer.from(await req.arrayBuffer());

    const headersList = await headers();
    const signature = headersList.get("stripe-signature");

    if (!signature) {
      console.error("Missing stripe-signature header");
      return NextResponse.json(
        { error: "Missing signature" },
        { status: 400 }
      );
    }

    if (!webhookSecret) {
      console.error("Missing STRIPE_WEBHOOK_SECRET environment variable");
      return NextResponse.json(
        { error: "Webhook secret not configured" },
        { status: 500 }
      );
    }

    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    } catch (err) {
      console.error("Webhook signature verification failed:", err);
      return NextResponse.json(
        { error: "Invalid signature" },
        { status: 400 }
      );
    }

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        console.log("Checkout session completed:", session.id);
        
        const customerId = session.customer && typeof session.customer === 'string' 
          ? session.customer 
          : undefined;
        const customerEmail = session.customer_details?.email;
        const userId = session.metadata?.userId ? String(session.metadata.userId) : undefined;

        if (customerId && session.subscription) {
          const subscriptionId = typeof session.subscription === 'string' 
            ? session.subscription 
            : (session.subscription as Stripe.Subscription).id;
          
          // Cancel other subscriptions before updating user
          if (subscriptionId) {
            await cancelOtherSubscriptions(customerId, subscriptionId);
          }
          
          await updateUserSubscription(customerId, 'pro', customerEmail, userId);
        }
        break;
      }

      case "customer.subscription.created": {
        const subscription = event.data.object as Stripe.Subscription;
        console.log("Subscription created:", subscription.id);
        
        if (subscription.customer && typeof subscription.customer === 'string') {
          const isActive = subscription.status === 'active' || subscription.status === 'trialing';
          
          // Cancel other subscriptions for this customer
          await cancelOtherSubscriptions(subscription.customer, subscription.id);
          
          // Get customer email if available
          let customerEmail: string | undefined;
          try {
            const customer = await stripe.customers.retrieve(subscription.customer);
            if (customer && !customer.deleted && typeof customer === 'object' && 'email' in customer) {
              customerEmail = customer.email || undefined;
            }
          } catch (error) {
            console.warn("Could not retrieve customer email:", error);
          }
          
          await updateUserSubscription(subscription.customer, isActive ? 'pro' : 'free', customerEmail);
        }
        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        console.log("Subscription updated:", subscription.id);
        
        if (subscription.customer && typeof subscription.customer === 'string') {
          const isActive = subscription.status === 'active' || subscription.status === 'trialing';
          
          // Get customer email if available
          let customerEmail: string | undefined;
          try {
            const customer = await stripe.customers.retrieve(subscription.customer);
            if (customer && !customer.deleted && typeof customer === 'object' && 'email' in customer) {
              customerEmail = customer.email || undefined;
            }
          } catch (error) {
            console.warn("Could not retrieve customer email:", error);
          }
          
          await updateUserSubscription(subscription.customer, isActive ? 'pro' : 'free', customerEmail);
        }
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        console.log("Subscription cancelled:", subscription.id);
        
        if (subscription.customer && typeof subscription.customer === 'string') {
          // Get customer email if available
          let customerEmail: string | undefined;
          try {
            const customer = await stripe.customers.retrieve(subscription.customer);
            if (customer && !customer.deleted && typeof customer === 'object' && 'email' in customer) {
              customerEmail = customer.email || undefined;
            }
          } catch (error) {
            console.warn("Could not retrieve customer email:", error);
          }
          
          await updateUserSubscription(subscription.customer, 'free', customerEmail);
        }
        break;
      }

      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;
        console.log("Invoice paid:", invoice.id);
        
        // Invoice subscription can be a string ID or null (TypeScript doesn't expose this in the type)
        const subscriptionId = (invoice as Stripe.Invoice & { subscription?: string | null }).subscription;
        
        if (invoice.customer && typeof invoice.customer === 'string' && subscriptionId) {
          // Get customer email if available
          let customerEmail: string | undefined;
          let userId: string | undefined;
          try {
            const customer = await stripe.customers.retrieve(invoice.customer);
            if (customer && !customer.deleted && typeof customer === 'object' && 'email' in customer) {
              customerEmail = customer.email || undefined;
              // Try to get userId from customer metadata
              if ('metadata' in customer && customer.metadata && typeof customer.metadata === 'object') {
                userId = (customer.metadata as { userId?: string }).userId;
              }
            }
          } catch (error) {
            console.warn("Could not retrieve customer email:", error);
          }
          
          // Ensure subscription is active after successful payment
          await updateUserSubscription(invoice.customer, 'pro', customerEmail, userId);
          
          // Update credits monthly on successful payment (monthly renewal)
          if (userId) {
            await updateProUserCredits(userId, false);
          } else if (customerEmail) {
            // Try to find user by email to update credits
            try {
              await ensureAdminAuth();
              const users = await pb.collection('users').getList(1, 1, {
                filter: `email = "${customerEmail}"`,
              });
              if (users.items.length > 0) {
                await updateProUserCredits(users.items[0].id, false);
              }
            } catch (error) {
              console.warn("Could not update credits for monthly renewal:", error);
            }
          }
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        console.error("Invoice payment failed:", invoice.id);
        break;
      }

      case "payment_intent.succeeded": {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        
        // Handle auto-reload payments
        if (paymentIntent.metadata?.type === 'auto_reload' && paymentIntent.metadata?.userId) {
          const userId = paymentIntent.metadata.userId;
          const creditsToAdd = parseInt(paymentIntent.metadata.credits || '0', 10);
          
          if (creditsToAdd > 0) {
            try {
              await ensureAdminAuth();
              
              try {
                const user = await pb.collection('users').getOne(userId) as PocketBaseUser;
                const currentCredits = user.credits || 0;
                const newCredits = currentCredits + creditsToAdd;
                
                await pb.collection('users').update(userId, {
                  credits: newCredits,
                });
                
                console.log(`Auto-reload via webhook for user ${userId}: Added ${creditsToAdd} credits (${currentCredits} -> ${newCredits})`);
              } catch (error: unknown) {
                const pbError = error as PocketBaseError;
                if (pbError?.status === 404) {
                  console.warn(`User ${userId} not found when trying to update credits via auto-reload`);
                } else {
                  throw error;
                }
              }
            } catch (error) {
              console.error(`Error updating credits via webhook for user ${userId}:`, error);
            }
          }
        }
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Webhook error:", error);
    return NextResponse.json(
      { error: "Webhook handler failed" },
      { status: 500 }
    );
  }
}

