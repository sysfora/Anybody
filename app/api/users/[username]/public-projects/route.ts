import { NextRequest, NextResponse } from 'next/server';
import pb from '@/lib/pocketbase';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ username: string }> }
) {
  try {
    const { username } = await params;
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1', 10);
    const perPage = parseInt(searchParams.get('perPage') || '50', 10);

    // Authenticate as admin server-side
    await pb.admins.authWithPassword(
      process.env.POCKETBASE_SUPERADMIN_EMAIL!,
      process.env.POCKETBASE_SUPERADMIN_PASSWORD!
    );

    // Get user by username
    const users = await pb.collection('users').getList(1, 1, {
      filter: `username = "${username}"`,
    });

    if (users.items.length === 0) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    const userId = users.items[0].id;

    // Get public projects with pagination
    const projects = await pb.collection('projects').getList(page, perPage, {
      filter: `user = "${userId}" && visibility = "public"`,
      sort: '-created',
    });

    return NextResponse.json({
      success: true,
      projects: projects.items,
      totalItems: projects.totalItems,
      totalPages: projects.totalPages,
      page: projects.page,
      perPage: projects.perPage,
      username: users.items[0].username,
      userId: users.items[0].id,
      avatar: users.items[0].avatar || '',
    });
  } catch (error) {
    console.error('Error fetching public projects:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch public projects' },
      { status: 500 }
    );
  }
}

