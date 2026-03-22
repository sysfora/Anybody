import { NextRequest, NextResponse } from 'next/server';
import pb from '@/lib/pocketbase';
import Stripe from 'stripe';
import { getEffectiveUserId } from '@/lib/server-utils';
import { escapePbFilterString } from '@/lib/session-user';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-11-17.clover',
});

export async function POST(request: NextRequest) {
  try {
    const { username, userId: providedUserId, projectName } = await request.json();

    if (!projectName) {
      return NextResponse.json({ error: 'Project name is required' }, { status: 400 });
    }

    if (!username && !providedUserId) {
      return NextResponse.json({ error: 'Username or userId is required' }, { status: 400 });
    }

    await pb.admins.authWithPassword(
      process.env.POCKETBASE_SUPERADMIN_EMAIL!,
      process.env.POCKETBASE_SUPERADMIN_PASSWORD!,
    );

    let userId: string;
    if (providedUserId) {
      try {
        await pb.collection('users').getOne(providedUserId);
        userId = providedUserId;
      } catch {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
      }
    } else {
      const safeUser = escapePbFilterString(username);
      const users = await pb.collection('users').getList(1, 1, {
        filter: `username = "${safeUser}"`,
      });

      if (users.items.length === 0) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
      }

      userId = users.items[0].id;
    }

    const effectiveUserId = await getEffectiveUserId(userId);
    const user = await pb.collection('users').getOne(effectiveUserId);
    const stripeCustomerId = user.stripe_id;

    if (!stripeCustomerId) {
      return NextResponse.json(
        { error: 'Subscription required to download projects' },
        { status: 403 },
      );
    }

    const subscriptions = await stripe.subscriptions.list({
      customer: stripeCustomerId,
      status: 'all',
      limit: 1,
    });

    if (subscriptions.data.length === 0) {
      return NextResponse.json(
        { error: 'Subscription required to download projects' },
        { status: 403 },
      );
    }

    const subscription = subscriptions.data[0];
    const isActive =
      subscription.status === 'active' || subscription.status === 'trialing';

    if (!isActive) {
      return NextResponse.json(
        { error: 'Active subscription required to download projects' },
        { status: 403 },
      );
    }

    const safeName = escapePbFilterString(projectName);
    const projects = await pb.collection('projects').getList(1, 1, {
      filter: `user = "${escapePbFilterString(effectiveUserId)}" && name = "${safeName}"`,
    });

    if (projects.items.length === 0) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const row = projects.items[0] as unknown as { html?: string };
    const html = typeof row.html === 'string' ? row.html : '';

    if (!html.trim()) {
      return NextResponse.json(
        { error: 'No saved HTML for this project yet' },
        { status: 404 },
      );
    }

    const safeFile = `${String(projectName).replace(/[^\w\-+.]+/g, '_')}.html`;
    const htmlBytes = Buffer.from(html, 'utf-8');

    return new NextResponse(htmlBytes as unknown as BodyInit, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `attachment; filename="${safeFile}"`,
        'Content-Length': htmlBytes.length.toString(),
      },
    });
  } catch (error) {
    console.error('Error creating download:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
