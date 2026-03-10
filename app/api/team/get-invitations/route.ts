import { NextRequest, NextResponse } from 'next/server';
import pb from '@/lib/pocketbase';
import { TeamInvitation } from '@/lib/types';

export async function POST(request: NextRequest) {
  try {
    const { teamId } = await request.json();

    if (!teamId) {
      return NextResponse.json(
        { error: 'Team ID is required' },
        { status: 400 }
      );
    }

    // Authenticate as admin
    await pb.admins.authWithPassword(
      process.env.POCKETBASE_SUPERADMIN_EMAIL!,
      process.env.POCKETBASE_SUPERADMIN_PASSWORD!
    );

    // Get all pending invitations with invited_by user details
    const invitations = await pb.collection('team_invitations').getFullList<TeamInvitation>({
      filter: `team="${teamId}" && status="pending"`,
      expand: 'invited_by',
      sort: '-created',
    });

    return NextResponse.json({
      success: true,
      invitations,
    });
  } catch (error: unknown) {
    console.error('Error fetching invitations:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch invitations' },
      { status: 500 }
    );
  }
}

