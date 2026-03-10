import { NextResponse } from 'next/server';
import { S3Client, ListObjectsV2Command, DeleteObjectCommand } from '@aws-sdk/client-s3';
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

// Check if user has an active Pro subscription
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
 * Cleanup expired projects
 * This route:
 * 1. Gets all projects with an expire date that has passed
 * 2. Checks if the user is currently on Pro plan
 * 3. If Pro: Removes the expiry date (user upgraded, project should never expire)
 * 4. If Free: Deletes expired projects from both R2 and PocketBase
 */
export async function POST() {
  try {
    // Authenticate as admin
    await pb.admins.authWithPassword(
      process.env.POCKETBASE_SUPERADMIN_EMAIL!,
      process.env.POCKETBASE_SUPERADMIN_PASSWORD!
    );

    // Check if R2 is configured
    const bucketName = process.env.R2_BUCKET_NAME;
    if (!bucketName) {
      return NextResponse.json(
        { error: 'R2_BUCKET_NAME is not configured' },
        { status: 500 }
      );
    }

    // Initialize S3 client for R2
    const s3Client = new S3Client({
      region: 'auto',
      endpoint: process.env.R2_ENDPOINT_URL,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    });

    const now = new Date();
    const deletedProjects: Array<{ projectId: string; projectName: string; userId: string }> = [];
    const updatedProjects: Array<{ projectId: string; projectName: string; userId: string; action: string }> = [];
    const errors: Array<{ projectId: string; error: string }> = [];

    // Cache user subscription status to avoid repeated Stripe API calls
    const userSubscriptionCache: Map<string, boolean> = new Map();

    // Get all expired projects (projects with expire date in the past)
    let projectPage = 1;
    const projectsPerPage = 500;
    let totalExpiredFound = 0;

    while (true) {
      // Get all projects with an expire field set
      const projectsResult = await pb.collection('projects').getList(projectPage, projectsPerPage, {
        filter: `expire != null && expire != ""`,
      });

      const projects = projectsResult.items as unknown as Project[];

      // Check each project for expiration
      for (const project of projects) {
        try {
          // Check if project has expired
          if (project.expire) {
            const expireDate = new Date(project.expire);
            if (expireDate < now) {
              totalExpiredFound++;

              // Check if user is on Pro plan (use cache if available)
              let isProUser = userSubscriptionCache.get(project.user);
              
              if (isProUser === undefined) {
                // Get user's Stripe ID
                try {
                  const userData = await pb.collection('users').getOne(project.user) as unknown as User;
                  isProUser = await hasActiveProSubscription(userData.stripe_id || null);
                  userSubscriptionCache.set(project.user, isProUser);
                } catch (userError) {
                  console.error(`Error fetching user ${project.user}:`, userError);
                  // Assume not pro if we can't fetch user data
                  isProUser = false;
                  userSubscriptionCache.set(project.user, false);
                }
              }

              if (isProUser) {
                // User is now on Pro plan - remove expiry instead of deleting
                console.log(`User ${project.user} is now Pro - removing expiry from project: ${project.name}`);
                try {
                  await pb.collection('projects').update(project.id, { expire: null });
                  updatedProjects.push({
                    projectId: project.id,
                    projectName: project.name,
                    userId: project.user,
                    action: 'expiry_removed',
                  });
                  console.log(`Removed expiry from project ${project.name} for Pro user ${project.user}`);
                } catch (updateError) {
                  console.error(`Error removing expiry from project ${project.name}:`, updateError);
                  errors.push({
                    projectId: project.id,
                    error: `Failed to remove expiry: ${updateError instanceof Error ? updateError.message : 'Unknown error'}`,
                  });
                }
              } else {
                // User is still on Free plan - delete the expired project
                console.log(`Deleting expired project: ${project.name} (expired: ${project.expire}) for free user ${project.user}`);

                // Delete from R2
                const projectPath = `${project.user}/${project.name}`;

                try {
                  // List all objects with the project prefix (includes source/ and dist/ folders)
                  const listCommand = new ListObjectsV2Command({
                    Bucket: bucketName,
                    Prefix: projectPath,
                  });

                  const listResponse = await s3Client.send(listCommand);
                  const objects = listResponse.Contents || [];

                  // Delete all objects (source code and dist folder)
                  if (objects.length > 0) {
                    const deletePromises = objects
                      .filter((obj) => obj.Key)
                      .map((obj) => {
                        return s3Client.send(
                          new DeleteObjectCommand({
                            Bucket: bucketName,
                            Key: obj.Key!,
                          })
                        );
                      });

                    await Promise.all(deletePromises);
                    console.log(`Deleted ${objects.length} objects from R2 for project ${project.name}`);
                  }
                } catch (r2Error) {
                  console.error(`Error deleting from R2 for project ${project.name}:`, r2Error);
                  errors.push({
                    projectId: project.id,
                    error: `R2 deletion failed: ${r2Error instanceof Error ? r2Error.message : 'Unknown error'}`,
                  });
                  // Continue with database deletion even if R2 deletion fails
                }

                // Delete from PocketBase
                try {
                  await pb.collection('projects').delete(project.id);
                  deletedProjects.push({
                    projectId: project.id,
                    projectName: project.name,
                    userId: project.user,
                  });
                  console.log(`Deleted project ${project.name} from PocketBase`);
                } catch (dbError) {
                  console.error(`Error deleting project ${project.name} from PocketBase:`, dbError);
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

    console.log(`Found ${totalExpiredFound} expired projects`);
    console.log(`Deleted ${deletedProjects.length} projects (free users)`);
    console.log(`Updated ${updatedProjects.length} projects (pro users - expiry removed)`);

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
      { status: 500 }
    );
  }
}

