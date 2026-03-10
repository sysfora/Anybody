import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2025-11-17.clover",
});

import pb from "@/lib/pocketbase";

export async function POST(req: NextRequest) {
  try {
    const { priceId, email, userId } = await req.json();

    if (!priceId) {
      return NextResponse.json(
        { error: "Price ID is required" },
        { status: 400 }
      );
    }

    let customerId: string | undefined;

    // If userId is provided, check if user already has a Stripe customer ID
    if (userId) {
      try {
        await pb.admins.authWithPassword(
          process.env.POCKETBASE_SUPERADMIN_EMAIL!,
          process.env.POCKETBASE_SUPERADMIN_PASSWORD!
        );

        // No team checks - allow all users to create subscriptions
        const user = await pb.collection('users').getOne(userId);
        if (user.stripe_id) {
          customerId = user.stripe_id;
        }
      } catch (error) {
        console.error("Error fetching user:", error);
      }
    }

    // Create or retrieve customer
    if (!customerId && email) {
      const customers = await stripe.customers.list({
        email: email,
        limit: 1,
      });

      if (customers.data.length > 0) {
        customerId = customers.data[0].id;
      } else {
        const customer = await stripe.customers.create({
          email: email,
          metadata: userId ? { userId } : {},
        });
        customerId = customer.id;
      }
    }

    const sessionConfig: Stripe.Checkout.SessionCreateParams = {
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/subscription-success?session_id={CHECKOUT_SESSION_ID}&success=true`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/subscription`,
      metadata: {
        priceId,
        ...(userId ? { userId } : {}),
      },
    };

    if (customerId) {
      sessionConfig.customer = customerId;
    } else if (email) {
      sessionConfig.customer_email = email;
    }

    const session = await stripe.checkout.sessions.create(sessionConfig);

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error("Error creating checkout session:", error);
    return NextResponse.json(
      { error: "Failed to create checkout session" },
      { status: 500 }
    );
  }
}

