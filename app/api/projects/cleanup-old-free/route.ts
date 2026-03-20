import { NextResponse } from 'next/server';
import pb from '@/lib/pocketbase';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-11-17.clover',
});

interface Project {
  id: string;
  name: string;
  user: string;
  created: string;
  expire?: string | null;
}

interface User {
  id: string;
  stripe_id?: string | null;
}

async function hasActiveProSubscription(stripeCustomerId: string | null): Promise<boolean> {
  if (!stripeCustomerId) {
    return false;
  }

  try {
    const subscriptions = await stripe.subscriptions.list({
      customer: stripeCustomerId,
      status: 'all',
      limit: 1,
    });

    if (subscriptions.data.length === 0) {
      return false;
    }

    const subscription = subscriptions.data[0];
    return subscription.status === 'active' || subscription.status === 'trialing';
  } catch (error) {
    console.error('Error checking subscription status:', error);
    return false;
  }
}

/**
 * Cleanup expired projects (PocketBase only).
 * 1. Projects with expire in the past
 * 2. If user is Pro: clear expire on the record
 * 3. If Free: delete the project record
 */
export async function POST() {
  try {
    await pb.admins.authWithPassword(
      process.env.POCKETBASE_SUPERADMIN_EMAIL!,
      process.env.POCKETBASE_SUPERADMIN_PASSWORD!,
    );

    const now = new Date();
    const deletedProjects: Array<{ projectId: string; projectName: string; userId: string }> = [];
    const updatedProjects: Array<{
      projectId: string;
      projectName: string;
      userId: string;
      action: string;
    }> = [];
    const errors: Array<{ projectId: string; error: string }> = [];

    const userSubscriptionCache: Map<string, boolean> = new Map();

    let projectPage = 1;
    const projectsPerPage = 500;
    let totalExpiredFound = 0;

    while (true) {
      const projectsResult = await pb.collection('projects').getList(projectPage, projectsPerPage, {
        filter: `expire != null && expire != ""`,
      });

      const projects = projectsResult.items as unknown as Project[];

      for (const project of projects) {
        try {
          if (project.expire) {
            const expireDate = new Date(project.expire);
            if (expireDate < now) {
              totalExpiredFound++;

              let isProUser = userSubscriptionCache.get(project.user);

              if (isProUser === undefined) {
                try {
                  const userData = (await pb.collection('users').getOne(project.user)) as unknown as User;
                  isProUser = await hasActiveProSubscription(userData.stripe_id || null);
                  userSubscriptionCache.set(project.user, isProUser);
                } catch (userError) {
                  console.error(`Error fetching user ${project.user}:`, userError);
                  isProUser = false;
                  userSubscriptionCache.set(project.user, false);
                }
              }

              if (isProUser) {
                console.log(`User ${project.user} is now Pro - removing expiry from project: ${project.name}`);
                try {
                  await pb.collection('projects').update(project.id, { expire: null });
                  updatedProjects.push({
                    projectId: project.id,
                    projectName: project.name,
                    userId: project.user,
                    action: 'expiry_removed',
                  });
                } catch (updateError) {
                  console.error(`Error removing expiry from project ${project.name}:`, updateError);
                  errors.push({
                    projectId: project.id,
                    error: `Failed to remove expiry: ${updateError instanceof Error ? updateError.message : 'Unknown error'}`,
                  });
                }
              } else {
                console.log(`Deleting expired project: ${project.name} (user ${project.user})`);
                try {
                  await pb.collection('projects').delete(project.id);
                  deletedProjects.push({
                    projectId: project.id,
                    projectName: project.name,
                    userId: project.user,
                  });
                } catch (dbError) {
                  console.error(`Error deleting project ${project.name}:`, dbError);
                  errors.push({
                    projectId: project.id,
                    error: `Database deletion failed: ${dbError instanceof Error ? dbError.message : 'Unknown error'}`,
                  });
                }
              }
            }
          }
        } catch (projectError) {
          console.error(`Error processing project ${project.id}:`, projectError);
          errors.push({
            projectId: project.id,
            error: `Processing failed: ${projectError instanceof Error ? projectError.message : 'Unknown error'}`,
          });
        }
      }

      if (projectsResult.page >= projectsResult.totalPages) {
        break;
      }
      projectPage++;
    }

    return NextResponse.json({
      success: true,
      message: 'Cleanup completed',
      summary: {
        expiredProjectsFound: totalExpiredFound,
        projectsDeleted: deletedProjects.length,
        projectsUpdated: updatedProjects.length,
        errors: errors.length,
      },
      deletedProjects,
      updatedProjects,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error: unknown) {
    console.error('Error in cleanup route:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
