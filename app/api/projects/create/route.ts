import { NextRequest, NextResponse } from 'next/server';
import pb from '@/lib/pocketbase';
import { getEffectiveUserId } from '@/lib/server-utils';
import { escapePbFilterString, getSessionRecord } from '@/lib/session-user';

export async function POST(request: NextRequest) {
  try {
    const session = await getSessionRecord();
    if (!session?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const visibility =
      body.visibility === 'private' ? 'private' : 'public';

    if (!name) {
      return NextResponse.json({ error: 'Project name is required' }, { status: 400 });
    }

    await pb.admins.authWithPassword(
      process.env.POCKETBASE_SUPERADMIN_EMAIL!,
      process.env.POCKETBASE_SUPERADMIN_PASSWORD!,
    );

    const effectiveUserId = await getEffectiveUserId(session.id);
    const safeName = escapePbFilterString(name);

    const existing = await pb.collection('projects').getList(1, 1, {
      filter: `user = "${effectiveUserId}" && name = "${safeName}"`,
    });

    if (existing.items.length > 0) {
      const row = existing.items[0];
      return NextResponse.json({
        success: true,
        id: row.id,
        name: row.name,
        existed: true,
      });
    }

    const created = await pb.collection('projects').create({
      user: effectiveUserId,
      name,
      visibility,
      status: 'generating',
      deployed: false,
    });

    return NextResponse.json({
      success: true,
      id: created.id,
      name: created.name,
      existed: false,
    });
  } catch (error) {
    console.error('projects/create:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create project' },
      { status: 500 },
    );
  }
}
