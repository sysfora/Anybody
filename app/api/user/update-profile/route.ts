import { NextRequest, NextResponse } from 'next/server';
import pb from '@/lib/pocketbase';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();

    const userId = formData.get('userId') as string;
    const name = formData.get('name') as string;
    const username = formData.get('username') as string;
    const avatar = formData.get('avatar') as File | null;

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

    const updateData: Record<string, string | File> = {};

    if (name) updateData.name = name;
    if (username) updateData.username = username;
    if (avatar && avatar.size > 0) updateData.avatar = avatar;

    const updatedUser = await pb.collection('users').update(userId, updateData);

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
    console.error('Profile update error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update profile' },
      { status: 400 }
    );
  }
}

