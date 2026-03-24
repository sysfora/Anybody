import { NextRequest, NextResponse } from 'next/server';
import pb from '@/lib/pocketbase';
import { getSessionRecord } from '@/lib/session-user';

const MAX_FILES = 5;
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

export async function POST(request: NextRequest) {
  try {
    const session = await getSessionRecord();
    if (!session?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse multipart form data
    const formData = await request.formData();
    const projectId = formData.get('project_id');
    const role = formData.get('role') ?? 'user';
    const content = formData.get('content') ?? '';
    const requestId = formData.get('request_id') ?? '';

    if (!projectId || typeof projectId !== 'string') {
      return NextResponse.json({ error: 'project_id is required' }, { status: 400 });
    }

    // Collect uploaded files
    const fileEntries = formData.getAll('attachments');
    const files: File[] = fileEntries.filter((f): f is File => f instanceof File);

    // Server-side validation (client also validates, but defence-in-depth)
    if (files.length > MAX_FILES) {
      return NextResponse.json(
        { error: `Too many files. Maximum ${MAX_FILES} attachments allowed.` },
        { status: 400 },
      );
    }
    for (const file of files) {
      if (file.size > MAX_FILE_SIZE) {
        return NextResponse.json(
          { error: `File "${file.name}" exceeds the 5 MB limit.` },
          { status: 400 },
        );
      }
    }

    // Authenticate as admin to write to project_messages
    await pb.admins.authWithPassword(
      process.env.POCKETBASE_SUPERADMIN_EMAIL!,
      process.env.POCKETBASE_SUPERADMIN_PASSWORD!,
    );

    // Build multipart body — PocketBase JS SDK accepts a FormData object for file fields
    const pbForm = new FormData();
    pbForm.set('project', projectId);
    pbForm.set('role', typeof role === 'string' ? role : 'user');
    pbForm.set('content', typeof content === 'string' ? content : '');
    if (typeof requestId === 'string' && requestId) {
      pbForm.set('request_id', requestId);
    }

    // Append each file preserving original filename
    for (const file of files) {
      pbForm.append('attachments', file, file.name);
    }

    const record = await pb.collection('project_messages').create(pbForm);

    return NextResponse.json({ id: record.id, success: true });
  } catch (error) {
    console.error('messages/create:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create message' },
      { status: 500 },
    );
  }
}
