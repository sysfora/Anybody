import { NextRequest, NextResponse } from 'next/server';
import pb from '@/lib/pocketbase';
import { escapePbFilterString } from '@/lib/session-user';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const page = parseInt(searchParams.get('page') || '1', 10);
    const perPage = parseInt(searchParams.get('perPage') || '50', 10);

    if (!userId) {
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 400 }
      );
    }

    // Authenticate as admin server-side
    await pb.admins.authWithPassword(
      process.env.POCKETBASE_SUPERADMIN_EMAIL!,
      process.env.POCKETBASE_SUPERADMIN_PASSWORD!
    );

    // Get user to get username
    const user = await pb.collection('users').getOne(userId);
    const username = user.username || userId;

    const safeUserId = escapePbFilterString(userId);

    // Get projects from PocketBase with pagination
    const projects = await pb.collection('projects').getList(page, perPage, {
      filter: `user = "${safeUserId}"`,
      sort: '-created',
    });

    // Format projects to match frontend expectations
    const formattedProjects = projects.items.map((project: any) => {
      // Calculate expiry status
      let expiresIn: string | "Never" | "Expired" = "Never";
      if (project.expire) {
        const expireDate = new Date(project.expire);
        const now = new Date();
        if (expireDate < now) {
          expiresIn = "Expired";
        } else {
          const daysLeft = Math.ceil((expireDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
          expiresIn = `${daysLeft} day${daysLeft !== 1 ? 's' : ''}`;
        }
      }

      return {
        id: project.id,
        name: project.name,
        dateCreated: project.created || project.dateCreated,
        expiresIn,
        deployed: project.deployed || false,
        visibility: project.visibility || 'public',
        username: username,
        status: project.status || 'completed', // Status from PocketBase: generating, modifying, building, uploading, completed, error, cancelled
      };
    });

    return NextResponse.json({
      success: true,
      projects: formattedProjects,
      totalItems: projects.totalItems,
      totalPages: projects.totalPages,
      page: projects.page,
      perPage: projects.perPage,
    });
  } catch (error) {
    console.error('Error fetching projects:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch projects' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, projectId, projectName } = body;

    if (!userId || !projectId || !projectName) {
      return NextResponse.json(
        { error: 'Missing required fields: userId, projectId, projectName' },
        { status: 400 }
      );
    }

    // Authenticate as admin server-side
    await pb.admins.authWithPassword(
      process.env.POCKETBASE_SUPERADMIN_EMAIL!,
      process.env.POCKETBASE_SUPERADMIN_PASSWORD!
    );

    const safeName = escapePbFilterString(projectName);

    const rows = await pb.collection('projects').getList(1, 1, {
      filter: `id = "${escapePbFilterString(projectId)}" && user = "${escapePbFilterString(userId)}" && name = "${safeName}"`,
    });

    if (rows.items.length === 0) {
      return NextResponse.json(
        { error: 'Project not found or access denied' },
        { status: 404 },
      );
    }

    await pb.collection('projects').delete(projectId);

    return NextResponse.json({
      success: true,
      message: 'Project deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting project:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete project' },
      { status: 500 }
    );
  }
}

