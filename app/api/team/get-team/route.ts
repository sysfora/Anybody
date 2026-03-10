import { NextRequest, NextResponse } from 'next/server';
import pb from '@/lib/pocketbase';
import { Team, TeamMember } from '@/lib/types';

export async function POST(request: NextRequest) {
  try {
    const { userId } = await request.json();

    if (!userId) {
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 400 }
      );
    }

    // Authenticate as admin
    await pb.admins.authWithPassword(
      process.env.POCKETBASE_SUPERADMIN_EMAIL!,
      process.env.POCKETBASE_SUPERADMIN_PASSWORD!
    );

    // Find the user's team membership
    const memberRecords = await pb.collection('team_members').getFullList<TeamMember>({
      filter: `user="${userId}" && status="active"`,
      expand: 'team',
    });

    if (!memberRecords || memberRecords.length === 0) {
      return NextResponse.json(
        { team: null, members: [] },
        { status: 200 }
      );
    }

    const memberRecord = memberRecords[0];
    const teamId = typeof memberRecord.team === 'string' ? memberRecord.team : memberRecord.team;

    // Get all team members with user details
    const members = await pb.collection('team_members').getFullList<TeamMember>({
      filter: `team="${teamId}"`,
      expand: 'user',
      sort: '-created',
    });

    // Get team details
    const team = typeof memberRecord.expand?.team === 'string'
      ? await pb.collection('teams').getOne<Team>(memberRecord.expand.team)
      : memberRecord.expand?.team;

    return NextResponse.json({
      success: true,
      team,
      members,
    });
  } catch (error: unknown) {
    console.error('Error fetching team data:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch team data' },
      { status: 500 }
    );
  }
}

