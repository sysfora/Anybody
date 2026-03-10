import { NextRequest, NextResponse } from 'next/server';
import pb from '@/lib/pocketbase';

export async function POST(request: NextRequest) {
  try {
    const { userId } = await request.json();

    if (!userId) {
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 400 }
      );
    }

    await pb.admins.authWithPassword(
      process.env.POCKETBASE_SUPERADMIN_EMAIL!,
      process.env.POCKETBASE_SUPERADMIN_PASSWORD!
    );

    // No team checks - allow all users to check subscription status
    // Get user to check their plan
    const user = await pb.collection('users').getOne(userId);
    const subscription = user?.subscription || user?.plan || 'free';
    const isFree = subscription === 'free' || !subscription || subscription === null;

    if (!isFree) {
      // Pro users have unlimited projects
      return NextResponse.json({
        isOutOfLimits: false,
        plan: 'pro',
      });
    }

    // Free plan limit (adjust based on your requirements)
    const FREE_PLAN_MAX_PROJECTS = 3;

    // Count user's projects
    const projects = await pb.collection('projects').getList(1, 1, {
      filter: `user = "${userId}"`,
    });

    // Get total count
    const totalProjects = projects.totalItems || 0;
    const isOutOfLimits = totalProjects >= FREE_PLAN_MAX_PROJECTS;

    return NextResponse.json({
      isOutOfLimits,
      plan: 'free',
      projectCount: totalProjects,
      maxProjects: FREE_PLAN_MAX_PROJECTS,
    });
  } catch (error) {
    console.error('Error checking subscription:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

