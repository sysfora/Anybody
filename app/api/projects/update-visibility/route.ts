import { NextRequest, NextResponse } from 'next/server';
import pb from '@/lib/pocketbase';
import { getEffectiveUserId } from '@/lib/server-utils';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { project_id, visibility, userId } = body;

    if (!project_id || !visibility || !userId) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: project_id, visibility, userId' },
        { status: 400 }
      );
    }

    if (visibility !== 'public' && visibility !== 'private') {
      return NextResponse.json(
        { success: false, error: 'Invalid visibility value. Must be "public" or "private"' },
        { status: 400 }
      );
    }

    // Authenticate as admin server-side
    await pb.admins.authWithPassword(
      process.env.POCKETBASE_SUPERADMIN_EMAIL!,
      process.env.POCKETBASE_SUPERADMIN_PASSWORD!
    );

    // Get effective user ID (owner ID if team member, otherwise user's own ID)
    const effectiveUserId = await getEffectiveUserId(userId);

    // Parse project_id to get identifier and project_name
    const parts = project_id.split('/');
    if (parts.length !== 2) {
      return NextResponse.json(
        { success: false, error: `Invalid project_id format: ${project_id}. Expected format: "username/project_name" or "userId/project_name"` },
        { status: 400 }
      );
    }

    const [identifier, project_name] = parts;

    // Try to find user by username first, then by userId if that fails
    let users = await pb.collection('users').getList(1, 1, {
      filter: `username = "${identifier}"`,
    });

    // If not found by username, try as userId
    if (users.items.length === 0) {
      try {
        const user = await pb.collection('users').getOne(identifier);
        users = { items: [user], totalItems: 1, page: 1, perPage: 1, totalPages: 1 };
      } catch {
        // User not found by userId either
      }
    }

    if (users.items.length === 0) {
      return NextResponse.json(
        { success: false, error: `User "${identifier}" not found` },
        { status: 404 }
      );
    }

    const projectOwnerId = users.items[0].id;

    // Verify that the project belongs to the effective user ID (team checking)
    if (projectOwnerId !== effectiveUserId) {
      return NextResponse.json(
        { success: false, error: 'You do not have permission to update this project' },
        { status: 403 }
      );
    }

    // Find existing project
    const projects = await pb.collection('projects').getList(1, 1, {
      filter: `name="${project_name}" && user="${projectOwnerId}"`,
    });

    if (projects.items.length === 0) {
      const projectOwnerUsername = users.items[0].username || identifier;
      return NextResponse.json(
        { success: false, error: `Project "${project_name}" not found for user "${projectOwnerUsername}"` },
        { status: 404 }
      );
    }

    const projectRecordId = projects.items[0].id;

    // Update visibility
    await pb.collection('projects').update(projectRecordId, { visibility });

    return NextResponse.json({
      success: true,
      message: 'Visibility updated successfully',
    });
  } catch (error) {
    console.error('Error updating project visibility:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to update visibility' },
      { status: 500 }
    );
  }
}

