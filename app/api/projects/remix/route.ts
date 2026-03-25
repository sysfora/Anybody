import { NextRequest, NextResponse } from 'next/server';
import pb from '@/lib/pocketbase';
import { getEffectiveUserId } from '@/lib/server-utils';
import { getSessionRecord, escapePbFilterString } from '@/lib/session-user';
import { loadSlugWords, randomSlugFromWords } from '@/lib/slug-words';

export async function POST(request: NextRequest) {
  try {
    const session = await getSessionRecord();
    if (!session?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { projectId } = body;

    if (!projectId) {
      return NextResponse.json({ error: 'Project ID is required' }, { status: 400 });
    }

    // Auth as admin to access the source project
    await pb.admins.authWithPassword(
      process.env.POCKETBASE_SUPERADMIN_EMAIL!,
      process.env.POCKETBASE_SUPERADMIN_PASSWORD!,
    );

    // 1. Fetch source project
    const sourceProject = await pb.collection('projects').getOne(projectId);
    if (!sourceProject) {
      return NextResponse.json({ error: 'Source project not found' }, { status: 404 });
    }

    if (sourceProject.visibility === 'private') {
      return NextResponse.json({ error: 'Private projects cannot be remixed' }, { status: 403 });
    }

    const effectiveUserId = await getEffectiveUserId(session.id);
    
    // 2. Generate a unique 3-word name for the remixed project
    const words = loadSlugWords();
    let finalName = randomSlugFromWords(words);
    
    // Check for existing projects with the same name to avoid duplicates
    while (true) {
      const existing = await pb.collection('projects').getList(1, 1, {
        filter: `user = "${effectiveUserId}" && name = "${escapePbFilterString(finalName)}"`,
      });
      if (existing.items.length === 0) break;
      finalName = randomSlugFromWords(words);
    }

    // 3. Fetch source preview image if present
    let previewBlob: Blob | null = null;
    if (sourceProject.preview) {
      try {
        const pbUrl = process.env.POCKETBASE_URL || process.env.NEXT_PUBLIC_POCKETBASE_URL || 'http://127.0.0.1:8090';
        const previewUrl = `${pbUrl}/api/files/projects/${sourceProject.id}/${sourceProject.preview}`;
        const res = await fetch(previewUrl);
        if (res.ok) {
          previewBlob = await res.blob();
        }
      } catch {
        // Non-fatal — create the project without a preview if the fetch fails
      }
    }

    // 4. Create the new remixed project for the user
    const createData = new FormData();
    createData.append('user', effectiveUserId);
    createData.append('name', finalName);
    createData.append('html', sourceProject.html || '');
    createData.append('visibility', 'public');
    createData.append('status', 'completed');
    createData.append('deployed', 'true');
    if (previewBlob) {
      createData.append('preview', previewBlob, 'preview.jpg');
    }
    const remixedProject = await pb.collection('projects').create(createData);

    // 5. Add the "Project remixed" message from AI assistant
    await pb.collection('project_messages').create({
      project: remixedProject.id,
      role: 'assistant',
      content: 'Project remixed',
      thinking: '',
    });

    return NextResponse.json({
      success: true,
      projectId: remixedProject.id,
      projectName: remixedProject.name,
    });
  } catch (error) {
    console.error('projects/remix:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to remix project' },
      { status: 500 },
    );
  }
}
