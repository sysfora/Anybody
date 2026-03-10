import pb from './pocketbase';
import { TeamMember, Team } from './types';

/**
 * Get the effective user ID for API operations.
 * If the user is a team member, returns the team owner's ID.
 * Otherwise, returns the user's own ID.
 * 
 * @param userId - The user's ID
 * @returns The effective user ID (owner ID if team member, otherwise user's own ID)
 */
export async function getEffectiveUserId(userId: string): Promise<string> {
  try {
    // Authenticate as admin to query team_members
    await pb.admins.authWithPassword(
      process.env.POCKETBASE_SUPERADMIN_EMAIL!,
      process.env.POCKETBASE_SUPERADMIN_PASSWORD!
    );

    // Check if user is a team member
    const memberRecords = await pb.collection('team_members').getFullList<TeamMember>({
      filter: `user="${userId}" && status="active"`,
      expand: 'team',
    });

    if (!memberRecords || memberRecords.length === 0) {
      // User is not a team member, return their own ID
      return userId;
    }

    // User is a team member, get the team owner ID
    const memberRecord = memberRecords[0];
    const team = typeof memberRecord.expand?.team === 'string'
      ? await pb.collection('teams').getOne<Team>(memberRecord.expand.team)
      : memberRecord.expand?.team;

    if (!team) {
      // Team not found, return user's own ID
      return userId;
    }

    // Return the team owner's ID
    return team.owner;
  } catch (error) {
    console.error('Error getting effective user ID:', error);
    // On error, return user's own ID as fallback
    return userId;
  }
}

/**
 * Check if a user is a team member.
 * 
 * @param userId - The user's ID
 * @returns true if the user is a team member, false otherwise
 */
export async function isTeamMember(userId: string): Promise<boolean> {
  try {
    // Authenticate as admin to query team_members
    await pb.admins.authWithPassword(
      process.env.POCKETBASE_SUPERADMIN_EMAIL!,
      process.env.POCKETBASE_SUPERADMIN_PASSWORD!
    );

    // Check if user is a team member
    const memberRecords = await pb.collection('team_members').getFullList<TeamMember>({
      filter: `user="${userId}" && status="active"`,
    });

    return memberRecords && memberRecords.length > 0;
  } catch (error) {
    console.error('Error checking if user is team member:', error);
    // On error, assume not a team member
    return false;
  }
}

