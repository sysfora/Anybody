import { NextRequest, NextResponse } from 'next/server';
import pb from '@/lib/pocketbase';
import { checkAndProcessAutoReloadServer } from '@/lib/auto-reload-server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId } = body;

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

    const user = await pb.collection('users').getOne(userId);

    // Check and trigger auto-reload if needed (async, don't wait for it)
    if (user.auto_reload_enabled && user.stripe_id && (user.plan === 'pro' || user.plan === 'Pro')) {
      const currentCredits = user.credits || 0;
      const creditsUsed = user.credits_used || 0;
      const availableCredits = currentCredits - creditsUsed;
      const threshold = user.reload_threshold || 10;

      // Trigger auto-reload check in background if credits are below threshold
      if (availableCredits <= threshold) {
        // Don't await - let it run in background
        checkAndProcessAutoReloadServer(userId).catch(error => {
          console.error('Background auto-reload check failed:', error);
        });
      }
    }

    return NextResponse.json({
      id: user.id,
      name: user.name,
      username: user.username,
      email: user.email,
      avatar: user.avatar,
      verified: user.verified,
      credits: user.credits,
      credits_used: user.credits_used,
      auto_reload_enabled: user.auto_reload_enabled,
      reload_amount: user.reload_amount,
      reload_threshold: user.reload_threshold,
    });
  } catch (error: unknown) {
    console.error('Get profile error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch profile' },
      { status: 400 }
    );
  }
}

