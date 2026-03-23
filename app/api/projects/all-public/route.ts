import { NextRequest, NextResponse } from 'next/server';
import pb from '@/lib/pocketbase';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '12', 10);

    // Authenticate as admin server-side to access all public projects efficiently
    await pb.admins.authWithPassword(
      process.env.POCKETBASE_SUPERADMIN_EMAIL!,
      process.env.POCKETBASE_SUPERADMIN_PASSWORD!
    );

    // Get public projects with pagination, sorted by newest first
    const projects = await pb.collection('projects').getList(page, limit, {
      filter: `visibility = "public"`,
      sort: '-created',
      expand: 'user',
    });
    
    const formattedProjects = projects.items.map(p => ({
      id: p.id,
      name: p.name,
      username: p.expand?.user?.username || 'user',
      user_id: p.expand?.user?.id || '',
      user_avatar: p.expand?.user?.avatar || '',
      preview: p.preview,
      created: p.created,
      deployed: p.deployed,
    }));

    return NextResponse.json({
      success: true,
      projects: formattedProjects,
      totalPages: projects.totalPages,
      page: projects.page,
    });
  } catch (error) {
    console.error('Error fetching random public projects:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch public projects' },
      { status: 500 }
    );
  }
}
