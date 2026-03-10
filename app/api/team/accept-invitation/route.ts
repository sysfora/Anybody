import { NextRequest, NextResponse } from 'next/server';
import pb from '@/lib/pocketbase';
import { TeamInvitation, TeamMember } from '@/lib/types';

export async function POST(request: NextRequest) {
  try {
    const { token, userId, userEmail } = await request.json();

    if (!token || !userId || !userEmail) {
      return NextResponse.json(
        { error: 'Token, userId, and userEmail are required' },
        { status: 400 }
      );
    }

    // Authenticate as admin
    await pb.admins.authWithPassword(
      process.env.POCKETBASE_SUPERADMIN_EMAIL!,
      process.env.POCKETBASE_SUPERADMIN_PASSWORD!
    );

    // Fetch the invitation by token
    const invitations = await pb.collection('team_invitations').getFullList<TeamInvitation>({
      filter: `token="${token}"`,
    });

    if (!invitations || invitations.length === 0) {
      return NextResponse.json(
        { error: 'Invalid or expired invitation' },
        { status: 404 }
      );
    }

    const invitation = invitations[0];

    // Verify email matches
    if (invitation.email.toLowerCase() !== userEmail.toLowerCase()) {
      return NextResponse.json(
        { error: 'This invitation is for a different email address' },
        { status: 403 }
      );
    }

    // Check if user is already a member of this team
    const existingMembers = await pb.collection('team_members').getList<TeamMember>(1, 1, {
      filter: `team="${invitation.team}" && user="${userId}"`,
    });

    if (existingMembers.items.length > 0) {
      return NextResponse.json(
        { error: 'You are already a member of this team' },
        { status: 400 }
      );
    }

    // Check if user owns a team and delete it before joining the new team
    const ownedTeams = await pb.collection('team_members').getFullList<TeamMember>({
      filter: `user="${userId}" && role="owner"`,
    });

    // Delete user's own team(s) if they exist
    for (const ownedTeam of ownedTeams) {
      const teamId = typeof ownedTeam.team === 'string' ? ownedTeam.team : ownedTeam.team;
      
      // Delete the team (cascade delete will handle team_members and team_invitations)
      await pb.collection('teams').delete(teamId);
    }

    // Create team member
    await pb.collection('team_members').create<TeamMember>({
      team: invitation.team,
      user: userId,
      role: 'member',
      status: 'active',
    });

    // Update invitation status
    await pb.collection('team_invitations').update(invitation.id, { status: 'accepted' });

    await pb.collection('users').update(userId, { verified: true });

    return NextResponse.json({
      success: true,
      message: 'Invitation accepted successfully',
    });
  } catch (error: unknown) {
    console.error('Error accepting invitation:', error);

    // Handle specific PocketBase errors
    if (error && typeof error === 'object' && 'status' in error && error.status === 400 && 'data' in error) {
      const pbError = error as { data?: { data?: { team?: string; user?: string } } };
      const errorData = pbError.data?.data;
      if (errorData?.team || errorData?.user) {
        return NextResponse.json(
          { error: 'You are already a member of this team' },
          { status: 400 }
        );
      }
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to accept invitation' },
      { status: 500 }
    );
  }
}

