import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import pb from '@/lib/pocketbase';
import { TeamMember, Team } from '@/lib/types';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-11-17.clover',
});

interface Project {
  id: string;
  name: string;
  user: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId } = body;

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

    // Get user details
    const user = await pb.collection('users').getOne(userId);
    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    const deletionResults = {
      stripe: { success: false, message: '' },
      projects: { success: false, message: '', deletedCount: 0 },
      teams: { success: false, message: '' },
      user: { success: false, message: '' },
    };

    // ============================================
    // 1. STRIPE: Cancel all subscriptions and delete customer
    // ============================================
    try {
      const stripeCustomerId = user.stripe_id;
      
      if (stripeCustomerId) {
        // Cancel all active subscriptions
        const subscriptions = await stripe.subscriptions.list({
          customer: stripeCustomerId,
          status: 'all',
        });

        for (const subscription of subscriptions.data) {
          if (subscription.status === 'active' || subscription.status === 'trialing') {
            await stripe.subscriptions.cancel(subscription.id);
            console.log(`Cancelled subscription: ${subscription.id}`);
          }
        }

        // Delete the Stripe customer
        await stripe.customers.del(stripeCustomerId);
        console.log(`Deleted Stripe customer: ${stripeCustomerId}`);
        
        deletionResults.stripe = { 
          success: true, 
          message: `Cancelled ${subscriptions.data.length} subscription(s) and deleted customer` 
        };
      } else {
        deletionResults.stripe = { 
          success: true, 
          message: 'No Stripe customer to delete' 
        };
      }
    } catch (stripeError) {
      console.error('Stripe deletion error:', stripeError);
      deletionResults.stripe = { 
        success: false, 
        message: stripeError instanceof Error ? stripeError.message : 'Failed to delete Stripe data' 
      };
      // Continue with other deletions even if Stripe fails
    }

    // ============================================
    // 2. PROJECTS: Delete all user's projects from database
    // ============================================
    try {
      // Get all projects for this user
      const projects = await pb.collection('projects').getFullList<Project>({
        filter: `user = "${userId}"`,
      });

      // Delete all projects
      for (const project of projects) {
        await pb.collection('projects').delete(project.id);
      }

      console.log(`Deleted ${projects.length} projects for user: ${userId}`);
      deletionResults.projects = { 
        success: true, 
        message: `Deleted ${projects.length} project(s)`,
        deletedCount: projects.length
      };
    } catch (projectError) {
      console.error('Projects deletion error:', projectError);
      deletionResults.projects = { 
        success: false, 
        message: projectError instanceof Error ? projectError.message : 'Failed to delete projects',
        deletedCount: 0
      };
      // Continue with other deletions
    }

    // ============================================
    // 4. TEAMS: Remove user from teams and delete owned teams
    // ============================================
    try {
      // 4a. Find teams where user is the OWNER and delete them
      const ownedTeams = await pb.collection('teams').getFullList<Team>({
        filter: `owner = "${userId}"`,
      });

      for (const team of ownedTeams) {
        // Delete all team members first
        const teamMembers = await pb.collection('team_members').getFullList<TeamMember>({
          filter: `team = "${team.id}"`,
        });
        
        for (const member of teamMembers) {
          await pb.collection('team_members').delete(member.id);
        }

        // Delete all team invitations
        try {
          const invitations = await pb.collection('team_invitations').getFullList({
            filter: `team = "${team.id}"`,
          });
          
          for (const invitation of invitations) {
            await pb.collection('team_invitations').delete(invitation.id);
          }
        } catch {
          // Team invitations collection might not exist or be empty
        }

        // Delete the team
        await pb.collection('teams').delete(team.id);
        console.log(`Deleted owned team: ${team.id}`);
      }

      // 4b. Find team memberships where user is a MEMBER and remove them
      const memberRecords = await pb.collection('team_members').getFullList<TeamMember>({
        filter: `user = "${userId}"`,
      });

      for (const membership of memberRecords) {
        await pb.collection('team_members').delete(membership.id);
        console.log(`Removed user from team membership: ${membership.id}`);
      }

      console.log(`Deleted ${ownedTeams.length} owned teams and ${memberRecords.length} memberships for user: ${userId}`);
      deletionResults.teams = { 
        success: true, 
        message: `Deleted ${ownedTeams.length} owned team(s) and removed ${memberRecords.length} membership(s)` 
      };
    } catch (teamError) {
      console.error('Teams deletion error:', teamError);
      deletionResults.teams = { 
        success: false, 
        message: teamError instanceof Error ? teamError.message : 'Failed to delete team data' 
      };
      // Continue with user deletion
    }

    // ============================================
    // 5. USER: Finally delete the user from PocketBase
    // ============================================
    try {
      await pb.collection('users').delete(userId);
      console.log(`Deleted user: ${userId}`);
      deletionResults.user = { 
        success: true, 
        message: 'User deleted successfully' 
      };
    } catch (userError) {
      console.error('User deletion error:', userError);
      deletionResults.user = { 
        success: false, 
        message: userError instanceof Error ? userError.message : 'Failed to delete user' 
      };
      
      // If we couldn't delete the user, this is a critical failure
      return NextResponse.json(
        { 
          error: 'Failed to delete user account',
          details: deletionResults
        },
        { status: 500 }
      );
    }

    // Check if all operations succeeded
    const allSuccessful = Object.values(deletionResults).every(result => result.success);

    return NextResponse.json({
      success: true,
      message: allSuccessful 
        ? 'Account and all associated data deleted successfully'
        : 'Account deleted with some warnings',
      details: deletionResults,
    });
  } catch (error: unknown) {
    console.error('Account deletion error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete account' },
      { status: 400 }
    );
  }
}
