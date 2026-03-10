import { NextRequest, NextResponse } from 'next/server';
import pb from '@/lib/pocketbase';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, username } = body;

    if (!userId || !username) {
      return NextResponse.json(
        { error: 'User ID and username are required' },
        { status: 400 }
      );
    }

    // Authenticate as admin server-side
    await pb.admins.authWithPassword(
      process.env.POCKETBASE_SUPERADMIN_EMAIL!,
      process.env.POCKETBASE_SUPERADMIN_PASSWORD!
    );

    // Update user with username
    const updatedUser = await pb.collection('users').update(userId, { username, credits: 50 });

    return NextResponse.json({
      success: true,
      user: {
        id: updatedUser.id,
        name: updatedUser.name,
        username: updatedUser.username,
        email: updatedUser.email,
        avatar: updatedUser.avatar,
        verified: updatedUser.verified,
      },
    });
  } catch (error: unknown) {
    console.error('Username update error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update username' },
      { status: 500 }
    );
  }
}
