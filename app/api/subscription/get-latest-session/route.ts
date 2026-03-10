import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import pb from '@/lib/pocketbase';

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

    // No team checks - allow all users to access subscription sessions
    const user = await pb.collection('users').getOne(userId);
    const userEmail = user.email;

    if (!userEmail) {
      return NextResponse.json(
        { error: 'User email not found' },
        { status: 400 }
      );
    }

    // Get the most recent checkout session for this user
    const sessions = await stripe.checkout.sessions.list({
      limit: 1,
      expand: ['data.customer', 'data.subscription'],
    });

    // Filter by email or customer ID
    let latestSession = null;
    for (const session of sessions.data) {
      if (session.customer_details?.email === userEmail) {
        latestSession = session;
        break;
      }
      if (user.stripe_id && session.customer === user.stripe_id) {
        latestSession = session;
        break;
      }
    }

    if (!latestSession) {
      return NextResponse.json(
        { error: 'No recent checkout session found' },
        { status: 404 }
      );
    }

    const customerId = typeof latestSession.customer === 'string' 
      ? latestSession.customer 
      : (latestSession.customer as Stripe.Customer | null)?.id || null;
    
    const subscriptionId = typeof latestSession.subscription === 'string' 
      ? latestSession.subscription 
      : (latestSession.subscription as Stripe.Subscription | null)?.id || null;

    return NextResponse.json({
      sessionId: latestSession.id,
      customerId,
      subscriptionId,
    });
  } catch (error) {
    console.error('Error getting latest session:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

