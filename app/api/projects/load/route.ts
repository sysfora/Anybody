import { NextRequest, NextResponse } from 'next/server';
import pb from '@/lib/pocketbase';
import { getEffectiveUserId } from '@/lib/server-utils';
import { escapePbFilterString, getSessionRecord } from '@/lib/session-user';

export async function GET(request: NextRequest) {
  try {
    const session = await getSessionRecord();
    if (!session?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const projectName = (searchParams.get('projectName') || '').trim();
    if (!projectName) {
      return NextResponse.json(
        { error: 'projectName is required' },
        { status: 400 },
      );
    }

    await pb.admins.authWithPassword(
      process.env.POCKETBASE_SUPERADMIN_EMAIL!,
      process.env.POCKETBASE_SUPERADMIN_PASSWORD!,
    );

    const effectiveUserId = await getEffectiveUserId(session.id);
    const safeName = escapePbFilterString(projectName);

    const projects = await pb.collection('projects').getList(1, 1, {
      filter: `user = "${effectiveUserId}" && name = "${safeName}"`,
    });

    if (projects.items.length === 0) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const project = projects.items[0] as unknown as {
      id: string;
      name: string;
      visibility?: string;
      status?: string;
      deployed?: boolean;
      html?: string;
    };

    const html =
      typeof project.html === 'string' && project.html.trim() ? project.html : '';

    return NextResponse.json({
      success: true,
      project: {
        id: project.id,
        name: project.name,
        visibility: project.visibility ?? 'public',
        status: project.status ?? 'completed',
        deployed: project.deployed ?? false,
      },
      html,
    });
  } catch (error) {
    console.error('projects/load:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load project' },
      { status: 500 },
    );
  }
}
