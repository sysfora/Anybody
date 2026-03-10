import { NextRequest, NextResponse } from 'next/server';
import pb from '@/lib/pocketbase';
import { TeamInvitation } from '@/lib/types';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const token = searchParams.get('token');

    if (!token) {
      return NextResponse.json(
        { error: 'Token is required' },
        { status: 400 }
      );
    }

    await pb.admins.authWithPassword(process.env.POCKETBASE_SUPERADMIN_EMAIL!, process.env.POCKETBASE_SUPERADMIN_PASSWORD!);

    const invitations = await pb.collection('team_invitations').getFullList<TeamInvitation>({
      filter: `token="${token}"`,
      expand: 'team,invited_by',
    });

    if (!invitations || invitations.length === 0) {
      return NextResponse.json(
        { error: 'Invitation not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      invitation: invitations[0],
    });
  } catch (error) {
    console.error('Error fetching invitation:', error);
    return NextResponse.json(
      { error: 'Failed to fetch invitation' },
      { status: 500 }
    );
  }
}

