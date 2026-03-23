import { NextResponse } from 'next/server';
import pb from '@/lib/pocketbase';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-11-17.clover',
});

interface Project {
  id: string;
  name: string;
  user: string;
  created: string;
  expire?: string | null;
}

interface User {
  id: string;
  stripe_id?: string | null;
}

async function hasActiveProSubscription(stripeCustomerId: string | null): Promise<boolean> {
  if (!stripeCustomerId) {
    return false;
  }

  try {
    const subscriptions = await stripe.subscriptions.list({
      customer: stripeCustomerId,
      status: 'all',
      limit: 1,
    });

    if (subscriptions.data.length === 0) {
      return false;
    }

    const subscription = subscriptions.data[0];
    return subscription.status === 'active' || subscription.status === 'trialing';
  } catch (error) {
    console.error('Error checking subscription status:', error);
    return false;
  }
}

/**
 * Cleanup expired projects (PocketBase only).
 * 1. Projects with expire in the past
 * 2. If user is Pro: clear expire on the record
 * 3. If Free: delete the project record
 */
export async function POST() {
  return NextResponse.json({
    success: true,
    message: 'Project expiration and cleanup functionality has been disabled.',
  });
}
