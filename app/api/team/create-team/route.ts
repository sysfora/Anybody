import { NextRequest, NextResponse } from 'next/server';
import pb from '@/lib/pocketbase';
import { Team, TeamMember } from '@/lib/types';

export async function POST(request: NextRequest) {
  try {
    const { userId, teamName } = await request.json();

    if (!userId || !teamName) {
      return NextResponse.json(
        { error: 'User ID and team name are required' },
        { status: 400 }
      );
    }

    // Authenticate as admin
    await pb.admins.authWithPassword(
      process.env.POCKETBASE_SUPERADMIN_EMAIL!,
      process.env.POCKETBASE_SUPERADMIN_PASSWORD!
    );

    // Create the team
    const team = await pb.collection('teams').create<Team>({
      name: teamName,
      owner: userId,
    });

    // Add user as team owner
    await pb.collection('team_members').create<TeamMember>({
      team: team.id,
      user: userId,
      role: 'owner',
      status: 'active',
    });

    return NextResponse.json({
      success: true,
      team,
    });
  } catch (error: unknown) {
    console.error('Error creating team:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create team' },
      { status: 500 }
    );
  }
}

