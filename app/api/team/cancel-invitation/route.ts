import { NextRequest, NextResponse } from 'next/server';
import pb from '@/lib/pocketbase';

export async function POST(request: NextRequest) {
  try {
    const { invitationId } = await request.json();

    if (!invitationId) {
      return NextResponse.json(
        { error: 'Invitation ID is required' },
        { status: 400 }
      );
    }

    // Authenticate as admin
    await pb.admins.authWithPassword(
      process.env.POCKETBASE_SUPERADMIN_EMAIL!,
      process.env.POCKETBASE_SUPERADMIN_PASSWORD!
    );

    // Update invitation status to expired/cancelled
    await pb.collection('team_invitations').update(invitationId, { status: 'expired' });

    return NextResponse.json({
      success: true,
      message: 'Invitation cancelled successfully',
    });
  } catch (error: unknown) {
    console.error('Error cancelling invitation:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to cancel invitation' },
      { status: 500 }
    );
  }
}

