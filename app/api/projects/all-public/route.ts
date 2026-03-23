import { NextRequest, NextResponse } from 'next/server';
import pb from '@/lib/pocketbase';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const currentUserId = searchParams.get('userId');
    const limit = parseInt(searchParams.get('limit') || '20', 10);

    // Authenticate as admin server-side to access all public projects efficiently
    await pb.admins.authWithPassword(
      process.env.POCKETBASE_SUPERADMIN_EMAIL!,
      process.env.POCKETBASE_SUPERADMIN_PASSWORD!
    );

    let finalProjects: any[] = [];

    // 1. Get current user's public projects if logged in
    if (currentUserId) {
      try {
        const userProjects = await pb.collection('projects').getList(1, limit, {
          filter: `user = "${currentUserId}" && visibility = "public"`,
          sort: '-created',
          expand: 'user',
        });
        
        finalProjects = userProjects.items.map(p => ({
          id: p.id,
          name: p.name,
          username: p.expand?.user?.username || 'user',
          user_id: p.expand?.user?.id || '',
          user_avatar: p.expand?.user?.avatar || '',
          preview: p.preview,
          created: p.created,
          deployed: p.deployed,
        }));
      } catch (err) {
          console.warn("Failed to fetch current user projects:", err);
      }
    }

    // 2. Get random public projects from others
    const otherProjectsLimit = limit - finalProjects.length;
    if (otherProjectsLimit > 0) {
      const filter = currentUserId 
        ? `user != "${currentUserId}" && visibility = "public"`
        : `visibility = "public"`;

      // We fetch more than we need and pick randomly since PocketBase doesn't support random sort
      const others = await pb.collection('projects').getList(1, limit * 2, {
        filter,
        sort: '-created', 
        expand: 'user',
      });

      const otherItems = others.items.map(p => ({
        id: p.id,
        name: p.name,
        username: p.expand?.user?.username || 'user',
        user_id: p.expand?.user?.id || '',
        user_avatar: p.expand?.user?.avatar || '',
        preview: p.preview,
        created: p.created,
        deployed: p.deployed,
      })).sort(() => Math.random() - 0.5); // Client-side shuffle for randomness

      finalProjects = [...finalProjects, ...otherItems.slice(0, otherProjectsLimit)];
    }

    return NextResponse.json({
      success: true,
      projects: finalProjects,
    });
  } catch (error) {
    console.error('Error fetching random public projects:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch public projects' },
      { status: 500 }
    );
  }
}
