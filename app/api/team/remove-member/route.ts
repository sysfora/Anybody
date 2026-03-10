import { NextRequest, NextResponse } from 'next/server';
import pb from '@/lib/pocketbase';
import { TeamMember } from '@/lib/types';

export async function POST(request: NextRequest) {
  try {
    const { memberId } = await request.json();

    if (!memberId) {
      return NextResponse.json(
        { error: 'Member ID is required' },
        { status: 400 }
      );
    }

    // Authenticate as admin
    await pb.admins.authWithPassword(
      process.env.POCKETBASE_SUPERADMIN_EMAIL!,
      process.env.POCKETBASE_SUPERADMIN_PASSWORD!
    );

    // Get member details to check if they're the owner
    const member = await pb.collection('team_members').getOne<TeamMember>(memberId);
    
    if (member.role === 'owner') {
      return NextResponse.json(
        { error: 'Cannot remove the team owner' },
        { status: 403 }
      );
    }

    // Delete the member
    await pb.collection('team_members').delete(memberId);

    return NextResponse.json({
      success: true,
      message: 'Member removed successfully',
    });
  } catch (error: unknown) {
    console.error('Error removing member:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to remove member' },
      { status: 500 }
    );
  }
}

