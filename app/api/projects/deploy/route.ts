import { NextRequest, NextResponse } from 'next/server';
import pb from '@/lib/pocketbase';
import { getEffectiveUserId } from '@/lib/server-utils';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const username = searchParams.get('username');
    const userId = searchParams.get('userId');
    const projectName = searchParams.get('projectName');

    if (!projectName) {
      return NextResponse.json(
        { error: 'Project name is required' },
        { status: 400 }
      );
    }

    if (!username && !userId) {
      return NextResponse.json(
        { error: 'Username or userId is required' },
        { status: 400 }
      );
    }

    // Authenticate as admin server-side
    await pb.admins.authWithPassword(
      process.env.POCKETBASE_SUPERADMIN_EMAIL!,
      process.env.POCKETBASE_SUPERADMIN_PASSWORD!
    );

    // Get userId - either use provided userId or look up by username
    let resolvedUserId: string;
    let resolvedUsername: string;
    if (userId) {
      // Verify user exists
      try {
        const userRec = await pb.collection('users').getOne(userId);
        resolvedUserId = userId;
        resolvedUsername = userRec.username;
      } catch {
        return NextResponse.json(
          { error: 'User not found' },
          { status: 404 }
        );
      }
    } else {
      // Look up by username
      const users = await pb.collection('users').getList(1, 1, {
        filter: `username = "${username}"`,
      });

      if (users.items.length === 0) {
        return NextResponse.json(
          { error: 'User not found' },
          { status: 404 }
        );
      }

      resolvedUserId = users.items[0].id;
      resolvedUsername = users.items[0].username;
    }
    
    // Get effective user ID (owner ID if team member, otherwise user's own ID)
    const effectiveUserId = await getEffectiveUserId(resolvedUserId);

    // Get project by effectiveUserId and projectName
    const projects = await pb.collection('projects').getList(1, 1, {
      filter: `user = "${effectiveUserId}" && name = "${projectName}"`,
    });

    if (projects.items.length === 0) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      );
    }

    const project = projects.items[0];

    return NextResponse.json({
      success: true,
      deployed: project.deployed || false,
      username: resolvedUsername,
    });
  } catch (error: unknown) {
    console.error('Get deployment status error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get deployment status' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { username, userId: providedUserId, projectName, action = 'deploy' } = body;

    if (!projectName) {
      return NextResponse.json(
        { error: 'Project name is required' },
        { status: 400 }
      );
    }

    if (!username && !providedUserId) {
      return NextResponse.json(
        { error: 'Username or userId is required' },
        { status: 400 }
      );
    }

    if (action !== 'deploy' && action !== 'undeploy') {
      return NextResponse.json(
        { error: 'Invalid action. Must be "deploy" or "undeploy"' },
        { status: 400 }
      );
    }

    // Authenticate as admin server-side
    await pb.admins.authWithPassword(
      process.env.POCKETBASE_SUPERADMIN_EMAIL!,
      process.env.POCKETBASE_SUPERADMIN_PASSWORD!
    );

    // Get userId - either use provided userId or look up by username
    let userId: string;
    let resolvedUsername: string;
    if (providedUserId) {
      // Verify user exists
      try {
        const userRec = await pb.collection('users').getOne(providedUserId);
        userId = providedUserId;
        resolvedUsername = userRec.username;
      } catch {
        return NextResponse.json(
          { error: 'User not found' },
          { status: 404 }
        );
      }
    } else {
      // Look up by username
      const users = await pb.collection('users').getList(1, 1, {
        filter: `username = "${username}"`,
      });

      if (users.items.length === 0) {
        return NextResponse.json(
          { error: 'User not found' },
          { status: 404 }
        );
      }

      userId = users.items[0].id;
      resolvedUsername = users.items[0].username;
    }

    // Get effective user ID (owner ID if team member, otherwise user's own ID)
    const effectiveUserId = await getEffectiveUserId(userId);

    // Get project by effectiveUserId and projectName
    const projects = await pb.collection('projects').getList(1, 1, {
      filter: `user = "${effectiveUserId}" && name = "${projectName}"`,
    });

    if (projects.items.length === 0) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      );
    }

    const project = projects.items[0];

    // Update project deployed status
    const deployed = action === 'deploy';
    const updatedProject = await pb.collection('projects').update(project.id, {
      deployed,
    });

    return NextResponse.json({
      success: true,
      project: {
        id: updatedProject.id,
        name: updatedProject.name,
        deployed: updatedProject.deployed,
      },
      username: resolvedUsername,
    });
  } catch (error: unknown) {
    console.error('Deploy error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update deployment status' },
      { status: 500 }
    );
  }
}

